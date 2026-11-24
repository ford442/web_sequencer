// The oscillator × filter-source cross-product contract (#1678, parent #1663).
//
// For EVERY oscillator family a part can select whose notes run through
// `Voice`, EVERY filter source, and EVERY response (LP / BP / HP):
//
//   - reachable: with the source available, the voice wires exactly that
//     filter, sets the requested response on it, and the host oscillator's
//     samples are what reach it (except a table filter, which plays its own
//     filtered table — and says so);
//   - no silent substitution: with the source unavailable, the voice runs the
//     JS (native) filter with the SAME response, raises a degradation for that
//     source, and the EngineHUD row for the pairing names the filter that
//     actually runs;
//   - the host's baked filter never doubles up with the one that runs.
//
// The axes are the UI's own lists (`VOICE_FILTER_OSC_TYPES`, the variant
// selector's waveforms, `FILTER_SOURCES`, `FILTER_TYPES`), so a new family or
// source is covered here — or fails the classification checks — automatically.

import { describe, expect, it, vi } from 'vitest';
import { Voice } from '../VoiceManager';
import {
    FILTER_SOURCES,
    FILTER_SOURCE_LABELS,
    FILTER_TYPES,
    FILTER_TYPE_SHORT,
    OWN_FILTER_SOURCE,
    STAGED_FILTER_SOURCES,
    biquadTypeFor,
    filterSourceIssueId,
    hostFilterRequest,
    isTableFilterSource,
    kernelResonance,
} from '../backends/filterSource';
import { backendIdForEngine, engineEntry } from '../backends/engineCatalog';
import { VOICE_FILTER_OSC_TYPES } from '../../components/FilterSourceSelector';
import { getWaveformsForType } from '../../components/oscillatorThemes';
import { parseWaveform } from '../../utils/waveformParser';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { engineTelemetry, filterPairingSubsystem } from '../../utils/engineTelemetry';
import type { FilterSource, FilterType, OscillatorType, SynthParams, Waveform } from '../../types';
import type { OscillatorBackendId } from '../backends/OscillatorBackend';
import {
    BASE,
    RATE,
    StubLive,
    StubTable,
    install,
    makeContext,
    makeGpuFilter,
    makePyodideFilter,
    makeStageFilter,
    readyTable,
    registerFilterSourceHooks,
    type MockNode,
} from './voiceFilterHarness';

registerFilterSourceHooks();

const ALL_OSC_TYPES = Object.keys(OWN_FILTER_SOURCE) as OscillatorType[];
const HOSTS = [...VOICE_FILTER_OSC_TYPES].sort();
/** Worklet-resident hosts (one live node per voice); the rest render a looped table, or (`js`) an OscillatorNode. */
const LIVE_BACKENDS: ReadonlySet<OscillatorBackendId> = new Set<OscillatorBackendId>(['rust', 'cpp', 'dwgs']);

// ── Classification: every family and every source is accounted for ──────────

describe('filter-source classification', () => {
    it('every filter source is some oscillator family\'s own filter (no orphan source)', () => {
        const owned = new Set(Object.values(OWN_FILTER_SOURCE).filter((s): s is FilterSource => s !== null));
        expect([...owned].sort()).toEqual([...FILTER_SOURCES].sort());
    });

    it('each source is owned by exactly one family', () => {
        for (const source of FILTER_SOURCES) {
            const owners = ALL_OSC_TYPES.filter((t) => OWN_FILTER_SOURCE[t] === source);
            expect(owners, source).toHaveLength(1);
        }
    });

    it('only families that run through Voice\'s filter stage lend a filter', () => {
        for (const type of ALL_OSC_TYPES) {
            if (OWN_FILTER_SOURCE[type] !== null) expect(VOICE_FILTER_OSC_TYPES.has(type), type).toBe(true);
        }
    });

    it('a family\'s own filter source is its own engine (labels agree with the oscillator\'s backend)', () => {
        for (const type of HOSTS) {
            const own = OWN_FILTER_SOURCE[type];
            if (own === null || own === 'native') continue;
            const engine = parseWaveform(getWaveformsForType(type)[0]!).engine;
            expect(backendIdForEngine(engine), type).toBe(own);
        }
    });

    it('every host family is a backend Voice can play (never a native worklet)', () => {
        for (const type of HOSTS) {
            const engine = parseWaveform(getWaveformsForType(type)[0]!).engine;
            expect(engineEntry(engine).kind, type).toBe('backend');
        }
    });
});

// ── The matrix ───────────────────────────────────────────────────────────────

interface Host {
    waveform: Waveform;
    label: string;
    table: StubTable | null;
    live: StubLive | null;
}

