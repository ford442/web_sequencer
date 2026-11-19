// src/audio-worklets/recorder-processor.ts
// Input recorder (#1498 P1): captures its input from a context frame on, into
// the take ring (`src/shared/rt/takeRing.ts`) that the take writer worker
// drains into OPFS. The first captured sample's context frame tags the take,
// so a take lines up with the clock that stamps the notes.
//
//   start { atFrame? }  capture from `atFrame` (sample-exact inside a block),
//                       or from the next block
//   stop  { atFrame? }  capture up to `atFrame` (exclusive), or the next block;
//                       a stop that arrives late still ends the take on its
//                       frame (the writer trims what was captured past it)
//
// Without SharedArrayBuffer the frames go in chunks to a port handed straight
// to the worker (`{ t: 'feed', port }`), so they never cross the main thread.
// Posting a chunk allocates; the ring path allocates nothing per block.
//
// The node needs an output path to the destination to be pulled; it writes
// nothing to its output (the caller cables it into a muted gain).

import {
    RECORDER_PROCESSOR_NAME,
    TakeRingWriter,
    type RecorderControl,
    type RecorderFeed,
    type RecorderStatus,
} from '../shared/rt/takeRing';

interface Options {
    channels: number;
    ring: SharedArrayBuffer | null;
    /** Frames per posted chunk on the port path. */
    chunkFrames?: number;
}

type Message = RecorderControl | { t: 'feed'; port: MessagePort };

const NEXT_BLOCK = -1;
const UNSET = -2;
const IDLE = 0;
const ARMED = 1;
const DONE = 2;

class RecorderProcessor extends AudioWorkletProcessor {
    private readonly channels: number;
    private readonly ring: TakeRingWriter | null;
    private feed: MessagePort | null = null;
    private readonly chunk: Float32Array<ArrayBuffer> | null;
    private readonly chunkFrames: number;
    private chunkFill = 0;
    private silence = new Float32Array(128);
    private phase = IDLE;
    private startAt = UNSET;
    private stopAt = UNSET;
    private startFrame = -1;
    private frames = 0;
    private dropped = 0;

    constructor(options: { processorOptions?: Options }) {
        super();
        const opts = options.processorOptions ?? { channels: 2, ring: null };
        this.channels = opts.channels === 1 ? 1 : 2;
        this.ring = opts.ring ? new TakeRingWriter(opts.ring) : null;
        this.chunkFrames = Math.max(128, Math.floor(opts.chunkFrames ?? 8192));
        this.chunk = this.ring ? null : new Float32Array(this.chunkFrames * this.channels);
        this.port.onmessage = (e: MessageEvent<Message>) => this.onMessage(e.data);
    }

    private onMessage(msg: Message): void {
        switch (msg.t) {
            case 'feed':
                this.feed = msg.port;
                break;
            case 'start':
                if (this.phase !== IDLE) return;
                this.startAt = typeof msg.atFrame === 'number' ? Math.round(msg.atFrame) : NEXT_BLOCK;
                this.phase = ARMED;
                break;
            case 'stop':
                if (this.phase === DONE) return;
                if (this.phase === IDLE) {
                    // Stopped before it was armed: an empty take.
                    this.phase = ARMED;
                    this.startAt = NEXT_BLOCK;
                }
                this.stopAt = typeof msg.atFrame === 'number' ? Math.round(msg.atFrame) : NEXT_BLOCK;
                break;
        }
    }

    private status(msg: RecorderStatus): void {
        this.port.postMessage(msg);
    }

    private flushChunk(): void {
        const chunk = this.chunk;
        if (!chunk || this.chunkFill === 0) return;
        const msg: RecorderFeed = {
            t: 'frames',
            data: chunk.slice(0, this.chunkFill * this.channels),
            frames: this.chunkFill,
            takeStart: this.startFrame,
        };
        this.feed?.postMessage(msg, [msg.data.buffer]);
        this.chunkFill = 0;
    }

    private capture(l: Float32Array, r: Float32Array, offset: number, count: number, frame: number): void {
        if (this.startFrame < 0) {
            this.startFrame = frame;
            this.status({ t: 'started', frame });
        }
        this.frames += count;
        if (this.ring) {
            if (!this.ring.write(l, r, offset, count, frame)) this.dropped += count;
            return;
        }
        const chunk = this.chunk!;
        const ch = this.channels;
        for (let i = 0; i < count; i++) {
            const at = this.chunkFill * ch;
            chunk[at] = l[offset + i];
            if (ch === 2) chunk[at + 1] = r[offset + i];
            if (++this.chunkFill === this.chunkFrames) this.flushChunk();
        }
    }

    private finish(endFrame: number): void {
        if (this.startFrame < 0) this.startFrame = endFrame;
        if (this.ring) {
            this.ring.finish(endFrame);
        } else {
            this.flushChunk();
            const done: RecorderFeed = { t: 'done', endFrame };
            this.feed?.postMessage(done);
        }
        this.phase = DONE;
        // A stop that arrived after its frame: the frames past it are in the ring, and the writer trims them.
        const frames = Math.min(this.frames, Math.max(0, endFrame - this.startFrame));
        this.status({ t: 'stopped', startFrame: this.startFrame, endFrame, frames, dropped: Math.min(this.dropped, frames) });
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (this.phase === DONE) return false;
        if (this.phase === IDLE) return true;
        const input = inputs[0];
        const n = input?.[0]?.length ?? outputs[0]?.[0]?.length ?? 128;
        if (this.silence.length < n) this.silence = new Float32Array(n);
        const l = input?.[0] ?? this.silence;
        const r = input?.[1] ?? l;
        const blockStart = currentFrame;
        const blockEnd = blockStart + n;
        if (this.startAt === NEXT_BLOCK) this.startAt = blockStart;
        if (this.stopAt === NEXT_BLOCK) this.stopAt = blockStart;
        if (this.stopAt !== UNSET && this.stopAt <= this.startAt) {
            // Stopped before it started: an empty take, tagged at its start.
            this.finish(this.startAt);
            return false;
        }
        const from = Math.max(this.startAt, blockStart);
        const to = this.stopAt !== UNSET ? Math.min(this.stopAt, blockEnd) : blockEnd;
        if (to > from) this.capture(l, r, from - blockStart, to - from, from);
        if (this.stopAt !== UNSET && blockEnd >= this.stopAt) {
            this.finish(this.stopAt);
            return false;
        }
        return true;
    }
}

registerProcessor(RECORDER_PROCESSOR_NAME, RecorderProcessor);
