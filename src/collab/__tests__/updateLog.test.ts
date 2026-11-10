import { describe, expect, it } from 'vitest';
import { appendToUpdateLog, decodeUpdateLog, encodeUpdateLog } from '../updateLog';

const frame = (...bytes: number[]) => Uint8Array.from(bytes);

describe('doc update log', () => {
    it('round-trips frames, including empty ones', () => {
        const frames = [frame(1, 2, 3), frame(), frame(255)];
        expect(decodeUpdateLog(encodeUpdateLog(frames))).toEqual({ frames, tornBytes: 0 });
        expect(decodeUpdateLog(encodeUpdateLog([]))).toEqual({ frames: [], tornBytes: 0 });
    });

    it('appends to an existing log, or starts one', () => {
        const log = appendToUpdateLog(appendToUpdateLog(null, frame(1)), frame(2, 2));
        expect(decodeUpdateLog(log)?.frames).toEqual([frame(1), frame(2, 2)]);
        expect(decodeUpdateLog(appendToUpdateLog(frame(9, 9, 9), frame(7)))?.frames).toEqual([frame(7)]);
    });

    it('drops a torn last frame and appends after the last whole one', () => {
        const whole = encodeUpdateLog([frame(1, 1), frame(2, 2, 2)]);
        for (let cut = 1; cut < 7; cut++) {
            const torn = whole.slice(0, whole.byteLength - cut);
            const decoded = decodeUpdateLog(torn);
            expect(decoded?.frames).toEqual([frame(1, 1)]);
            expect(decoded?.tornBytes).toBe(torn.byteLength - (5 + 4 + 2));
            expect(decodeUpdateLog(appendToUpdateLog(torn, frame(3)))?.frames).toEqual([frame(1, 1), frame(3)]);
        }
    });

    it('refuses bytes that are not a log of this format', () => {
        expect(decodeUpdateLog(frame())).toBeNull();
        expect(decodeUpdateLog(new TextEncoder().encode('{"json":true}'))).toBeNull();
        const future = encodeUpdateLog([frame(1)]);
        future[4] = 99;
        expect(decodeUpdateLog(future)).toBeNull();
    });

    it('reads a log that sits at an offset inside a larger buffer', () => {
        const log = encodeUpdateLog([frame(4, 5)]);
        const padded = new Uint8Array(log.byteLength + 3);
        padded.set(log, 3);
        expect(decodeUpdateLog(padded.subarray(3))?.frames).toEqual([frame(4, 5)]);
    });
});
