/**
 * `WebGpuBackend` adapter (#1668): the band-limited table set from one GPU
 * pass, band selection on the note path, and failing closed.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WebGpuBackend } from '../adapters';
import type { WavetableSet, WebGpuOscillator } from '../../WebGpuOscillator';
import { WAVETABLE_LENGTH, planWavetableBands, selectWavetableBand } from '../wavetableBands';
import type { GenerateRequest } from '../OscillatorBackend';
import type { WaveShape } from '../../../utils/waveformParser';

const SR = 48000;

function makeCtx(): AudioContext {
    return {
        sampleRate: SR,
        createBuffer: (channels: number, length: number, sampleRate: number) => {
            const data = new Float32Array(length);
            return { length, numberOfChannels: channels, sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
        },
    } as unknown as AudioContext;
}

/** A real band plan; each table is filled with its band index so tests can tell them apart. */
function makeSet(override: Partial<Record<WaveShape, Float32Array[]>> = {}): WavetableSet {
    const bands = planWavetableBands(SR);
    const shape = () => bands.map((_, i) => new Float32Array(WAVETABLE_LENGTH).fill(i / 100));
    return {
        sampleRate: SR,
        length: WAVETABLE_LENGTH,
        bands,
        tables: { saw: shape(), sqr: shape(), tri: shape(), sin: shape(), ...override },
        renderMs: 2.5,
    };
}

function stubEngine(set: WavetableSet | null, supported = true) {
    const engine = {
        isSupported: false,
        init: vi.fn(() => {
            engine.isSupported = supported;
            return Promise.resolve();
        }),
        renderWavetables: vi.fn(() => Promise.resolve(set)),
        generate: vi.fn(() => Promise.resolve(new Float32Array(8))),
        destroy: vi.fn(),
    };
    return engine;
}

const REQ: GenerateRequest = { frequency: 440, duration: 1, sampleRate: SR, shape: 'saw', cutoff: 8000, resonance: 1 };

describe('WebGpuBackend', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('pre-renders the whole set in one engine call and reports it', async () => {
        const engine = stubEngine(makeSet());
        const backend = new WebGpuBackend(engine as unknown as WebGpuOscillator);
        const result = await backend.init(makeCtx());

        expect(result.ok).toBe(true);
        expect(result.reason).toContain('4/4 shapes');
        expect(result.reason).toContain('one dispatch');
        expect(engine.renderWavetables).toHaveBeenCalledTimes(1);
        expect(engine.renderWavetables).toHaveBeenCalledWith(SR);
        expect(engine.generate).not.toHaveBeenCalled();
        expect(backend.isReady).toBe(true);
    });

    it('plays each pitch from its own band, at the band’s exact base', async () => {
        const backend = new WebGpuBackend(stubEngine(makeSet()) as unknown as WebGpuOscillator);
        const ctx = makeCtx();
        await backend.init(ctx);
        const bands = planWavetableBands(SR);

        for (const f of [30, 110, 440, 2093, 8000]) {
            const render = backend.renderLoop(ctx, { ...REQ, frequency: f })!;
            const band = selectWavetableBand(bands, f);
            expect(render.baseFrequency).toBe(bands[band].baseFrequency);
            expect(render.buffer.getChannelData(0)[0]).toBeCloseTo(band / 100, 6);
            // Pitched by playbackRate = f / base, nothing lands past Nyquist.
            expect(bands[band].maxHarmonic * f).toBeLessThanOrEqual(SR / 2);
        }
        // Low and high notes get different tables — not one C4 table for all.
        expect(backend.renderLoop(ctx, { ...REQ, frequency: 55 })!.buffer).not.toBe(
            backend.renderLoop(ctx, { ...REQ, frequency: 3520 })!.buffer,
        );
    });

    it('fails closed when WebGPU is unavailable', async () => {
        const engine = stubEngine(makeSet(), false);
        const backend = new WebGpuBackend(engine as unknown as WebGpuOscillator);
        const result = await backend.init(makeCtx());
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('WebGPU unavailable');
        expect(engine.renderWavetables).not.toHaveBeenCalled();
        expect(backend.renderLoop(makeCtx(), REQ)).toBeNull();
    });

    it('fails closed when the GPU pass fails or throws', async () => {
        const nulled = new WebGpuBackend(stubEngine(null) as unknown as WebGpuOscillator);
        expect((await nulled.init(makeCtx())).ok).toBe(false);
        expect(nulled.isReady).toBe(false);

        const thrower = stubEngine(null);
        thrower.renderWavetables.mockRejectedValue(new Error('device lost'));
        const threw = new WebGpuBackend(thrower as unknown as WebGpuOscillator);
        expect((await threw.init(makeCtx())).ok).toBe(false);
        expect(threw.renderLoop(makeCtx(), REQ)).toBeNull();
    });

    it('drops a shape whose tables came back non-finite, and says it cannot render it', async () => {
        const bad = planWavetableBands(SR).map(() => new Float32Array(WAVETABLE_LENGTH).fill(Number.NaN));
        const backend = new WebGpuBackend(stubEngine(makeSet({ tri: bad })) as unknown as WebGpuOscillator);
        const result = await backend.init(makeCtx());

        expect(result.ok).toBe(true);
        expect(result.reason).toContain('3/4 shapes');
        expect(backend.supportsShape('tri')).toBe(false);
        expect(backend.supportsShape('saw')).toBe(true);
        expect(backend.renderLoop(makeCtx(), { ...REQ, shape: 'tri' })).toBeNull();
    });

    it('stops serving tables once the device goes away', async () => {
        const engine = stubEngine(makeSet());
        const backend = new WebGpuBackend(engine as unknown as WebGpuOscillator);
        await backend.init(makeCtx());
        engine.isSupported = false; // device lost
        expect(backend.isReady).toBe(false);
        expect(backend.renderLoop(makeCtx(), REQ)).toBeNull();
    });
});
