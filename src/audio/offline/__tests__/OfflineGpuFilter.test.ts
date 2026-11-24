// The WebGPU filter in a bounce (#1675): the GPU renders the note through the filter,
// and anything it cannot do falls back to the native biquad, said once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderGpuFilteredNote, resetOfflineGpuFilterReportsForTests, type GpuFilterRenderer } from '../OfflineGpuFilter';
import { parseWaveform } from '../../../utils/waveformParser';
import { filterSourceIssueId, kernelResonance } from '../../../engines/backends/filterSource';
import { engineDegradationStore } from '../../../stores/engineDegradationStore';
import { renderSynthToBuffer } from '../../../utils/renderAudio';
import type { SynthParams } from '../../../types';

const SR = 48000;

const PARAMS = {
    filterSource: 'webgpu' as const,
    filterType: 'hp' as const,
    filterCutoff: 1500,
    filterResonance: 8,
};

function engine(result: Float32Array | null = new Float32Array([0.1, 0.2, 0.3]), supported = true) {
    return {
        isSupported: supported,
        generate: vi.fn((..._args: unknown[]) => Promise.resolve(result)),
    } satisfies GpuFilterRenderer & { generate: ReturnType<typeof vi.fn> };
}

const render = (over: Partial<Parameters<typeof renderGpuFilteredNote>[0]> = {}) =>
    renderGpuFilteredNote({
        params: PARAMS,
        parsed: parseWaveform('rust-saw'),
        frequency: 220,
        duration: 0.5,
        sampleRate: SR,
        engine: engine(),
        ...over,
    });

beforeEach(() => {
    resetOfflineGpuFilterReportsForTests();
    engineDegradationStore.clear(filterSourceIssueId('webgpu'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('renderGpuFilteredNote', () => {
    it.each(['sawtooth', 'wgsl-saw', 'wam-saw', 'rust-saw', 'cpp-saw', 'pyodide-saw', 'wav-saw', 'dwgs-saw'])(
        'renders a %s part on the GPU, through the filter, at the note\'s own pitch',
        async (waveform) => {
            const gpu = engine(new Float32Array([1, 2]));
            const out = await render({ parsed: parseWaveform(waveform), engine: gpu });
            expect(out).toEqual(new Float32Array([1, 2]));
            expect(gpu.generate).toHaveBeenCalledWith(220, 0.5, SR, 'saw', {
                type: 'hp',
                cutoff: 1500,
                q: kernelResonance('hp', 8),
            });
        },
    );

    it('renders the part\'s shape, whatever the engine names', async () => {
        const gpu = engine();
        await render({ parsed: parseWaveform('wam-tri'), engine: gpu });
        await render({ parsed: parseWaveform('cpp-sqr'), engine: gpu });
        expect(gpu.generate.mock.calls.map((c) => c[3])).toEqual(['tri', 'sqr']);
    });

    it('is silent and does nothing for a part that does not use the WebGPU filter', async () => {
        const gpu = engine();
        for (const filterSource of [undefined, 'native', 'wam', 'rust', 'cpp', 'dwgs'] as const) {
            expect(await render({ params: { ...PARAMS, filterSource }, engine: gpu })).toBeNull();
        }
        expect(gpu.generate).not.toHaveBeenCalled();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))).toBeUndefined();
    });

    it('does not touch a 303 part (it owns its filter)', async () => {
        const gpu = engine();
        expect(await render({ parsed: parseWaveform('303-saw'), engine: gpu })).toBeNull();
        expect(gpu.generate).not.toHaveBeenCalled();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))).toBeUndefined();
    });

    it('defaults an absent filter type to a low pass, like every other path', async () => {
        const gpu = engine();
        await render({ params: { ...PARAMS, filterType: undefined }, engine: gpu });
        expect(gpu.generate.mock.calls[0][4]).toMatchObject({ type: 'lp' });
    });

    it.each([
        ['a DWGS digital wave', { parsed: parseWaveform('dwgs-bell') }, /dwgs-bell/],
        ['no WebGPU engine', { engine: null }, /WebGPU is unavailable/],
        ['an engine without a device', { engine: engine(new Float32Array(1), false) }, /WebGPU is unavailable/],
        ['a filter that moves during the note', { hasFilterCurve: true }, /moves while it plays/],
        ['a render the GPU refuses', { engine: engine(null) }, /could not render/],
    ])('falls back and says so for %s', async (_name, over, reason) => {
        expect(await render(over)).toBeNull();
        const issue = engineDegradationStore.getIssue(filterSourceIssueId('webgpu'));
        expect(issue?.requestedBackend).toBe('WebGPU');
        expect(issue?.activeBackend).toBe('Native');
        expect(issue?.reason).toMatch(reason);
        expect(issue?.reason).toContain('offline render');
    });

    it('falls back when the GPU render throws', async () => {
        const gpu = engine();
        gpu.generate.mockRejectedValueOnce(new Error('device lost mid-render'));
        expect(await render({ engine: gpu })).toBeNull();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))?.reason).toContain('device lost mid-render');
    });

    it('reports each reason once however many hits a bounce renders', async () => {
        const gpu = engine(null);
        for (let i = 0; i < 6; i++) await render({ engine: gpu, frequency: 100 + i * 37 });
        const reports = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('[FilterSourceFallback]'));
        expect(reports).toHaveLength(1);
    });
});

