// The "Pyodide filter" as a Voice filter source (#1676): with `filterSource:
// 'pyodide'` a note plays a looped table SciPy rendered with the filter in every
// harmonic — whichever oscillator the part names — and anything Python cannot
// serve plays through the native filter, said out loud (a runtime that is still
// loading is the one quiet exception). Same shape as the WebGPU suite
// (Voice.webgpuFilterSource.test.ts); harness: voiceFilterHarness.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Voice } from '../VoiceManager';
import { filterSourceIssueId, kernelResonance, maxFilterCutoff } from '../backends/filterSource';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { engineTelemetry } from '../../utils/engineTelemetry';
import type { SynthParams } from '../../types';
import {
    BASE,
    RATE,
    install,
    makeContext,
    makeGpuFilter,
    makePyodideFilter,
    makeStageFilter,
    readyTable,
    registerFilterSourceHooks,
    StubLive,
    StubTable,
} from './voiceFilterHarness';

registerFilterSourceHooks();

const destination = () => ({ connect: vi.fn() } as unknown as AudioNode);
const params = (waveform: string, extra: Partial<SynthParams> = {}): SynthParams =>
    ({ ...BASE, waveform, filterSource: 'pyodide', ...extra } as SynthParams);
/** C4 as `Voice` computes it for note "C4" at no tuning. */
const C4 = 261.63;
const biquadType = (g: ReturnType<typeof makeContext>) => (g.biquad() as unknown as { type: string }).type;

describe('Pyodide filter source: a Python table stands in for the host oscillator', () => {
    it.each([
        ['pyodide-saw', 'pyodide'],
        ['wam-saw', 'wam'],
        ['wgsl-saw', 'webgpu'],
        ['wav-saw', 'wav'],
    ] as const)('plays a looped Python table for a %s part, and never asks the host for one', (waveform, backendId) => {
        const host = new StubTable(backendId);
        install(host, new StubTable('js'));
        const py = makePyodideFilter(readyTable(260.5));
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params(waveform), 'C4', 0.5);

        expect(host.lastRequest).toBeNull();
        const src = g.find('bufsrc') as unknown as { loop: boolean; playbackRate: { value: number }; start: ReturnType<typeof vi.fn> };
        expect(src.loop).toBe(true);
        expect(src.playbackRate.value).toBeCloseTo(C4 / 260.5, 6);
        expect(src.start).toHaveBeenCalledWith(0.5);
        expect(py.lookup).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['rust-saw', 'rust'],
        ['cpp-saw', 'cpp'],
        ['dwgs-saw', 'dwgs'],
    ] as const)('replaces the live %s worklet voice: none is acquired', (waveform, backendId) => {
        const live = new StubLive(backendId);
        install(live, new StubTable('js'));
        makePyodideFilter(readyTable());
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params(waveform), 'C4', 0);

        expect(live.outputs).toHaveLength(0);
        expect(g.ctx.createBufferSource).toHaveBeenCalledTimes(1);
    });

    it('replaces the terminal OscillatorNode too', () => {
        const js = new StubTable('js');
        (js as { renderLoop?: unknown }).renderLoop = undefined;
        install(js);
        makePyodideFilter(readyTable());
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('sawtooth'), 'C4', 0);

        expect(g.ctx.createOscillator).not.toHaveBeenCalled();
        expect(g.ctx.createBufferSource).toHaveBeenCalledTimes(1);
    });

    it('asks for the part\'s basic shape, the knob values as the filter spec, and the note\'s pitch', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const py = makePyodideFilter(readyTable());

        new Voice(makeContext().ctx, destination()).startNote(params('wam-tri', { filterType: 'hp', filterCutoff: 3000, filterResonance: 6 }), 'A4', 0);

        const [, shape, spec, freq] = py.lookup.mock.calls[0];
        expect(shape).toBe('tri');
        expect(spec).toEqual({ type: 'hp', cutoff: 3000, q: kernelResonance('hp', 6) });
        expect(freq).toBeCloseTo(440, 1);
    });

    it('clamps the cutoff like every other source before asking', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const py = makePyodideFilter(readyTable());
        new Voice(makeContext().ctx, destination()).startNote(params('wam-saw', { filterCutoff: 1e9 }), 'C4', 0);
        expect(py.lookup.mock.calls[0][2]).toMatchObject({ cutoff: maxFilterCutoff(RATE) });
    });

    it('bypasses the native biquad: the bus feeds the output gain, and the biquad is not set', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makePyodideFilter(readyTable());
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('wam-saw', { filterType: 'bp' }), 'C4', 0);

        expect(g.bus().disconnect).toHaveBeenCalledWith(g.biquad());
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.outGain());
        const biquad = g.biquad() as unknown as { frequency: { setValueAtTime: ReturnType<typeof vi.fn> } };
        expect(biquadType(g)).toBe('lowpass'); // untouched: the table is already filtered
        expect(biquad.frequency.setValueAtTime).not.toHaveBeenCalled();
    });

    it('keeps one table path across notes: the bus is wired once', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makePyodideFilter(readyTable());
        const g = makeContext();
        const voice = new Voice(g.ctx, destination());

        voice.startNote(params('wam-saw'), 'C4', 0);
        voice.startNote(params('wam-saw'), 'E4', 1);

        expect(g.bus().disconnect).toHaveBeenCalledTimes(1);
        expect(g.bus().connect).toHaveBeenCalledTimes(2); // biquad (constructor) + gain (once)
    });
});

