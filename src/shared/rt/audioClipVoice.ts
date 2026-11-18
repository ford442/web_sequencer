/**
 * One audio clip voice (#1629 D4): what the `audio-clip-processor` worklet runs
 * per playing clip, and what the offline render runs per clip, so an export
 * plays the samples live playback plays.
 *
 * A voice sounds context frames `[startFrame, endFrame)`. It reads its source
 * sequentially from a feed (an SAB ring, a queue of posted chunks, or a whole
 * array offline), at `rate` source frames per output frame (1 = the media is
 * at the context rate; otherwise linear interpolation). Its gain is the clip
 * gain times one envelope:
 *
 *   - the clip's fade-in from its left edge and fade-out to its right edge,
 *   - a `DECLICK_FRAMES` ramp at every edge that cuts the source mid-way: a
 *     trimmed or split clip edge (`declickEdges`), a seek into the clip, a
 *     transport stop. An edge at the source's own start or end is left
 *     alone, so an imported hit keeps its attack.
 *
 * A feed that runs dry (a page arrived late) plays silence for the missing
 * frames and skips that many frames once data arrives, so the clip stays on
 * the grid instead of drifting late.
 *
 * Real-time code: no allocation after construction, ES2022 only.
 */

/** `registerProcessor` name of `src/audio-worklets/audio-clip-processor.ts`. */
export const AUDIO_CLIP_PROCESSOR_NAME = 'audio-clip-processor';

/** Edge ramp of every voice, in output frames (~1.3 ms at 48 kHz). */
export const DECLICK_FRAMES = 64;

/** A stereo source a voice reads in order. Mono media is written to both channels. */
export interface ClipFeed {
    /** Frames available to read now. */
    readable(): number;
    /** Copy up to `count` frames into `l` / `r` at `offset`; returns frames read. */
    read(l: Float32Array, r: Float32Array, offset: number, count: number): number;
    /** Drop up to `count` frames; returns frames dropped. */
    skip(count: number): number;
}

/** The fixed parameters of one voice, in context frames. */
export interface ClipVoiceSpec {
    /** First frame the voice sounds (a clip's left edge, or a seek into it). */
    startFrame: number;
    /** Frame after its last one (the clip's right edge, or a stop). */
    endFrame: number;
    /** The clip's left / right edge: where the clip's own fades are measured from. */
    clipStartFrame: number;
    clipEndFrame: number;
    /** Clip fades in output frames (0 = none). */
    fadeInFrames: number;
    fadeOutFrames: number;
    /** Linear clip gain. */
    gain: number;
    /** Source frames per output frame. */
    rate: number;
    /** Fractional source position at `startFrame` (0 ≤ frac < 1; 0 when `rate` is 1). */
    frac: number;
    /** Source frames the feed has from its first frame on; past them the voice plays silence. */
    sourceFrames: number;
    /** Clip edges that cut the source: `DECLICK_LEFT` | `DECLICK_RIGHT`. */
    declickEdges: number;
}

export const DECLICK_LEFT = 1;
export const DECLICK_RIGHT = 2;

/** Linear ramp factor of `frame` inside `[from, from + length)`, 1 past it. */
function rampIn(frame: number, from: number, length: number): number {
    if (length <= 0) return 1;
    const t = (frame - from + 1) / (length + 1);
    return t >= 1 ? 1 : t <= 0 ? 0 : t;
}

/** Linear ramp factor towards `to` (exclusive), 1 before `to - length`. */
function rampOut(frame: number, to: number, length: number): number {
    if (length <= 0) return 1;
    const t = (to - frame) / (length + 1);
    return t >= 1 ? 1 : t <= 0 ? 0 : t;
}

