// The "DWGS filter" as a Voice filter source (#1674): with `filterSource: 'dwgs'`
// the DWGS kernel's 4-pole ladder stage filters ANY host oscillator — tables,
// plain OscillatorNodes and worklet voices, `dwgs-*` itself included — and when
// it cannot run the voice runs the native filter and says so, never borrowing
// the WASM OSC, Rust or DWGS stage. Harness: voiceFilterHarness.ts.

import { describe, expect, it, vi } from 'vitest';
import { Voice } from '../VoiceManager';
import { FLAT_RESONANCE, filterSourceIssueId, kernelResonance, maxFilterCutoff } from '../backends/filterSource';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import type { SynthParams } from '../../types';
import {
    RATE,
    BASE,
    makeContext,
    StubTable,
    StubLive,
    install,
    makeStageFilter,
    registerFilterSourceHooks,
} from './voiceFilterHarness';

registerFilterSourceHooks();

// ── the DWGS filter as the source (#1674) ─────────────────────────────────────

describe('DWGS filter source', () => {
    const startDwgs = (voice: Voice, waveform: string, extra: Partial<SynthParams> = {}, time = 0) =>
        voice.startNote({ ...BASE, waveform, filterSource: 'dwgs', ...extra } as SynthParams, 'C4', time);

    it.each([
        ['wam-saw', 'wam'],
        ['wgsl-saw', 'webgpu'],
        ['pyodide-saw', 'pyodide'],
        ['wav-saw', 'wav'],
    ] as const)('filters a %s host through the bus, and the host bakes no filter of its own', (waveform, backendId) => {
        const table = new StubTable(backendId);
        install(table, new StubTable('js'));
        const { made, node } = makeStageFilter('dwgs');
        const g = makeContext();

        startDwgs(new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode), waveform, { filterType: 'hp' }, 0.5);

        expect(made).toHaveLength(1);
        expect(g.bus().disconnect).toHaveBeenCalledWith(g.biquad());
        expect(g.bus().connect).toHaveBeenCalledWith(node);
        expect(node.connect).toHaveBeenCalledWith(g.outGain());
        expect(made[0].set).toHaveBeenCalledWith(0.5, {
            cutoff: 2000,
            resonance: kernelResonance('hp', 6),
            type: 'hp',
        });
        expect(table.lastRequest).toMatchObject({ cutoff: maxFilterCutoff(RATE), resonance: FLAT_RESONANCE, filterType: 'lp' });
    });

    it.each([
        ['rust-saw', 'rust'],
        ['cpp-saw', 'cpp'],
        ['dwgs-saw', 'dwgs'],
    ] as const)('filters the worklet-resident %s oscillator through the same bus (dwgs-* is not special-cased)', (waveform, backendId) => {
        const live = new StubLive(backendId);
        install(live, new StubTable('js'));
        const { made, node } = makeStageFilter('dwgs');
        const g = makeContext();

        startDwgs(new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode), waveform, { filterType: 'bp' });

        expect(live.outputs[0].connect).toHaveBeenCalledWith(g.bus());
        expect(g.bus().connect).toHaveBeenCalledWith(node);
        expect(made[0].set).toHaveBeenCalledWith(0, expect.objectContaining({ type: 'bp', resonance: 6 }));
    });

    it('filters a plain OscillatorNode (the terminal js step) too', () => {
        const js = new StubTable('js');
        (js as { renderLoop?: unknown }).renderLoop = undefined;
        install(js);
        const { made, node } = makeStageFilter('dwgs');
        const g = makeContext();

        startDwgs(new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode), 'sawtooth');

        expect(g.find('osc').connect).toHaveBeenCalledWith(g.bus());
        expect(g.bus().connect).toHaveBeenCalledWith(node);
        expect(made[0].set).toHaveBeenCalledWith(0, expect.objectContaining({ type: 'lp' }));
    });

    it('asks only the DWGS filter for a node, never the WASM OSC, Rust or C++ one', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const dwgs = makeStageFilter('dwgs');
        const rust = makeStageFilter('rust');
        const cpp = makeStageFilter('cpp');
        const wam = makeStageFilter('wam');
        startDwgs(new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode), 'wam-saw');
        expect(dwgs.filter.acquire).toHaveBeenCalledTimes(1);
        expect(rust.filter.acquire).not.toHaveBeenCalled();
        expect(cpp.filter.acquire).not.toHaveBeenCalled();
        expect(wam.filter.acquire).not.toHaveBeenCalled();
    });

    it('switching Rust → DWGS → native hands each node back and wires the next', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const rust = makeStageFilter('rust');
        const dwgs = makeStageFilter('dwgs');
        const g = makeContext();
        const voice = new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode);

        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'rust' }, 'C4', 0);
        startDwgs(voice, 'wam-saw', {}, 1);

        expect(rust.made[0].release).toHaveBeenCalledTimes(1);
        expect(g.bus().disconnect).toHaveBeenCalledWith(rust.node);
        expect(g.bus().connect).toHaveBeenLastCalledWith(dwgs.node);
        expect(dwgs.node.connect).toHaveBeenCalledWith(g.outGain());
        expect(dwgs.made[0].set).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'lp' }));

        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'native' }, 'C4', 2);
        expect(g.bus().disconnect).toHaveBeenCalledWith(dwgs.node);
        expect(dwgs.made[0].release).toHaveBeenCalledTimes(1);
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.biquad());
    });

    it('keeps one DWGS filter across notes instead of acquiring per note', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { filter, made } = makeStageFilter('dwgs');
        const voice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);
        startDwgs(voice, 'wam-saw', {}, 0);
        startDwgs(voice, 'wam-saw', {}, 1);
        expect(filter.acquire).toHaveBeenCalledTimes(1);
        expect(made[0].set).toHaveBeenCalledTimes(2);
    });
});

