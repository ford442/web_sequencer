import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RECORDER_PROCESSOR_NAME, TakeRingReader, createTakeRing, type RecorderFeed, type RecorderStatus } from '../../shared/rt/takeRing';
import { TakeFileWriter } from '../../audio/recording/takeFileWriter';
import { MemTakeFile } from '../../audio/recording/__tests__/memTakeFile';
import { decodeWav } from '../../audio/media/wav';

/**
 * recorder-processor (#1498 P1), run block by block as the audio thread would:
 * it captures from a context frame to a context frame, sample-exact inside a
 * block, tags the take with its first frame, and its frames reach the file
 * unchanged — through the SAB ring, or through chunks on the worker's port.
 */

const BLOCK = 128;
const RATE = 48000;

class FakePort {
    onmessage: ((e: MessageEvent) => unknown) | null = null;
    readonly posted: unknown[] = [];
    postMessage(msg: unknown) {
        this.posted.push(msg);
    }
    deliver(data: unknown) {
        this.onmessage?.({ data } as MessageEvent);
    }
}

type Recorder = {
    port: FakePort;
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};
type RecorderCtor = new (options: { processorOptions: { channels: number; ring: SharedArrayBuffer | null; chunkFrames?: number } }) => Recorder;

const g = globalThis as unknown as {
    currentFrame?: number;
    sampleRate?: number;
    AudioWorkletProcessor?: unknown;
    registerProcessor?: (name: string, ctor: RecorderCtor) => void;
};
let Ctor: RecorderCtor;

beforeAll(async () => {
    g.AudioWorkletProcessor = class {
        readonly port = new FakePort();
    };
    g.registerProcessor = (name, ctor) => {
        if (name === RECORDER_PROCESSOR_NAME) Ctor = ctor;
    };
    g.sampleRate = RATE;
    await import('../recorder-processor');
});

afterAll(() => {
    delete g.currentFrame;
    delete g.sampleRate;
});

/** Input whose every sample is its own context frame (L) and its negative (R): position is readable from the file. */
function block(frame: number): Float32Array[] {
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) {
        l[i] = frame + i;
        r[i] = -(frame + i);
    }
    return [l, r];
}

/** Run blocks from `from` until the processor returns false (or `maxBlocks`). */
function run(node: Recorder, from: number, maxBlocks: number, each?: () => void): number {
    let frame = from;
    for (let b = 0; b < maxBlocks; b++) {
        g.currentFrame = frame;
        const alive = node.process([block(frame)], [[new Float32Array(BLOCK)]]);
        each?.();
        frame += BLOCK;
        if (!alive) break;
    }
    return frame;
}

