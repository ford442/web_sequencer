// The "WebGPU filter" as a Voice filter source (#1675): with `filterSource:
// 'webgpu'` a note plays a looped table the GPU rendered with the filter in every
// harmonic — whichever oscillator the part names — and anything the GPU cannot
// serve plays through the native filter, said out loud (a bank that is still being
// baked is the one quiet exception). Harness: voiceFilterHarness.ts.

import { describe, expect, it, vi } from 'vitest';
import { Voice } from '../VoiceManager';
import { filterSourceIssueId, kernelResonance } from '../backends/filterSource';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { engineTelemetry } from '../../utils/engineTelemetry';
import type { SynthParams } from '../../types';
import {
    BASE,
    RATE,
    makeContext,
    makeGpuFilter,
    makeStageFilter,
    readyTable,
    registerFilterSourceHooks,
    StubLive,
    StubTable,
    install,
} from './voiceFilterHarness';
import { FLAT_RESONANCE, maxFilterCutoff } from '../backends/filterSource';

registerFilterSourceHooks();

const destination = () => ({ connect: vi.fn() } as unknown as AudioNode);
const params = (waveform: string, extra: Partial<SynthParams> = {}): SynthParams =>
    ({ ...BASE, waveform, filterSource: 'webgpu', ...extra } as SynthParams);
/** C4 as `Voice` computes it for note "C4" at no tuning. */
const C4 = 261.63;

describe('WebGPU filter source: a GPU table stands in for the host oscillator', () => {
    it.each([
        ['wgsl-saw', 'webgpu'],
        ['wam-saw', 'wam'],
        ['pyodide-saw', 'pyodide'],
        ['wav-saw', 'wav'],
    ] as const)('plays a looped GPU table for a %s part, and never asks the host for one', (waveform, backendId) => {
        const host = new StubTable(backendId);
        install(host, new StubTable('js'));
        const gpu = makeGpuFilter(readyTable(130.8125));
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params(waveform), 'C4', 0.5);

        expect(host.lastRequest).toBeNull();
        const src = g.find('bufsrc') as unknown as { loop: boolean; buffer: unknown; playbackRate: { value: number }; start: ReturnType<typeof vi.fn> };
        expect(src.loop).toBe(true);
        expect(src.playbackRate.value).toBeCloseTo(C4 / 130.8125, 6);
        expect(src.start).toHaveBeenCalledWith(0.5);
        expect(gpu.lookup).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['rust-saw', 'rust'],
        ['cpp-saw', 'cpp'],
        ['dwgs-saw', 'dwgs'],
    ] as const)('replaces the live %s worklet voice: none is acquired', (waveform, backendId) => {
        const live = new StubLive(backendId);
        install(live, new StubTable('js'));
        makeGpuFilter(readyTable());
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params(waveform), 'C4', 0);

        expect(live.outputs).toHaveLength(0);
        expect(g.ctx.createBufferSource).toHaveBeenCalledTimes(1);
    });

    it('replaces the terminal OscillatorNode too', () => {
        const js = new StubTable('js');
        (js as { renderLoop?: unknown }).renderLoop = undefined;
        install(js);
        makeGpuFilter(readyTable());
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('sawtooth'), 'C4', 0);

        expect(g.ctx.createOscillator).not.toHaveBeenCalled();
        expect(g.ctx.createBufferSource).toHaveBeenCalledTimes(1);
    });

    it('asks for the part\'s basic shape, the knob values as the kernel\'s filter, and the note\'s pitch', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const gpu = makeGpuFilter(readyTable());

        new Voice(makeContext().ctx, destination()).startNote(params('wam-tri', { filterType: 'hp', filterCutoff: 3000, filterResonance: 6 }), 'A4', 0);

        const [, shape, spec, freq] = gpu.lookup.mock.calls[0];
        expect(shape).toBe('tri');
        expect(spec).toEqual({ type: 'hp', cutoff: 3000, q: kernelResonance('hp', 6) });
        expect(freq).toBeCloseTo(440, 1);
    });

    it('clamps the cutoff like every other source before asking', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const gpu = makeGpuFilter(readyTable());
        new Voice(makeContext().ctx, destination()).startNote(params('wam-saw', { filterCutoff: 1e9 }), 'C4', 0);
        expect(gpu.lookup.mock.calls[0][2]).toMatchObject({ cutoff: maxFilterCutoff(RATE) });
    });

    it('bypasses the native biquad: the bus feeds the output gain, and the biquad is not set', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter(readyTable());
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('wam-saw', { filterType: 'bp' }), 'C4', 0);

        expect(g.bus().disconnect).toHaveBeenCalledWith(g.biquad());
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.outGain());
        const biquad = g.biquad() as unknown as { type: string; frequency: { setValueAtTime: ReturnType<typeof vi.fn> } };
        expect(biquad.type).toBe('lowpass'); // untouched: the table is already filtered
        expect(biquad.frequency.setValueAtTime).not.toHaveBeenCalled();
    });

    it('keeps one table path across notes: the bus is wired once', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter(readyTable());
        const g = makeContext();
        const voice = new Voice(g.ctx, destination());

        voice.startNote(params('wam-saw'), 'C4', 0);
        voice.startNote(params('wam-saw'), 'E4', 1);

        expect(g.bus().disconnect).toHaveBeenCalledTimes(1);
        expect(g.bus().connect).toHaveBeenCalledTimes(2); // biquad (constructor) + gain (once)
    });

    it('a slide ramps the table\'s own playbackRate from the pitch it was baked at', () => {
        // happy-dom has no Web Audio classes; the slide path asks `instanceof`, so teach it the mock nodes.
        const nodeClass = (name: string) => class { static [Symbol.hasInstance](o: { name?: string }) { return o?.name === name; } };
        vi.stubGlobal('OscillatorNode', nodeClass('osc'));
        vi.stubGlobal('AudioBufferSourceNode', nodeClass('bufsrc'));
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter(readyTable(200));
        const g = makeContext();
        const voice = new Voice(g.ctx, destination());

        voice.startNote(params('wam-saw'), 'C4', 0);
        voice.startNote(params('wam-saw'), 'E4', 1, 261.63);
        vi.unstubAllGlobals();

        const rate = (g.find('bufsrc') as unknown as { playbackRate: { setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> } }).playbackRate;
        expect(rate.setValueAtTime).toHaveBeenCalledWith(261.63 / 200, 1);
        expect(rate.exponentialRampToValueAtTime).toHaveBeenCalledWith(expect.closeTo(329.63 / 200, 3), 1.1);
    });
});