/** The voice gain at context frame `frame`, envelope included. */
export function voiceGainAt(spec: ClipVoiceSpec, frame: number): number {
    const fadeIn = rampIn(frame, spec.clipStartFrame,
        Math.max(spec.fadeInFrames, spec.declickEdges & DECLICK_LEFT ? DECLICK_FRAMES : 0));
    const fadeOut = rampOut(frame, spec.clipEndFrame,
        Math.max(spec.fadeOutFrames, spec.declickEdges & DECLICK_RIGHT ? DECLICK_FRAMES : 0));
    const startDeclick = spec.startFrame > spec.clipStartFrame ? rampIn(frame, spec.startFrame, DECLICK_FRAMES) : 1;
    const stopDeclick = spec.endFrame < spec.clipEndFrame ? rampOut(frame, spec.endFrame, DECLICK_FRAMES) : 1;
    return spec.gain * Math.min(fadeIn, fadeOut, startDeclick, stopDeclick);
}

/** One playing voice. Reused: `start` re-arms it for another clip. */
export class ClipVoice {
    readonly spec: ClipVoiceSpec = {
        startFrame: 0, endFrame: 0, clipStartFrame: 0, clipEndFrame: 0,
        fadeInFrames: 0, fadeOutFrames: 0, gain: 1, rate: 1, frac: 0, sourceFrames: 0, declickEdges: 0,
    };
    active = false;
    /** Output index (audio track) the voice mixes into. */
    track = 0;
    /** Frames the feed owed when it ran dry; skipped once they arrive. */
    debt = 0;
    /** Frames of silence played because the feed ran dry. */
    underrunFrames = 0;
    private frac = 0;
    private sourceLeft = 0;
    private primed = false;
    private aL = 0;
    private aR = 0;
    private bL = 0;
    private bR = 0;
    private readonly one = { l: new Float32Array(1), r: new Float32Array(1) };
    private readonly scratchL: Float32Array;
    private readonly scratchR: Float32Array;

    constructor(maxBlock = 128) {
        this.scratchL = new Float32Array(maxBlock);
        this.scratchR = new Float32Array(maxBlock);
    }

    start(spec: Readonly<ClipVoiceSpec>, track: number): void {
        Object.assign(this.spec, spec);
        this.track = track;
        this.frac = spec.frac;
        this.sourceLeft = spec.sourceFrames;
        this.primed = false;
        this.debt = 0;
        this.underrunFrames = 0;
        this.active = spec.endFrame > spec.startFrame;
    }

    /** Move the end (a stop, or a tempo change moved the clip's right edge). */
    setEnd(endFrame: number, clipEndFrame: number): void {
        this.spec.endFrame = endFrame;
        this.spec.clipEndFrame = clipEndFrame;
    }

    /**
     * Pay off the feed's debt first, then read. Frames the feed should have had
     * but did not are new debt; frames past the end of the source are silence.
     */
    private pull(feed: ClipFeed, l: Float32Array, r: Float32Array, offset: number, count: number): void {
        const real = Math.max(0, Math.min(count, this.sourceLeft));
        this.sourceLeft -= real;
        if (this.debt > 0) this.debt -= feed.skip(this.debt);
        const got = this.debt > 0 ? 0 : feed.read(l, r, offset, real);
        if (got < real) {
            this.debt += real - got;
            this.underrunFrames += real - got;
        }
        if (got < count) {
            l.fill(0, offset + got, offset + count);
            r.fill(0, offset + got, offset + count);
        }
    }

    private next(feed: ClipFeed): void {
        this.aL = this.bL;
        this.aR = this.bR;
        this.pull(feed, this.one.l, this.one.r, 0, 1);
        this.bL = this.one.l[0];
        this.bR = this.one.r[0];
    }