describe('recorder-processor', () => {
    it('captures [start, stop) sample-exact into the ring and the file', () => {
        const sab = createTakeRing(1 << 12, 2);
        const node = new Ctor({ processorOptions: { channels: 2, ring: sab } });
        const reader = new TakeRingReader(sab);
        const file = new MemTakeFile();
        const writer = new TakeFileWriter(file, { sampleRate: RATE, channels: 2 });
        const scratch = new Float32Array(reader.capacity * 2);
        const drain = () => {
            const { frames, dropped } = reader.drain(scratch);
            writer.append(scratch, frames);
            writer.appendSilence(dropped);
        };

        // Idle: nothing captured.
        run(node, 0, 4, drain);
        expect(writer.frames).toBe(0);

        const startAt = 1024 + 37;
        const stopAt = 9600 + 5;
        node.port.deliver({ t: 'start', atFrame: startAt });
        node.port.deliver({ t: 'stop', atFrame: stopAt });
        run(node, 1024 - BLOCK * 2, 200, drain);
        drain();
        writer.finish();

        const status = node.port.posted as RecorderStatus[];
        expect(status[0]).toEqual({ t: 'started', frame: startAt });
        expect(status[1]).toEqual({ t: 'stopped', startFrame: startAt, endFrame: stopAt, frames: stopAt - startAt, dropped: 0 });
        expect(reader.startFrame()).toBe(startAt);
        expect(reader.endFrame()).toBe(stopAt);

        const decoded = decodeWav(file.bytes)!;
        const [l, r] = decoded.channels;
        expect(l.length).toBe(stopAt - startAt);
        expect(l[0]).toBe(startAt);
        expect(r[0]).toBe(-startAt);
        expect(l[l.length - 1]).toBe(stopAt - 1);
        // Every frame in order: no gap, no repeat.
        for (let i = 0; i < l.length; i++) {
            if (l[i] !== startAt + i) throw new Error(`frame ${i} is ${l[i]}, expected ${startAt + i}`);
        }
    });

    it('starts on the next block when no frame is given, and stops on the next block', () => {
        const sab = createTakeRing(1 << 10, 1);
        const node = new Ctor({ processorOptions: { channels: 1, ring: sab } });
        node.port.deliver({ t: 'start' });
        const frame = run(node, 256, 3);
        node.port.deliver({ t: 'stop' });
        run(node, frame, 3);
        const stopped = (node.port.posted as RecorderStatus[]).find((m) => m.t === 'stopped');
        expect(stopped).toEqual({ t: 'stopped', startFrame: 256, endFrame: 256 + 3 * BLOCK, frames: 3 * BLOCK, dropped: 0 });
    });

    it('counts a full ring as dropped frames, so the writer can fill them with silence in place', () => {
        const sab = createTakeRing(256, 2);
        const node = new Ctor({ processorOptions: { channels: 2, ring: sab } });
        const reader = new TakeRingReader(sab);
        node.port.deliver({ t: 'start', atFrame: 0 });
        node.port.deliver({ t: 'stop', atFrame: 6 * BLOCK });
        const file = new MemTakeFile();
        const writer = new TakeFileWriter(file, { sampleRate: RATE, channels: 2 });
        const scratch = new Float32Array(512);
        let blocks = 0;
        // The worker stalls for the first 4 blocks: blocks 3 and 4 do not fit.
        run(node, 0, 10, () => {
            if (++blocks < 4) return;
            const { frames, dropped } = reader.drain(scratch);
            writer.append(scratch, frames);
            writer.appendSilence(dropped);
        });
        writer.finish();
        const stopped = (node.port.posted as RecorderStatus[]).find((m) => m.t === 'stopped');
        expect(stopped).toMatchObject({ frames: 6 * BLOCK, dropped: 2 * BLOCK });
        const l = decodeWav(file.bytes)!.channels[0];
        expect(l.length).toBe(6 * BLOCK);
        expect(l[2 * BLOCK - 1]).toBe(2 * BLOCK - 1);
        expect(l[2 * BLOCK]).toBe(0); // dropped → silence
        expect(l[4 * BLOCK - 1]).toBe(0);
        expect(l[4 * BLOCK]).toBe(4 * BLOCK); // back in place
        expect(l[6 * BLOCK - 1]).toBe(6 * BLOCK - 1);
    });

    it('without a SharedArrayBuffer, posts chunks on the feed port and ends with done', () => {
        const node = new Ctor({ processorOptions: { channels: 2, ring: null, chunkFrames: 300 } });
        const feed = new FakePort();
        node.port.deliver({ t: 'feed', port: feed });
        node.port.deliver({ t: 'start', atFrame: 50 });
        node.port.deliver({ t: 'stop', atFrame: 50 + 1000 });
        run(node, 0, 20);
        const msgs = feed.posted as RecorderFeed[];
        const frames = msgs.filter((m): m is Extract<RecorderFeed, { t: 'frames' }> => m.t === 'frames');
        expect(frames.map((m) => m.frames)).toEqual([300, 300, 300, 100]);
        expect(frames.every((m) => m.takeStart === 50)).toBe(true);
        expect(msgs[msgs.length - 1]).toEqual({ t: 'done', endFrame: 1050 });
        const file = new MemTakeFile();
        const writer = new TakeFileWriter(file, { sampleRate: RATE, channels: 2 });
        for (const m of frames) writer.append(m.data, m.frames);
        writer.finish();
        const l = decodeWav(file.bytes)!.channels[0];
        expect(l.length).toBe(1000);
        expect(l[0]).toBe(50);
        expect(l[999]).toBe(1049);
    });

    it('a stop that arrives after its frame still ends the take on it', () => {
        const sab = createTakeRing(1 << 12, 2);
        const node = new Ctor({ processorOptions: { channels: 2, ring: sab } });
        const reader = new TakeRingReader(sab);
        node.port.deliver({ t: 'start', atFrame: 0 });
        let frame = run(node, 0, 10); // 1280 frames captured
        node.port.deliver({ t: 'stop', atFrame: 700 });
        frame = run(node, frame, 2);
        const stopped = (node.port.posted as RecorderStatus[]).find((m) => m.t === 'stopped');
        expect(stopped).toEqual({ t: 'stopped', startFrame: 0, endFrame: 700, frames: 700, dropped: 0 });
        // The ring holds what was captured; the writer trims to endFrame - startFrame.
        expect(reader.readable()).toBe(1280);
        expect(reader.endFrame()).toBe(700);
        expect(frame).toBe(1280 + BLOCK);
    });

    it('a stop before the first block is an empty take tagged at its end', () => {
        const sab = createTakeRing(256, 2);
        const node = new Ctor({ processorOptions: { channels: 2, ring: sab } });
        node.port.deliver({ t: 'start', atFrame: 1000 });
        node.port.deliver({ t: 'stop', atFrame: 500 });
        run(node, 384, 4);
        expect((node.port.posted as RecorderStatus[]).at(-1)).toEqual({ t: 'stopped', startFrame: 1000, endFrame: 1000, frames: 0, dropped: 0 });
    });
});