describe('Pyodide filter source: switching filters rewires the bus', () => {
    it('native → Pyodide → native', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makePyodideFilter(readyTable());
        const g = makeContext();
        const voice = new Voice(g.ctx, destination());

        voice.startNote({ ...BASE, waveform: 'wam-saw' }, 'C4', 0);
        voice.startNote(params('wam-saw'), 'C4', 1);
        expect(g.bus().disconnect).toHaveBeenLastCalledWith(g.biquad());
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.outGain());

        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'native' }, 'C4', 2);
        expect(g.bus().disconnect).toHaveBeenLastCalledWith(g.outGain());
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.biquad());
    });

    it('a wasm stage → Pyodide hands the stage node back', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makePyodideFilter(readyTable());
        const rust = makeStageFilter('rust');
        const g = makeContext();
        const voice = new Voice(g.ctx, destination());

        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'rust' }, 'C4', 0);
        voice.startNote(params('wam-saw'), 'C4', 1);

        expect(g.bus().disconnect).toHaveBeenCalledWith(rust.node);
        expect(rust.made[0].release).toHaveBeenCalledTimes(1);
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.outGain());
    });

    it('WebGPU ↔ Pyodide stay wired straight to the output gain, never to the biquad', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makePyodideFilter(readyTable());
        makeGpuFilter(readyTable());
        const g = makeContext();
        const voice = new Voice(g.ctx, destination());

        voice.startNote(params('wam-saw', { filterSource: 'webgpu' }), 'C4', 0);
        voice.startNote(params('wam-saw'), 'C4', 1);

        expect(g.bus().connect).toHaveBeenLastCalledWith(g.outGain());
        expect(g.bus().connect).not.toHaveBeenLastCalledWith(g.biquad());
    });
});

describe('Pyodide filter source: a runtime that is still loading', () => {
    // The once-per-cause set is static on Voice, and "loading" has one cause: start each test without it.
    beforeEach(() => (Voice as unknown as { reportedWarmup: Set<string> }).reportedWarmup.clear());

    it('plays through the host and the native filter (the same response), and is not a degradation', () => {
        const host = new StubTable('wam');
        install(host, new StubTable('js'));
        const py = makePyodideFilter({ kind: 'loading' });
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('wam-saw', { filterType: 'lp' }), 'C4', 0);

        expect(py.lookup).toHaveBeenCalled();
        expect(biquadType(g)).toBe('lowpass');
        expect(host.lastRequest).toMatchObject({ cutoff: 2000, resonance: 6 }); // the legacy bake, as for native
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))).toBeUndefined();
    });

    it('logs the warm-up once, not per note', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makePyodideFilter({ kind: 'loading' });
        const record = vi.spyOn(engineTelemetry, 'recordDegradation').mockImplementation(() => {});
        const voice = new Voice(makeContext().ctx, destination());

        voice.startNote(params('wam-saw'), 'C4', 0);
        voice.startNote(params('wam-saw'), 'D4', 1);
        voice.startNote(params('wam-saw'), 'E4', 2);

        expect(record.mock.calls.filter((c) => c[0] === 'filter-pyodide-warmup')).toHaveLength(1);
    });

    it('goes to the Python table as soon as the runtime is ready', () => {
        install(new StubTable('wam'), new StubTable('js'));
        let ready = false;
        makePyodideFilter(() => (ready ? readyTable() : { kind: 'loading' }));
        const g = makeContext();
        const voice = new Voice(g.ctx, destination());

        voice.startNote(params('wam-saw'), 'C4', 0);
        expect(g.bus().connect).not.toHaveBeenLastCalledWith(g.outGain());
        ready = true;
        voice.startNote(params('wam-saw'), 'D4', 1);
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.outGain());
    });
});

