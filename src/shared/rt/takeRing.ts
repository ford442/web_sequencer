/**
 * The take ring (#1498 P1): the `recorder-processor` worklet writes captured
 * input here and the take writer worker drains it into OPFS. The main thread
 * only allocates it, so a long take never touches the page's JS heap.
 *
 * One SharedArrayBuffer, single producer (the worklet), single consumer (the
 * worker):
 *
 *   Int32  [0] written    frames written, wrapping int32 (producer)
 *          [1] read       frames consumed, wrapping int32 (consumer)
 *          [2] dropped    frames lost to a full ring, cumulative (producer)
 *          [3] state      IDLE → RECORDING → DONE (producer)
 *          [4] channels   1 or 2
 *          [5] capacity   frames, a power of two
 *   F64    [3] startFrame context frame of the first captured sample (bytes 24..31)
 *          [4] endFrame   context frame after the last one, set with DONE (bytes 32..39)
 *   F32    from byte 64   interleaved frames, `capacity * channels` floats
 *
 * Interleaved because WAV is: the worker copies a drained span straight into
 * the file. `startFrame` is written before the first `written` store, so a
 * reader that sees frames also sees the tag (Atomics.store is a release).
 *
 * A block that does not fit is dropped whole and counted, and so is every
 * block after it until the reader releases frames. The reader loads `dropped`
 * before `written`, so every frame a drain returns is older than every drop it
 * reports: the worker writes what it drained, then the newly dropped count as
 * silence, and the take stays aligned to the timeline.
 *
 * Real-time code: no allocation after construction, ES2022 only.
 */

/** `registerProcessor` name of `src/audio-worklets/recorder-processor.ts`. */
export const RECORDER_PROCESSOR_NAME = 'recorder-processor';

/** Main thread → recorder worklet (`node.port`). Context frames; omitted = the next block. */
export type RecorderControl =
    | { t: 'start'; atFrame?: number }
    | { t: 'stop'; atFrame?: number };

/** Recorder worklet → main thread (`node.port`). */
export type RecorderStatus =
    | { t: 'started'; frame: number }
    | { t: 'stopped'; startFrame: number; endFrame: number; frames: number; dropped: number };

/**
 * Recorder worklet → take writer worker, on a port handed to both, when the
 * page has no SharedArrayBuffer. `takeStart` is the take's first frame.
 */
export type RecorderFeed =
    | { t: 'frames'; data: Float32Array<ArrayBuffer>; frames: number; takeStart: number }
    | { t: 'done'; endFrame: number };

export const TAKE_RING_HEADER_BYTES = 64;

export const TAKE_STATE_IDLE = 0;
export const TAKE_STATE_RECORDING = 1;
export const TAKE_STATE_DONE = 2;

const WRITTEN = 0;
const READ = 1;
const DROPPED = 2;
const STATE = 3;
const CHANNELS = 4;
const CAPACITY = 5;
const START_FRAME = 3;
const END_FRAME = 4;

/** Bytes of a ring holding `capacity` frames of `channels` channels. */
export function takeRingBytes(capacity: number, channels: number): number {
    return TAKE_RING_HEADER_BYTES + capacity * channels * Float32Array.BYTES_PER_ELEMENT;
}

function isPowerOfTwo(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
}

/** Shared views and header access; both ends construct one over the same buffer. */
class TakeRingBase {
    protected readonly ints: Int32Array;
    protected readonly floats64: Float64Array;
    protected readonly data: Float32Array;
    readonly capacity: number;
    readonly channels: number;
    protected readonly mask: number;

    constructor(sab: SharedArrayBuffer) {
        this.ints = new Int32Array(sab, 0, 8);
        this.floats64 = new Float64Array(sab, 0, 8);
        this.capacity = Atomics.load(this.ints, CAPACITY);
        this.channels = Atomics.load(this.ints, CHANNELS);
        if (!isPowerOfTwo(this.capacity) || (this.channels !== 1 && this.channels !== 2)) {
            throw new Error('take ring: uninitialised header');
        }
        this.mask = this.capacity - 1;
        this.data = new Float32Array(sab, TAKE_RING_HEADER_BYTES, this.capacity * this.channels);
    }

    state(): number {
        return Atomics.load(this.ints, STATE);
    }

    dropped(): number {
        return Atomics.load(this.ints, DROPPED);
    }

    /** Frames written and not yet read. */
    readable(): number {
        return (Atomics.load(this.ints, WRITTEN) - Atomics.load(this.ints, READ)) | 0;
    }