// ── through renderSynthToBuffer ──────────────────────────────────────────────

/** A recording offline context: no samples, just what the renderer wired up. */
function stubOfflineContext() {
    const made = { biquads: 0, sources: [] as Array<{ buffer: { getChannelData: () => Float32Array } | null }>, oscillators: 0 };
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() });
    const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
    const ctx = {
        destination: node(),
        createBuffer: (_c: number, length: number) => {
            const data = new Float32Array(length);
            return { length, getChannelData: () => data };
        },
        createBufferSource: () => {
            const s = { ...node(), buffer: null, loop: false, playbackRate: param() };
            made.sources.push(s);
            return s;
        },
        createBiquadFilter: () => { made.biquads++; return { ...node(), type: 'lowpass', frequency: param(), Q: param() }; },
        createGain: () => ({ ...node(), gain: param() }),
        createOscillator: () => { made.oscillators++; return { ...node(), __osc: true, type: 'sine', frequency: param() }; },
        startRendering: () => Promise.resolve({ length: 1 }),
    };
    return { ctx, made };
}

vi.mock('@/audio/offline/createOfflineContext', () => ({
    createOfflineContext: vi.fn(),
    createOfflineBuffer: vi.fn(),
}));

describe('renderSynthToBuffer with the WebGPU filter', () => {
    // happy-dom has no Web Audio classes, and the renderer asks `instanceof OscillatorNode`.
    beforeEach(() => {
        vi.stubGlobal('OscillatorNode', class { static [Symbol.hasInstance](o: { __osc?: boolean }) { return o?.__osc === true; } });
    });
    afterEach(() => vi.unstubAllGlobals());

    const synth = (over: Partial<SynthParams> = {}): SynthParams => ({
        waveform: 'rust-saw', pitch: 0, filterCutoff: 1800, filterResonance: 5,
        attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2, volume: 0.8, length: 1,
        delayTime: 0, delayFeedback: 0, delayMix: 0, filterSource: 'webgpu', ...over,
    } as SynthParams);

    async function bounce(params: SynthParams, gpu: ReturnType<typeof engine> | null, curve?: Parameters<typeof renderSynthToBuffer>[5]) {
        const { createOfflineContext } = await import('@/audio/offline/createOfflineContext');
        const { ctx, made } = stubOfflineContext();
        vi.mocked(createOfflineContext).mockReturnValue(ctx as never);
        await renderSynthToBuffer(params, 'A3', 0.25, { webGpuEngine: gpu }, SR, curve);
        return { made, ctx };
    }

    it('plays the GPU\'s filtered render and skips the biquad', async () => {
        const gpu = engine(new Float32Array(100).fill(0.5));
        const { made } = await bounce(synth({ filterType: 'bp' }), gpu);

        expect(gpu.generate).toHaveBeenCalledWith(220, 0.25, SR, 'saw', expect.objectContaining({ type: 'bp', cutoff: 1800 }));
        expect(made.biquads).toBe(0);
        expect(made.oscillators).toBe(0);
        expect(made.sources[0].buffer!.getChannelData()[0]).toBe(0.5);
    });

    it('keeps the native biquad when the part does not use it', async () => {
        const gpu = engine();
        const { made } = await bounce(synth({ filterSource: 'native' }), gpu);
        expect(gpu.generate).not.toHaveBeenCalled();
        expect(made.biquads).toBe(1);
    });

    it('falls back to the native biquad when the GPU cannot render it', async () => {
        const gpu = engine(null);
        const { made } = await bounce(synth(), gpu);
        expect(made.biquads).toBe(1);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))?.status).toBe('active');
    });

    it('falls back for a note whose filter moves (a filter curve)', async () => {
        const gpu = engine();
        const { made } = await bounce(synth(), gpu, [{ time: 0.1, filterCutoff: 4000 }]);
        expect(gpu.generate).not.toHaveBeenCalled();
        expect(made.biquads).toBe(1);
    });

    it('a wgsl-* part with the WebGPU filter is rendered once, filtered — not unfiltered and then again', async () => {
        const gpu = engine(new Float32Array(10).fill(0.25));
        const { made } = await bounce(synth({ waveform: 'wgsl-tri' }), gpu);
        expect(gpu.generate).toHaveBeenCalledTimes(1);
        expect(gpu.generate.mock.calls[0][3]).toBe('tri');
        expect(made.biquads).toBe(0);
    });
});