describe('when the DWGS filter cannot run', () => {
    it.each([
        ['not initialized', { unavailable: 'dwgs_osc.wasm fetch HTTP 404' }],
        ['a node that cannot be created', { acquireFails: true }],
    ])('%s: filters natively, says "DWGS" was asked for, and never borrows another wasm filter', (_name, opts) => {
        const table = new StubTable('wam');
        install(table, new StubTable('js'));
        makeStageFilter('dwgs', opts);
        const rust = makeStageFilter('rust');
        const wam = makeStageFilter('wam');
        const g = makeContext();

        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'wam-saw', filterType: 'lp', filterSource: 'dwgs' }, 'C4', 0);

        expect((g.biquad() as unknown as { type: string }).type).toBe('lowpass');
        expect(g.bus().disconnect).not.toHaveBeenCalled();
        // No silent hop onto a different engine's filter: the substitute is the native one, said out loud.
        expect(rust.filter.acquire).not.toHaveBeenCalled();
        expect(wam.filter.acquire).not.toHaveBeenCalled();
        expect(table.lastRequest).toMatchObject({ cutoff: 2000, resonance: 6 });
        const issue = engineDegradationStore.getIssue(filterSourceIssueId('dwgs'));
        expect(issue?.requestedBackend).toBe('DWGS');
        expect(issue?.activeBackend).toBe('Native');
    });

    it('with no DWGS filter object at all (audio engine not initialized) it reports and filters natively', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const g = makeContext();
        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'wam-saw', filterType: 'hp', filterSource: 'dwgs' }, 'C4', 0);
        expect((g.biquad() as unknown as { type: string }).type).toBe('highpass');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('dwgs'))?.reason).toContain('audio engine not initialized');
    });

    it('its failure is its own: a Rust voice working does not clear it, and it raises no other source\'s issue', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeStageFilter('dwgs', { unavailable: 'dwgs is down (independence unit test)' });
        makeStageFilter('rust');
        const dwgsVoice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);
        const rustVoice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);

        dwgsVoice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'dwgs' }, 'C4', 0);
        rustVoice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'rust' }, 'C4', 0);
        dwgsVoice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'dwgs' }, 'C4', 1);

        expect(engineDegradationStore.getIssue(filterSourceIssueId('dwgs'))?.status).toBe('active');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('rust'))).toBeUndefined();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('wam'))).toBeUndefined();
        const reports = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('[FilterSourceFallback]'));
        expect(reports).toHaveLength(1);
    });

    it('clears the report once the DWGS filter works again', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { filter } = makeStageFilter('dwgs', { unavailable: 'dwgs recovery unit test reason' });
        const voice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);
        const params: SynthParams = { ...BASE, waveform: 'wam-saw', filterSource: 'dwgs' };

        voice.startNote(params, 'C4', 0);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('dwgs'))?.status).toBe('active');
        filter.unavailableReason.mockReturnValue(null);
        voice.startNote(params, 'C4', 1);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('dwgs'))?.status).toBe('resolved');
    });
});