/** Register the part's host engine (plus the terminal `js` step) and say how to recognize its samples. */
function installHost(type: OscillatorType): Host {
    const waveform = getWaveformsForType(type)[0]!;
    const engine = parseWaveform(waveform).engine;
    const backendId = backendIdForEngine(engine)!;
    const label = engineEntry(engine).label;
    if (backendId === 'js') {
        const js = new StubTable('js');
        (js as { renderLoop?: unknown }).renderLoop = undefined; // the real js backend has no table
        install(js);
        return { waveform, label, table: null, live: null };
    }
    if (LIVE_BACKENDS.has(backendId)) {
        const live = new StubLive(backendId);
        install(live, new StubTable('js'));
        return { waveform, label, table: null, live };
    }
    const table = new StubTable(backendId);
    install(table, new StubTable('js'));
    return { waveform, label, table, live: null };
}

type Graph = ReturnType<typeof makeContext>;

/** The host's own samples reached the filter bus (not a substitute source). */
function expectHostFeedsBus(host: Host, g: Graph): void {
    if (host.live) {
        expect(host.live.outputs).toHaveLength(1);
        expect(host.live.outputs[0]!.connect).toHaveBeenCalledWith(g.bus());
    } else if (host.table) {
        expect(host.table.lastRequest).not.toBeNull();
        expect(g.find('bufsrc').connect).toHaveBeenCalledWith(g.bus());
    } else {
        expect(g.find('osc').connect).toHaveBeenCalledWith(g.bus());
    }
}

/** The host's request to bake a filter into its table — absent for a worklet / OscillatorNode host. */
function expectHostBake(host: Host, params: SynthParams, effective: { source: FilterSource; type: FilterType }): void {
    if (!host.table) return;
    expect(host.table.lastRequest).toMatchObject(hostFilterRequest(params, effective, RATE));
}

function expectNativeFilterWired(g: Graph, type: FilterType, params: SynthParams): void {
    const biquad = g.biquad() as unknown as MockNode & { type: string; Q: { value: number }; frequency: { setValueAtTime: ReturnType<typeof vi.fn> } };
    expect(biquad.type).toBe(biquadTypeFor(type));
    expect(biquad.frequency.setValueAtTime).toHaveBeenCalledWith(params.filterCutoff, 0);
    expect(biquad.Q.value).toBe(params.filterResonance);
    // Still on the bus, and nothing else is.
    expect(g.bus().disconnect).not.toHaveBeenCalled();
    expect(g.bus().connect).toHaveBeenCalledTimes(1);
    expect(g.bus().connect).toHaveBeenCalledWith(biquad);
}

function hudRow(host: Host, requested: FilterSource) {
    return engineTelemetry.snapshot()[filterPairingSubsystem(host.label, FILTER_SOURCE_LABELS[requested])]?.resolution;
}

const CELLS = HOSTS.flatMap((host) =>
    FILTER_SOURCES.flatMap((source) => FILTER_TYPES.map((type) => [host, source, type] as const)));

describe('every host × filter source × response is reachable', () => {
    it('covers the whole cross-product', () => {
        expect(CELLS).toHaveLength(HOSTS.length * FILTER_SOURCES.length * FILTER_TYPES.length);
        expect(HOSTS.length).toBeGreaterThanOrEqual(8);
        expect(FILTER_SOURCES.length).toBeGreaterThanOrEqual(7);
    });

    it.each(CELLS)('%s oscillator, %s filter, %s', (hostType, source, type) => {
        const host = installHost(hostType);
        const g = makeContext();
        const params: SynthParams = { ...BASE, waveform: host.waveform, filterType: type, filterSource: source };
        const stage = (STAGED_FILTER_SOURCES as readonly FilterSource[]).includes(source)
            ? makeStageFilter(source as (typeof STAGED_FILTER_SOURCES)[number])
            : null;
        const tableLoop = readyTable();
        const gpu = source === 'webgpu' ? makeGpuFilter(tableLoop) : null;
        const py = source === 'pyodide' ? makePyodideFilter(tableLoop) : null;

        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode).startNote(params, 'C4', 0);

        if (source === 'native') {
            expectHostFeedsBus(host, g);
            expectNativeFilterWired(g, type, params);
            expectHostBake(host, params, { source, type });
        } else if (stage) {
            expectHostFeedsBus(host, g);
            // bus → this kernel's stage → output gain; the biquad is parked.
            expect(stage.made).toHaveLength(1);
            expect(g.bus().disconnect).toHaveBeenCalledWith(g.biquad());
            expect(g.bus().connect).toHaveBeenLastCalledWith(stage.node);
            expect(stage.node.connect).toHaveBeenCalledWith(g.outGain());
            expect(stage.made[0]!.set).toHaveBeenCalledWith(0, {
                cutoff: params.filterCutoff,
                resonance: kernelResonance(type, params.filterResonance),
                type,
            });
            // The stage filters; the host bakes none (no double filter).
            expectHostBake(host, params, { source, type });
        } else {
            expect(isTableFilterSource(source)).toBe(true);
            const lookup = (gpu ?? py)!.lookup;
            expect(lookup).toHaveBeenCalledTimes(1);
            // The table is already filtered for this response.
            expect(lookup.mock.calls[0]![2]).toMatchObject({ type });
            // It plays its own table straight to the output gain: the host is not asked for samples.
            expect(g.find('bufsrc').buffer).toBe(tableLoop.render.buffer);
            expect(g.bus().connect).toHaveBeenLastCalledWith(g.outGain());
            expect(host.table?.lastRequest ?? null).toBeNull();
            expect(host.live?.outputs ?? []).toHaveLength(0);
        }

        // Nothing degraded, and the HUD row names the requested filter.
        expect(engineDegradationStore.getIssue(filterSourceIssueId(source))).toBeUndefined();
        const row = hudRow(host, source);
        expect(row?.backend).toBe(FILTER_SOURCE_LABELS[source]);
        expect(row?.reason).toContain(FILTER_TYPE_SHORT[type]);
        if (isTableFilterSource(source)) expect(row?.reason).toContain(`${host.label} is not heard`);
    });
});