describe('WebGPU filter source: switching filters rewires the bus', () => {
    it('native → WebGPU → native', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter(readyTable());
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

    it('a wasm stage → WebGPU hands the stage node back; WebGPU → a wasm stage takes one', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter(readyTable());
        const rust = makeStageFilter('rust');
        const dwgs = makeStageFilter('dwgs');
        const g = makeContext();
        const voice = new Voice(g.ctx, destination());

        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'rust' }, 'C4', 0);
        voice.startNote(params('wam-saw'), 'C4', 1);
        expect(g.bus().disconnect).toHaveBeenCalledWith(rust.node);
        expect(rust.made[0].release).toHaveBeenCalledTimes(1);
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.outGain());

        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'dwgs' }, 'C4', 2);
        expect(g.bus().disconnect).toHaveBeenLastCalledWith(g.outGain());
        expect(g.bus().connect).toHaveBeenLastCalledWith(dwgs.node);
        expect(dwgs.node.connect).toHaveBeenCalledWith(g.outGain());
        expect(dwgs.made[0].set).toHaveBeenCalledWith(2, expect.objectContaining({ type: 'lp' }));
    });
});

describe('WebGPU filter source: a bank that is still being baked', () => {
    it('plays through the host and the native filter (the same response), and is not a degradation', () => {
        const host = new StubTable('wam');
        install(host, new StubTable('js'));
        const gpu = makeGpuFilter({ kind: 'warming', key: 'saw|lp:240:16@44100' });
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('wam-saw', { filterType: 'lp' }), 'C4', 0);

        expect(gpu.lookup).toHaveBeenCalled();
        expect((g.biquad() as unknown as { type: string }).type).toBe('lowpass');
        expect(host.lastRequest).toMatchObject({ cutoff: 2000, resonance: 6 }); // the legacy bake, as for native
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))).toBeUndefined();
    });

    it('logs the warm-up once per bank, not per note', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter({ kind: 'warming', key: 'saw|warmup-log-test@44100' });
        const record = vi.spyOn(engineTelemetry, 'recordDegradation').mockImplementation(() => {});
        const voice = new Voice(makeContext().ctx, destination());

        voice.startNote(params('wam-saw'), 'C4', 0);
        voice.startNote(params('wam-saw'), 'D4', 1);
        voice.startNote(params('wam-saw'), 'E4', 2);

        const warmups = record.mock.calls.filter((c) => c[0] === 'filter-webgpu-warmup' && String(c[2]).includes('saw|warmup-log-test'));
        expect(warmups).toHaveLength(1);
    });

    it('goes back to the GPU table as soon as the bank is ready', () => {
        install(new StubTable('wam'), new StubTable('js'));
        let ready = false;
        makeGpuFilter(() => (ready ? readyTable() : { kind: 'warming', key: 'saw|ready-test@44100' }));
        const g = makeContext();
        const voice = new Voice(g.ctx, destination());

        voice.startNote(params('wam-saw'), 'C4', 0);
        expect(g.ctx.createBufferSource).toHaveBeenCalledTimes(1); // the host's table
        ready = true;
        voice.startNote(params('wam-saw'), 'D4', 1);
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.outGain());
    });
});

