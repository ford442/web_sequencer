// The Pyodide filter in a bounce (#1676): Python renders the note through the filter,
// and anything it cannot do falls back to the native biquad, said once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPyodideFilteredNote, resetOfflinePyodideFilterReportsForTests } from '../OfflinePyodideFilter';
import { parseWaveform } from '../../../utils/waveformParser';
import { filterSourceIssueId, kernelResonance } from '../../../engines/backends/filterSource';
import { engineDegradationStore } from '../../../stores/engineDegradationStore';
import type { PyodideLike } from '../../../utils/pyodideBuffers';
import { renderSynthToBuffer } from '../../../utils/renderAudio';
import type { SynthParams } from '../../../types';

const SR = 48000;

const PARAMS = {
    filterSource: 'pyodide' as const,
    filterType: 'bp' as const,
    filterCutoff: 1500,
    filterResonance: 8,
};

function runtime(result: Float32Array | Error = new Float32Array([0.1, 0.2, 0.3])) {
    const setRate = vi.fn();
    const generate = vi.fn((..._args: unknown[]) => {
        if (result instanceof Error) throw result;
        return { toJs: () => result, destroy: vi.fn() };
    });
    const pyodide = { globals: { get: (n: string) => (n === 'set_sample_rate' ? setRate : generate) } } as unknown as PyodideLike;
    return { pyodide, generate, setRate };
}

const render = (over: Partial<Parameters<typeof renderPyodideFilteredNote>[0]> = {}) =>
    renderPyodideFilteredNote({
        params: PARAMS,
        parsed: parseWaveform('rust-saw'),
        frequency: 220,
        duration: 0.5,
        sampleRate: SR,
        pyodide: runtime().pyodide,
        ...over,
    });

beforeEach(() => {
    resetOfflinePyodideFilterReportsForTests();
    engineDegradationStore.clear(filterSourceIssueId('pyodide'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('renderPyodideFilteredNote', () => {
    it.each(['sawtooth', 'wgsl-saw', 'wam-saw', 'rust-saw', 'cpp-saw', 'pyodide-saw', 'wav-saw', 'dwgs-saw'])(
        'renders a %s part in Python, through the filter, at the note\'s own pitch',
        async (waveform) => {
            const py = runtime(new Float32Array([1, 2]));
            const out = await render({ parsed: parseWaveform(waveform), pyodide: py.pyodide });
            expect(out).toEqual(new Float32Array([1, 2]));
            expect(py.setRate).toHaveBeenCalledWith(SR);
            expect(py.generate).toHaveBeenCalledWith(220, 0.5, 'saw', 'bp', 1500, kernelResonance('bp', 8));
        },
    );

    it('maps the shape to the Python name', async () => {
        const py = runtime();
        await render({ parsed: parseWaveform('wam-sqr'), pyodide: py.pyodide });
        expect(py.generate.mock.calls[0][2]).toBe('square');
    });

    it('is silent about a part that does not use the Pyodide filter, and never touches Python', async () => {
        const py = runtime();
        const load = vi.fn(() => Promise.resolve(py.pyodide));
        for (const filterSource of [undefined, 'native', 'webgpu', 'wam'] as const) {
            expect(await render({ params: { ...PARAMS, filterSource }, pyodide: null, loadRuntime: load })).toBeNull();
        }
        expect(load).not.toHaveBeenCalled();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))).toBeUndefined();
    });

    it('leaves a 303 / Prophecy / Macro part alone (they own their filters)', async () => {
        const py = runtime();
        expect(await render({ parsed: parseWaveform('303-saw'), pyodide: py.pyodide })).toBeNull();
        expect(py.generate).not.toHaveBeenCalled();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))).toBeUndefined();
    });

    it('asks for the runtime when the bounce has none, and waits for it', async () => {
        const py = runtime(new Float32Array([5]));
        const load = vi.fn(() => Promise.resolve(py.pyodide));
        const out = await render({ pyodide: null, loadRuntime: load });
        expect(load).toHaveBeenCalledTimes(1);
        expect(out).toEqual(new Float32Array([5]));
    });

    it('falls back, once, when the runtime cannot load', async () => {
        const load = vi.fn(() => Promise.resolve(null));
        expect(await render({ pyodide: null, loadRuntime: load })).toBeNull();
        expect(await render({ pyodide: null, loadRuntime: load })).toBeNull();
        const issue = engineDegradationStore.getIssue(filterSourceIssueId('pyodide'));
        expect(issue?.requestedBackend).toBe('Pyodide');
        expect(issue?.activeBackend).toBe('Native');
        expect(issue?.reason).toContain('runtime is unavailable');
        expect(issue?.reason).toContain('offline render');
        expect(vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('[FilterSourceFallback]'))).toHaveLength(1);
    });

    it('refuses a DWGS digital wave, naming it', async () => {
        expect(await render({ parsed: parseWaveform('dwgs-piano') })).toBeNull();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))?.reason).toContain('dwgs-piano');
    });

    it('refuses a note whose filter moves while it plays (a baked table holds one setting)', async () => {
        const py = runtime();
        expect(await render({ hasFilterCurve: true, pyodide: py.pyodide })).toBeNull();
        expect(py.generate).not.toHaveBeenCalled();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))?.reason).toContain('filter moves');
    });

    it.each([0, -1, Number.NaN, SR / 2, SR])('refuses a pitch of %s Hz (nothing under Nyquist to render)', async (frequency) => {
        const py = runtime();
        expect(await render({ frequency, pyodide: py.pyodide })).toBeNull();
        expect(py.generate).not.toHaveBeenCalled();
    });

    it('reports a Python error with its last line, not the traceback', async () => {
        const py = runtime(new Error('Traceback (most recent call last):\n  File "<exec>"\nValueError: unknown oscillator'));
        expect(await render({ pyodide: py.pyodide })).toBeNull();
        const reason = engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))?.reason ?? '';
        expect(reason).toContain('ValueError: unknown oscillator');
        expect(reason).not.toContain('Traceback');
    });

    it('refuses empty and non-finite renders', async () => {
        expect(await render({ pyodide: runtime(new Float32Array(0)).pyodide })).toBeNull();
        expect(await render({ pyodide: runtime(new Float32Array([0, Number.NaN])).pyodide })).toBeNull();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))?.reason).toMatch(/no samples|non-finite/);
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