    /**
     * Mix frames `[blockStart, blockStart + frames)` of this voice into
     * `outL` / `outR` (added, from index 0). Returns false once the voice has
     * ended (it is then inactive).
     */
    render(feed: ClipFeed, outL: Float32Array, outR: Float32Array, blockStart: number, frames: number): boolean {
        if (!this.active) return false;
        const spec = this.spec;
        const blockEnd = blockStart + frames;
        if (spec.endFrame <= blockStart) {
            this.active = false;
            return false;
        }
        if (spec.startFrame >= blockEnd) return true;
        const from = Math.max(blockStart, spec.startFrame);
        const to = Math.min(blockEnd, spec.endFrame);
        const offset = from - blockStart;
        const count = to - from;
        if (spec.rate === 1) {
            this.pull(feed, this.scratchL, this.scratchR, 0, count);
            for (let i = 0; i < count; i++) {
                const g = voiceGainAt(spec, from + i);
                outL[offset + i] += this.scratchL[i] * g;
                outR[offset + i] += this.scratchR[i] * g;
            }
        } else {
            if (!this.primed) {
                this.next(feed);
                this.next(feed);
                this.primed = true;
            }
            for (let i = 0; i < count; i++) {
                const g = voiceGainAt(spec, from + i);
                const t = this.frac;
                outL[offset + i] += (this.aL + (this.bL - this.aL) * t) * g;
                outR[offset + i] += (this.aR + (this.bR - this.aR) * t) * g;
                this.frac += spec.rate;
                while (this.frac >= 1) {
                    this.frac -= 1;
                    this.next(feed);
                }
            }
        }
        if (to >= spec.endFrame) {
            this.active = false;
            return false;
        }
        return true;
    }
}

/** Source frames a voice consumes over `outputFrames` (what a pager must supply). */
export function sourceFramesFor(outputFrames: number, rate: number, frac = 0): number {
    return rate === 1 ? outputFrames : Math.ceil(frac + outputFrames * rate) + 1;
}

// ---------------------------------------------------------------------------
// Track strips
// ---------------------------------------------------------------------------

/** dB → linear; -Infinity and anything at or below -96 dB is silence. */
export function dbToGain(db: number): number {
    return db <= -96 ? 0 : Math.pow(10, db / 20);
}

