import { describe, expect, it } from 'vitest';
import {
    TAKE_STATE_DONE,
    TAKE_STATE_IDLE,
    TAKE_STATE_RECORDING,
    TakeRingReader,
    TakeRingWriter,
    createTakeRing,
} from '../takeRing';

const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i);

describe('take ring', () => {
    it('carries interleaved stereo frames across the wrap, tagged with the first frame', () => {
        const sab = createTakeRing(16, 2);
        const w = new TakeRingWriter(sab);
        const r = new TakeRingReader(sab);
        const out = new Float32Array(32);
        expect(r.state()).toBe(TAKE_STATE_IDLE);

        expect(w.write(ramp(0, 12), ramp(100, 12), 0, 12, 4800)).toBe(true);
        expect(r.state()).toBe(TAKE_STATE_RECORDING);
        expect(r.startFrame()).toBe(4800);
        expect(r.drain(out)).toEqual({ frames: 12, dropped: 0 });
        expect(Array.from(out.subarray(0, 6))).toEqual([0, 100, 1, 101, 2, 102]);

        // 10 more frames: 4 before the end of the buffer, 6 wrapped.
        expect(w.write(ramp(12, 10), ramp(112, 10), 0, 10, 4812)).toBe(true);
        expect(r.drain(out)).toEqual({ frames: 10, dropped: 0 });
        const left = Array.from({ length: 10 }, (_, i) => out[i * 2]);
        const right = Array.from({ length: 10 }, (_, i) => out[i * 2 + 1]);
        expect(left).toEqual(Array.from(ramp(12, 10)));
        expect(right).toEqual(Array.from(ramp(112, 10)));
        expect(r.startFrame()).toBe(4800);

        w.finish(4822);
        expect(r.state()).toBe(TAKE_STATE_DONE);
        expect(r.endFrame()).toBe(4822);
    });

    it('writes a mono ring from the left channel, with an offset into the block', () => {
        const sab = createTakeRing(8, 1);
        const w = new TakeRingWriter(sab);
        const r = new TakeRingReader(sab);
        const out = new Float32Array(8);
        w.write(ramp(0, 8), ramp(50, 8), 3, 5, 103);
        expect(r.startFrame()).toBe(103);
        expect(r.drain(out).frames).toBe(5);
        expect(Array.from(out.subarray(0, 5))).toEqual([3, 4, 5, 6, 7]);
    });

    it('drops whole blocks when full, keeps dropping until the reader frees space, and reports them after the frames', () => {
        const sab = createTakeRing(8, 1);
        const w = new TakeRingWriter(sab);
        const r = new TakeRingReader(sab);
        const out = new Float32Array(8);
        expect(w.write(ramp(0, 4), ramp(0, 4), 0, 4, 0)).toBe(true);
        expect(w.write(ramp(4, 4), ramp(4, 4), 0, 4, 4)).toBe(true);
        expect(w.write(ramp(8, 4), ramp(8, 4), 0, 4, 8)).toBe(false); // full
        // A smaller block would fit nowhere either; but even a 0-space-needed retry is blocked until a drain.
        expect(w.write(ramp(12, 1), ramp(12, 1), 0, 1, 12)).toBe(false);
        expect(r.dropped()).toBe(5);

        expect(r.drain(out)).toEqual({ frames: 8, dropped: 5 });
        expect(Array.from(out)).toEqual(Array.from(ramp(0, 8)));
        // Space again: writing resumes, and the drop is not reported twice.
        expect(w.write(ramp(13, 2), ramp(13, 2), 0, 2, 13)).toBe(true);
        expect(r.drain(out)).toEqual({ frames: 2, dropped: 0 });
        expect(Array.from(out.subarray(0, 2))).toEqual([13, 14]);
    });

    it('keeps counting across the int32 wrap of its frame counters', () => {
        const sab = createTakeRing(8, 1);
        const ints = new Int32Array(sab, 0, 8);
        // Both counters just below 2^31: the next writes overflow to negative.
        ints[0] = 0x7ffffffc;
        ints[1] = 0x7ffffffc;
        const w = new TakeRingWriter(sab);
        const r = new TakeRingReader(sab);
        const out = new Float32Array(8);
        expect(w.write(ramp(1, 6), ramp(1, 6), 0, 6, 0)).toBe(true);
        expect(r.readable()).toBe(6);
        expect(r.drain(out).frames).toBe(6);
        expect(Array.from(out.subarray(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
        expect(w.write(ramp(7, 8), ramp(7, 8), 0, 8, 6)).toBe(true);
        expect(r.drain(out).frames).toBe(8);
        expect(Array.from(out)).toEqual(Array.from(ramp(7, 8)));
    });

    it('tags an empty take with its end frame', () => {
        const sab = createTakeRing(8, 2);
        const w = new TakeRingWriter(sab);
        w.finish(960);
        const r = new TakeRingReader(sab);
        expect(r.startFrame()).toBe(960);
        expect(r.state()).toBe(TAKE_STATE_DONE);
    });

    it('rejects a capacity that is not a power of two', () => {
        expect(() => createTakeRing(12, 2)).toThrow(/power of two/);
        expect(() => createTakeRing(8, 3)).toThrow(/1 or 2/);
    });
});