    /** Context frame of the first captured sample; meaningful once a frame is readable or the state is DONE. */
    startFrame(): number {
        return this.floats64[START_FRAME];
    }

    endFrame(): number {
        return this.floats64[END_FRAME];
    }
}

/** Allocate and initialise a ring. Main thread (or a test). */
export function createTakeRing(capacity: number, channels: number): SharedArrayBuffer {
    if (!isPowerOfTwo(capacity)) throw new Error('take ring capacity must be a power of two');
    if (channels !== 1 && channels !== 2) throw new Error('take ring holds 1 or 2 channels');
    const sab = new SharedArrayBuffer(takeRingBytes(capacity, channels));
    const ints = new Int32Array(sab, 0, 8);
    Atomics.store(ints, CHANNELS, channels);
    Atomics.store(ints, CAPACITY, capacity);
    Atomics.store(ints, STATE, TAKE_STATE_IDLE);
    return sab;
}

/** Producer side: the recorder worklet. */
export class TakeRingWriter extends TakeRingBase {
    private started = false;
    /** The `read` count when a block was dropped; writes resume once it moves. */
    private blockedAt = 0;
    private blocked = false;

    /**
     * Append `count` frames of `l` / `r` from `offset` (pass `r === l` for
     * mono input into a stereo ring; a mono ring ignores `r`). `frame` is the
     * context frame of the first of them. Returns false when the block did not
     * fit and was dropped.
     */
    write(l: Float32Array, r: Float32Array, offset: number, count: number, frame: number): boolean {
        if (count <= 0) return true;
        if (!this.started) {
            this.started = true;
            this.floats64[START_FRAME] = frame;
            Atomics.store(this.ints, STATE, TAKE_STATE_RECORDING);
        }
        const written = Atomics.load(this.ints, WRITTEN);
        const read = Atomics.load(this.ints, READ);
        if (this.blocked && read === this.blockedAt) {
            Atomics.add(this.ints, DROPPED, count);
            return false;
        }
        this.blocked = false;
        if (this.capacity - ((written - read) | 0) < count) {
            this.blocked = true;
            this.blockedAt = read;
            Atomics.add(this.ints, DROPPED, count);
            return false;
        }
        const data = this.data;
        const mask = this.mask;
        if (this.channels === 2) {
            for (let i = 0; i < count; i++) {
                const at = ((written + i) & mask) * 2;
                data[at] = l[offset + i];
                data[at + 1] = r[offset + i];
            }
        } else {
            for (let i = 0; i < count; i++) data[(written + i) & mask] = l[offset + i];
        }
        Atomics.store(this.ints, WRITTEN, (written + count) | 0);
        return true;
    }

    /** True once the first frame was written. */
    hasStarted(): boolean {
        return this.started;
    }

    /** The take ended at context frame `endFrame` (exclusive). A take with no frames tags its start there too. */
    finish(endFrame: number): void {
        if (!this.started) {
            this.started = true;
            this.floats64[START_FRAME] = endFrame;
        }
        this.floats64[END_FRAME] = endFrame;
        Atomics.store(this.ints, STATE, TAKE_STATE_DONE);
    }
}

/** Consumer side: the take writer worker. */
export class TakeRingReader extends TakeRingBase {
    /** Dropped frames already handed out by `drain`. */
    private droppedSeen = 0;

    /**
     * Copy every readable frame (interleaved) into `out`, which must hold
     * `capacity * channels` floats, and release them. Returns the frames
     * copied and the frames dropped since the last drain, which belong after
     * them.
     */
    drain(out: Float32Array): { frames: number; dropped: number } {
        // `dropped` first: see the ordering note at the top of the file.
        const dropped = Atomics.load(this.ints, DROPPED);
        const written = Atomics.load(this.ints, WRITTEN);
        const read = Atomics.load(this.ints, READ);
        const frames = (written - read) | 0;
        const ch = this.channels;
        if (frames > 0) {
            const from = (read & this.mask) * ch;
            const first = Math.min(frames * ch, this.data.length - from);
            out.set(this.data.subarray(from, from + first), 0);
            if (first < frames * ch) out.set(this.data.subarray(0, frames * ch - first), first);
            Atomics.store(this.ints, READ, written);
        }
        const newlyDropped = (dropped - this.droppedSeen) | 0;
        this.droppedSeen = dropped;
        return { frames: Math.max(0, frames), dropped: Math.max(0, newlyDropped) };
    }
}