/** Balance of a stereo strip: unity at centre, the far side fades out. */
export function stripGains(gainDb: number, pan: number): { l: number; r: number } {
    const g = dbToGain(gainDb);
    const p = pan < -1 ? -1 : pan > 1 ? 1 : pan;
    return { l: g * (p > 0 ? 1 - p : 1), r: g * (p < 0 ? 1 + p : 1) };
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

/** Int32 header of a ring: frames written, frames read (both only ever grow). */
export const RING_HEADER_INTS = 4;
const WRITE = 0;
const READ = 1;

/** Bytes of one ring of `capacity` stereo frames. */
export function ringBytes(capacity: number): number {
    return RING_HEADER_INTS * 4 + capacity * 2 * 4;
}

/**
 * Lock-free SPSC ring of stereo frames over a SharedArrayBuffer (planar: all
 * of L, then all of R). The pager writes, the worklet reads. Counters are
 * Int32 and compared by difference, so they may wrap.
 */
export class SabClipRing implements ClipFeed {
    readonly capacity: number;
    private readonly head: Int32Array;
    private readonly l: Float32Array;
    private readonly r: Float32Array;

    constructor(buffer: SharedArrayBuffer | ArrayBuffer, byteOffset: number, capacity: number) {
        this.capacity = capacity;
        this.head = new Int32Array(buffer, byteOffset, RING_HEADER_INTS);
        this.l = new Float32Array(buffer, byteOffset + RING_HEADER_INTS * 4, capacity);
        this.r = new Float32Array(buffer, byteOffset + RING_HEADER_INTS * 4 + capacity * 4, capacity);
    }

    /** Producer side, only while no voice reads the ring. */
    reset(): void {
        Atomics.store(this.head, WRITE, 0);
        Atomics.store(this.head, READ, 0);
    }

    readable(): number {
        return (Atomics.load(this.head, WRITE) - Atomics.load(this.head, READ)) | 0;
    }

    writable(): number {
        return this.capacity - this.readable();
    }

    /** Producer: append up to `count` frames (mono when `r` is null). */
    write(l: Float32Array, r: Float32Array | null, offset: number, count: number): number {
        const n = Math.min(count, this.writable());
        let at = Atomics.load(this.head, WRITE);
        for (let i = 0; i < n; i++, at++) {
            const slot = ((at % this.capacity) + this.capacity) % this.capacity;
            this.l[slot] = l[offset + i];
            this.r[slot] = r ? r[offset + i] : l[offset + i];
        }
        Atomics.store(this.head, WRITE, at | 0);
        return n;
    }

    read(l: Float32Array, r: Float32Array, offset: number, count: number): number {
        const n = Math.min(count, this.readable());
        let at = Atomics.load(this.head, READ);
        for (let i = 0; i < n; i++, at++) {
            const slot = ((at % this.capacity) + this.capacity) % this.capacity;
            l[offset + i] = this.l[slot];
            r[offset + i] = this.r[slot];
        }
        Atomics.store(this.head, READ, at | 0);
        return n;
    }

    skip(count: number): number {
        const n = Math.min(count, this.readable());
        Atomics.store(this.head, READ, (Atomics.load(this.head, READ) + n) | 0);
        return n;
    }

    /** Frames the consumer has read since the last reset. */
    consumed(): number {
        return Atomics.load(this.head, READ);
    }
}

/**
 * A queue of posted chunks: the feed when the page is not crossOriginIsolated
 * (no SharedArrayBuffer). Receiving a chunk allocates (the message); reading
 * does not.
 */
export class ChunkQueueFeed implements ClipFeed {
    private readonly chunksL: (Float32Array | null)[];
    private readonly chunksR: (Float32Array | null)[];
    private head = 0;
    private size = 0;
    private pos = 0;
    private available = 0;

    constructor(maxChunks = 64) {
        this.chunksL = new Array<Float32Array | null>(maxChunks).fill(null);
        this.chunksR = new Array<Float32Array | null>(maxChunks).fill(null);
    }

    clear(): void {
        this.chunksL.fill(null);
        this.chunksR.fill(null);
        this.head = 0;
        this.size = 0;
        this.pos = 0;
        this.available = 0;
    }

    /** False when the queue is full (the chunk is dropped). */
    push(l: Float32Array, r: Float32Array): boolean {
        if (this.size === this.chunksL.length || l.length === 0) return false;
        const slot = (this.head + this.size) % this.chunksL.length;
        this.chunksL[slot] = l;
        this.chunksR[slot] = r;
        this.size++;
        this.available += l.length;
        return true;
    }

    readable(): number {
        return this.available;
    }

    private advance(n: number, l: Float32Array | null, r: Float32Array | null, offset: number): number {
        let done = 0;
        while (done < n && this.size > 0) {
            const cl = this.chunksL[this.head] as Float32Array;
            const cr = this.chunksR[this.head] as Float32Array;
            const take = Math.min(n - done, cl.length - this.pos);
            if (l && r) {
                for (let i = 0; i < take; i++) {
                    l[offset + done + i] = cl[this.pos + i];
                    r[offset + done + i] = cr[this.pos + i];
                }
            }
            done += take;
            this.pos += take;
            if (this.pos >= cl.length) {
                this.chunksL[this.head] = null;
                this.chunksR[this.head] = null;
                this.head = (this.head + 1) % this.chunksL.length;
                this.size--;
                this.pos = 0;
            }
        }
        this.available -= done;
        return done;
    }

    read(l: Float32Array, r: Float32Array, offset: number, count: number): number {
        return this.advance(count, l, r, offset);
    }

    skip(count: number): number {
        return this.advance(count, null, null, 0);
    }
}

/** The whole source in memory, from `start` (offline renders, tests). */
export class ArrayClipFeed implements ClipFeed {
    private pos: number;
    private readonly l: Float32Array;
    private readonly r: Float32Array;

    constructor(channels: readonly Float32Array[], start: number) {
        this.l = channels[0];
        this.r = channels[1] ?? channels[0];
        this.pos = Math.max(0, start);
    }

    readable(): number {
        return Math.max(0, this.l.length - this.pos);
    }

    read(l: Float32Array, r: Float32Array, offset: number, count: number): number {
        const n = Math.min(count, this.readable());
        for (let i = 0; i < n; i++) {
            l[offset + i] = this.l[this.pos + i];
            r[offset + i] = this.r[this.pos + i];
        }
        this.pos += n;
        return n;
    }

    skip(count: number): number {
        const n = Math.min(count, this.readable());
        this.pos += n;
        return n;
    }
}
