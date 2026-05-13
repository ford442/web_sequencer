// src/__tests__/PhonemeBufferPool.test.ts
// Tests for the pre-stretched phoneme buffer pool.
//
// Coverage:
//   1. clampStretchRatio boundary values (from PhonemeStretchWorker)
//   2. PhonemeBufferPool.getNearest — exact hit, nearest miss, empty pool
//   3. Integration smoke — pool stores and retrieves a pre-warmed buffer

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    clampStretchRatio,
    STRETCH_RATIO_MIN,
    STRETCH_RATIO_MAX,
} from '../workers/PhonemeStretchWorker';
import { PhonemeBufferPool, DEFAULT_DURATION_GRID_MS } from '../services/PhonemeBufferPool';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock AudioBuffer for injection into pool internals. */
function makeMockAudioBuffer(length: number, numChannels = 1, sampleRate = 44100): AudioBuffer {
    return {
        length,
        numberOfChannels: numChannels,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: vi.fn(() => new Float32Array(length)),
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
    } as unknown as AudioBuffer;
}

// ---------------------------------------------------------------------------
// 1. Stretch ratio clamping (PhonemeStretchWorker helpers)
// ---------------------------------------------------------------------------

describe('clampStretchRatio', () => {
    it('passes through a ratio within [0.1, 8.0] unchanged', () => {
        expect(clampStretchRatio(1.0)).toBe(1.0);
        expect(clampStretchRatio(0.5)).toBe(0.5);
        expect(clampStretchRatio(4.0)).toBe(4.0);
    });

    it('returns exactly STRETCH_RATIO_MIN (0.1) at the lower boundary', () => {
        expect(clampStretchRatio(STRETCH_RATIO_MIN)).toBe(STRETCH_RATIO_MIN);
    });

    it('returns exactly STRETCH_RATIO_MAX (8.0) at the upper boundary', () => {
        expect(clampStretchRatio(STRETCH_RATIO_MAX)).toBe(STRETCH_RATIO_MAX);
    });

    it('clamps a ratio below 0.1 to 0.1 and emits console.warn', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = clampStretchRatio(0.01);
        expect(result).toBe(STRETCH_RATIO_MIN);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('clamps a ratio above 8.0 to 8.0 and emits console.warn', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = clampStretchRatio(10.0);
        expect(result).toBe(STRETCH_RATIO_MAX);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('does NOT emit console.warn for an in-range ratio', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        clampStretchRatio(2.0);
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// 2. PhonemeBufferPool.getNearest
// ---------------------------------------------------------------------------

describe('PhonemeBufferPool.getNearest', () => {
    let pool: PhonemeBufferPool;

    beforeEach(() => {
        pool = new PhonemeBufferPool();
        // Bypass init — tests inject directly into the internal pool map.
    });

    /** Inject a fake AudioBuffer at a given (phonemeId, targetMs) key. */
    function inject(phonemeId: string, targetMs: number, length = 4410): void {
        const internalPool = (pool as any).pool as Map<string, Map<number, AudioBuffer>>;
        if (!internalPool.has(phonemeId)) {
            internalPool.set(phonemeId, new Map());
        }
        internalPool.get(phonemeId)!.set(targetMs, makeMockAudioBuffer(length));
    }

    it('returns null when the pool contains no entry for the phoneme', () => {
        expect(pool.getNearest('unknown', 100)).toBeNull();
    });

    it('returns null when the phoneme map exists but is empty', () => {
        const internalPool = (pool as any).pool as Map<string, Map<number, AudioBuffer>>;
        internalPool.set('ph1', new Map());
        expect(pool.getNearest('ph1', 100)).toBeNull();
    });

    it('returns the buffer on an exact duration match', () => {
        inject('ph1', 100, 4410);
        const result = pool.getNearest('ph1', 100);
        expect(result).not.toBeNull();
        expect(result!.length).toBe(4410);
    });

    it('returns the nearest buffer when the target does not exactly match', () => {
        inject('ph1', 100, 4410);  // 100 ms buffer (shorter)
        inject('ph1', 200, 8820);  // 200 ms buffer (longer)

        // 120 ms is closer to 100 ms than to 200 ms
        const result = pool.getNearest('ph1', 120);
        expect(result).not.toBeNull();
        expect(result!.length).toBe(4410); // expect the 100 ms buffer

        // 170 ms is closer to 200 ms
        const result2 = pool.getNearest('ph1', 170);
        expect(result2).not.toBeNull();
        expect(result2!.length).toBe(8820); // expect the 200 ms buffer
    });

    it('handles a pool with only one entry (no ambiguity)', () => {
        inject('ph1', 150, 6615);
        const result = pool.getNearest('ph1', 999); // far from 150, still returns only entry
        expect(result).not.toBeNull();
        expect(result!.length).toBe(6615);
    });
});

// ---------------------------------------------------------------------------
// 3. Integration smoke — pool warming via simulated worker response
// ---------------------------------------------------------------------------

describe('PhonemeBufferPool integration smoke', () => {
    it('stores and retrieves a pre-warmed AudioBuffer via simulated worker message', () => {
        const mockCtx = {
            createBuffer: vi.fn((channels: number, length: number, sampleRate: number) =>
                makeMockAudioBuffer(length, channels, sampleRate)
            ),
        } as unknown as AudioContext;

        const pool = new PhonemeBufferPool();
        pool.init(mockCtx, [...DEFAULT_DURATION_GRID_MS]);

        // Simulate the worker responding with a 100 ms stretched buffer
        const targetMs = 100;
        const sampleRate = 44100;
        const length = Math.round((targetMs / 1000) * sampleRate); // 4410 samples
        const fakeChannels = [new Float32Array(length)];
        // Fill with non-silent data so we can verify it's non-silent
        fakeChannels[0].fill(0.5);

        const fakeEvent = {
            data: { phonemeId: 'bank_0_0', targetMs, channels: fakeChannels, sampleRate },
        } as MessageEvent;

        // Invoke the private handler directly (simulates worker postMessage)
        (pool as any).handleWorkerMessage(fakeEvent);

        // Pool should now have an entry for this phoneme
        const result = pool.getNearest('bank_0_0', targetMs);
        expect(result).not.toBeNull();
        expect(result!.length).toBe(length);
        expect(result!.numberOfChannels).toBe(1);
        expect(result!.sampleRate).toBe(sampleRate);
    });

    it('returns null before any warming has occurred', () => {
        const pool = new PhonemeBufferPool();
        expect(pool.getNearest('bank_0_0', 100)).toBeNull();
    });

    it('clear() removes all cached buffers', () => {
        const mockCtx = {
            createBuffer: vi.fn((_c: number, len: number, sr: number) =>
                makeMockAudioBuffer(len, 1, sr)
            ),
        } as unknown as AudioContext;

        const pool = new PhonemeBufferPool();
        pool.init(mockCtx);

        // Inject a buffer then clear
        const fakeEvent = {
            data: {
                phonemeId: 'ph1',
                targetMs: 100,
                channels: [new Float32Array(4410)],
                sampleRate: 44100,
            },
        } as MessageEvent;
        (pool as any).handleWorkerMessage(fakeEvent);

        expect(pool.getNearest('ph1', 100)).not.toBeNull();

        pool.clear();
        expect(pool.getNearest('ph1', 100)).toBeNull();
    });
});