describe('Pyodide filter source: what it cannot serve', () => {
    it('refuses a DWGS digital wave (not a basic shape), naming it, and filters natively', () => {
        install(new StubLive('dwgs'), new StubTable('js'));
        const py = makePyodideFilter(readyTable());
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('dwgs-piano', { filterType: 'hp' }), 'C4', 0);

        expect(py.lookup).not.toHaveBeenCalled();
        expect(biquadType(g)).toBe('highpass');
        const issue = engineDegradationStore.getIssue(filterSourceIssueId('pyodide'));
        expect(issue?.requestedBackend).toBe('Pyodide');
        expect(issue?.activeBackend).toBe('JS');
        expect(issue?.reason).toContain('dwgs-piano');
        expect(issue?.reason).toContain('Pyodide');
    });

    it.each(['dwgs-saw', 'dwgs-sqr', 'dwgs-sine'])('does render %s (it is a basic shape)', (waveform) => {
        install(new StubLive('dwgs'), new StubTable('js'));
        const py = makePyodideFilter(readyTable());
        new Voice(makeContext().ctx, destination()).startNote(params(waveform), 'C4', 0);
        expect(py.lookup).toHaveBeenCalledTimes(1);
    });

    it('a runtime that failed to load: filters natively and says so', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makePyodideFilter({ kind: 'unavailable', reason: 'the Python runtime failed to load (timed out)' });
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('wam-saw'), 'C4', 0);

        expect(biquadType(g)).toBe('lowpass');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))?.reason).toContain('failed to load');
    });

    it('with no Pyodide filter object at all (audio engine not initialized) it reports and filters natively', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const g = makeContext();
        new Voice(g.ctx, destination()).startNote(params('wam-saw', { filterType: 'bp' }), 'C4', 0);
        expect(biquadType(g)).toBe('bandpass');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))?.reason).toContain('audio engine not initialized');
    });

    it('never borrows another filter when it cannot run', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makePyodideFilter({ kind: 'unavailable', reason: 'python is down (independence unit test)' });
        const gpu = makeGpuFilter(readyTable());
        const rust = makeStageFilter('rust');
        new Voice(makeContext().ctx, destination()).startNote(params('wam-saw'), 'C4', 0);
        expect(gpu.lookup).not.toHaveBeenCalled();
        expect(rust.filter.acquire).not.toHaveBeenCalled();
    });

    it('its failure is its own: a WebGPU voice working does not clear it', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makePyodideFilter({ kind: 'unavailable', reason: 'python is down (clear-independence unit test)' });
        makeGpuFilter(readyTable());
        const pyVoice = new Voice(makeContext().ctx, destination());
        const gpuVoice = new Voice(makeContext().ctx, destination());

        pyVoice.startNote(params('wam-saw'), 'C4', 0);
        gpuVoice.startNote(params('wam-saw', { filterSource: 'webgpu' }), 'C4', 0);
        pyVoice.startNote(params('wam-saw'), 'C4', 1);

        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))?.status).toBe('active');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))).toBeUndefined();
    });

    it('clears the report once Python serves a note again', () => {
        install(new StubTable('wam'), new StubTable('js'));
        let answer: Parameters<typeof makePyodideFilter>[0] = { kind: 'unavailable', reason: 'pyodide recovery unit test reason' };
        makePyodideFilter(() => (typeof answer === 'function' ? answer('saw', 0) : answer));
        const voice = new Voice(makeContext().ctx, destination());

        voice.startNote(params('wam-saw'), 'C4', 0);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))?.status).toBe('active');
        answer = readyTable();
        voice.startNote(params('wam-saw'), 'C4', 1);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))?.status).toBe('resolved');
    });

    it('does not report for a 303 part, which owns its filter (Voice never plays it)', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const py = makePyodideFilter(readyTable());
        new Voice(makeContext().ctx, destination()).startNote(params('303-saw'), 'C4', 0);
        expect(py.lookup).not.toHaveBeenCalled();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('pyodide'))).toBeUndefined();
    });
});