describe('WebGPU filter source: what it cannot serve', () => {
    it('refuses a DWGS digital wave (not a basic shape), naming it, and filters natively', () => {
        install(new StubLive('dwgs'), new StubTable('js'));
        const gpu = makeGpuFilter(readyTable());
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('dwgs-piano', { filterType: 'hp' }), 'C4', 0);

        expect(gpu.lookup).not.toHaveBeenCalled();
        expect((g.biquad() as unknown as { type: string }).type).toBe('highpass');
        const issue = engineDegradationStore.getIssue(filterSourceIssueId('webgpu'));
        expect(issue?.requestedBackend).toBe('WebGPU');
        expect(issue?.activeBackend).toBe('Native');
        expect(issue?.reason).toContain('dwgs-piano');
    });

    it.each(['dwgs-saw', 'dwgs-sqr', 'dwgs-sine'])('does render %s (it is a basic shape)', (waveform) => {
        install(new StubLive('dwgs'), new StubTable('js'));
        const gpu = makeGpuFilter(readyTable());
        new Voice(makeContext().ctx, destination()).startNote(params(waveform), 'C4', 0);
        expect(gpu.lookup).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['the device is lost', { unavailable: 'WebGPU is unavailable (no adapter, or the device was lost)' }],
    ])('%s: filters natively and says so', (_name, opts) => {
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter({ kind: 'unavailable', reason: opts.unavailable });
        const g = makeContext();

        new Voice(g.ctx, destination()).startNote(params('wam-saw'), 'C4', 0);

        expect((g.biquad() as unknown as { type: string }).type).toBe('lowpass');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))?.reason).toContain('device was lost');
    });

    it('a pitch outside the bank is the native filter, reported once however many pitches ask', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter({ kind: 'unavailable', reason: 'the pitch is outside the WebGPU filter\'s range (16.4–12544 Hz)' });
        const voice = new Voice(makeContext().ctx, destination());

        voice.startNote(params('wam-saw'), 'C-1', 0);
        voice.startNote(params('wam-saw'), 'C0', 1);
        voice.startNote(params('wam-saw'), 'C1', 2);

        const reports = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('[FilterSourceFallback]'));
        expect(reports.length).toBeLessThanOrEqual(1);
    });

    it('with no GPU filter object at all (audio engine not initialized) it reports and filters natively', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const g = makeContext();
        new Voice(g.ctx, destination()).startNote(params('wam-saw', { filterType: 'bp' }), 'C4', 0);
        expect((g.biquad() as unknown as { type: string }).type).toBe('bandpass');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))?.reason).toContain('audio engine not initialized');
    });

    it('never borrows a wasm filter when it cannot run', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter({ kind: 'unavailable', reason: 'webgpu is down (independence unit test)' });
        const rust = makeStageFilter('rust');
        const wam = makeStageFilter('wam');
        new Voice(makeContext().ctx, destination()).startNote(params('wam-saw'), 'C4', 0);
        expect(rust.filter.acquire).not.toHaveBeenCalled();
        expect(wam.filter.acquire).not.toHaveBeenCalled();
    });

    it('its failure is its own: a Rust voice working does not clear it', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeGpuFilter({ kind: 'unavailable', reason: 'webgpu is down (clear-independence unit test)' });
        makeStageFilter('rust');
        const gpuVoice = new Voice(makeContext().ctx, destination());
        const rustVoice = new Voice(makeContext().ctx, destination());

        gpuVoice.startNote(params('wam-saw'), 'C4', 0);
        rustVoice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'rust' }, 'C4', 0);
        gpuVoice.startNote(params('wam-saw'), 'C4', 1);

        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))?.status).toBe('active');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('rust'))).toBeUndefined();
        const reports = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('[FilterSourceFallback]'));
        expect(reports).toHaveLength(1);
    });

    it('clears the report once the GPU serves a note again', () => {
        install(new StubTable('wam'), new StubTable('js'));
        let answer: Parameters<typeof makeGpuFilter>[0] = { kind: 'unavailable', reason: 'webgpu recovery unit test reason' };
        makeGpuFilter(() => (typeof answer === 'function' ? answer('saw', 0) : answer));
        const voice = new Voice(makeContext().ctx, destination());

        voice.startNote(params('wam-saw'), 'C4', 0);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))?.status).toBe('active');
        answer = readyTable();
        voice.startNote(params('wam-saw'), 'C4', 1);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))?.status).toBe('resolved');
    });

    it('does not report for a 303 part, which owns its filter (Voice never plays it)', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const gpu = makeGpuFilter(readyTable());
        new Voice(makeContext().ctx, destination()).startNote(params('303-saw'), 'C4', 0);
        expect(gpu.lookup).not.toHaveBeenCalled();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))).toBeUndefined();
    });
});