const FALLIBLE = CELLS.filter(([, source]) => source !== 'native');

describe('every host × filter source × response degrades cleanly and visibly', () => {
    it.each(FALLIBLE)('%s oscillator, %s filter, %s — source unavailable', (hostType, source, type) => {
        const host = installHost(hostType);
        const g = makeContext();
        const params: SynthParams = { ...BASE, waveform: host.waveform, filterType: type, filterSource: source };
        // A cause unique to the cell: Voice reports each cause once per process.
        const reason = `matrix: ${hostType}/${source}/${type} is down`;
        const stage = (STAGED_FILTER_SOURCES as readonly FilterSource[]).includes(source)
            ? makeStageFilter(source as (typeof STAGED_FILTER_SOURCES)[number], { unavailable: reason })
            : null;
        if (source === 'webgpu') makeGpuFilter({ kind: 'unavailable', reason });
        if (source === 'pyodide') makePyodideFilter({ kind: 'unavailable', reason });

        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode).startNote(params, 'C4', 0);

        // The host still plays, through the JS filter with the SAME response — never another one.
        expectHostFeedsBus(host, g);
        expectNativeFilterWired(g, type, params);
        expect(stage?.filter.acquire ?? vi.fn()).not.toHaveBeenCalled();
        // The host is asked for what the JS filter needs (legacy LP bake, otherwise opened).
        expectHostBake(host, params, { source: 'native', type });

        // Said out loud: a degradation for THIS source, naming both ends and the cause…
        const issue = engineDegradationStore.getIssue(filterSourceIssueId(source));
        expect(issue?.status).toBe('active');
        expect(issue?.requestedBackend).toBe(FILTER_SOURCE_LABELS[source]);
        expect(issue?.activeBackend).toBe(FILTER_SOURCE_LABELS.native);
        expect(issue?.reason).toContain(reason);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[FilterSourceFallback]'));
        // …and on the HUD: the pairing's badge is the filter that runs, with the cause.
        const row = hudRow(host, source);
        expect(row?.backend).toBe(FILTER_SOURCE_LABELS.native);
        expect(row?.reason).toContain(`${FILTER_SOURCE_LABELS[source]} filter unavailable`);
        expect(row?.reason).toContain(reason);
    });
});

describe('recovery', () => {
    it.each(STAGED_FILTER_SOURCES)('a %s filter that comes back clears its degradation and its HUD row', (source) => {
        const host = installHost('wam');
        const params: SynthParams = { ...BASE, waveform: host.waveform, filterType: 'bp', filterSource: source };
        const down = `recovery: ${source} down`;
        makeStageFilter(source, { unavailable: down });
        new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode).startNote(params, 'C4', 0);
        expect(engineDegradationStore.getIssue(filterSourceIssueId(source))?.status).toBe('active');
        expect(hudRow(host, source)?.backend).toBe('JS');

        makeStageFilter(source);
        new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode).startNote(params, 'C4', 0);
        expect(engineDegradationStore.getIssue(filterSourceIssueId(source))?.status).not.toBe('active');
        expect(hudRow(host, source)?.backend).toBe(FILTER_SOURCE_LABELS[source]);
        const last = engineTelemetry.getRuntimeSnapshot().degradations.at(-1);
        expect(last).toMatchObject({ step: 'filter', active: false });
    });

    it('a table filter warming up stands in with the JS filter and the HUD says warm-up, not failure', () => {
        const host = installHost('rust');
        const g = makeContext();
        makeGpuFilter({ kind: 'warming', key: 'matrix-bank' });
        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: host.waveform, filterType: 'hp', filterSource: 'webgpu' }, 'C4', 0);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('webgpu'))).toBeUndefined();
        const row = hudRow(host, 'webgpu');
        expect(row?.backend).toBe('JS');
        expect(row?.reason).toContain('warming up');
        expect((g.biquad() as unknown as { type: string }).type).toBe('highpass');
    });
});