describe('renderSynthToBuffer with the Pyodide filter', () => {
    // happy-dom has no Web Audio classes, and the renderer asks `instanceof OscillatorNode`.
    beforeEach(() => {
        vi.stubGlobal('OscillatorNode', class { static [Symbol.hasInstance](o: { __osc?: boolean }) { return o?.__osc === true; } });
    });
    afterEach(() => vi.unstubAllGlobals());

    const synth = (over: Partial<SynthParams> = {}): SynthParams => ({
        waveform: 'rust-saw', pitch: 0, filterCutoff: 1800, filterResonance: 5,
        attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2, volume: 0.8, length: 1,
        delayTime: 0, delayFeedback: 0, delayMix: 0, filterSource: 'pyodide', ...over,
    } as SynthParams);

    async function bounce(params: SynthParams, pyodide: PyodideLike | null, curve?: Parameters<typeof renderSynthToBuffer>[5]) {
        const { createOfflineContext } = await import('@/audio/offline/createOfflineContext');
        const { ctx, made } = stubOfflineContext();
        vi.mocked(createOfflineContext).mockReturnValue(ctx as never);
        await renderSynthToBuffer(params, 'A3', 0.25, { pyodide }, SR, curve);
        return { made };
    }

    it('plays the Python render and skips the biquad', async () => {
        const py = runtime(new Float32Array(100).fill(0.5));
        const { made } = await bounce(synth({ filterType: 'hp' }), py.pyodide);

        expect(py.generate).toHaveBeenCalledWith(220, 0.25, 'saw', 'hp', 1800, kernelResonance('hp', 5));
        expect(made.biquads).toBe(0);
        expect(made.oscillators).toBe(0);
        expect(made.sources[0].buffer!.getChannelData()[0]).toBe(0.5);
    });

    it('keeps the native biquad when the part does not use it', async () => {
        const py = runtime();
        const { made } = await bounce(synth({ filterSource: 'native' }), py.pyodide);
        expect(py.generate).not.toHaveBeenCalled();
        expect(made.biquads).toBe(1);
    });

    it('falls back to the native biquad when Python cannot render it', async () => {
        const { made } = await bounce(synth(), runtime(new Error('boom')).pyodide);
        expect(made.biquads).toBe(1);
    });

    it('falls back to the native biquad when the note\'s filter moves', async () => {
        const py = runtime();
        const { made } = await bounce(synth(), py.pyodide, [{ time: 0.1, filterCutoff: 400 }]);
        expect(py.generate).not.toHaveBeenCalled();
        expect(made.biquads).toBe(1);
    });

    it('a pyodide-* oscillator with the Pyodide filter is rendered once, by the filter (not twice)', async () => {
        const py = runtime(new Float32Array(10).fill(0.25));
        const { made } = await bounce(synth({ waveform: 'pyodide-saw' }), py.pyodide);
        expect(py.generate).toHaveBeenCalledTimes(1);
        expect(py.generate.mock.calls[0]).toHaveLength(6); // generate_filtered_note, not generate_wave
        expect(made.biquads).toBe(0);
    });
});
