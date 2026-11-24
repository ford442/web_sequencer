// Tests for the selectable filter type + the wasm filter sources on Voice
// ("WASM OSC", #1663; "Rust", #1672).
//
//   - `filterType` (lp / bp / hp) reaches every filter: the voice's own
//     BiquadFilterNode and each kernel's worklet stage.
//   - With `filterSource: 'wam' | 'rust'` the stage filters ANY host oscillator:
//     every source connects to one bus, and the bus feeds the wasm filter, not
//     the biquad.
//   - The host's own baked filter never doubles up with the voice filter.
//   - If a wasm filter cannot run, the voice runs the native one and says so —
//     once per cause, per source, in the degradation store — and the host is
//     asked for exactly what the native filter needs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Voice } from '../VoiceManager';
import { BackendRegistry, setOscillatorRegistry } from '../backends/BackendRegistry';
import type {
    BackendCapabilities,
    GenerateRequest,
    InitResult,
    LoopRender,
    OscillatorBackend,
    OscillatorBackendId,
    RealtimeVoice,
} from '../backends/OscillatorBackend';
import {
    FLAT_RESONANCE,
    filterSourceIssueId,
    kernelResonance,
    maxFilterCutoff,
} from '../backends/filterSource';
import { setWamFilter, type WamFilter, type WamFilterNode } from '../WamFilter';
import { setFilterStage, type StagedFilterSource } from '../filterStages';
import type { SynthParams } from '../../types';
import type { WaveShape } from '../../utils/waveformParser';
import { engineDegradationStore } from '../../stores/engineDegradationStore';

const RATE = 44100;

const BASE: SynthParams = {
    waveform: 'sawtooth',
    pitch: 0,
    filterCutoff: 2000,
    filterResonance: 6,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.7,
    release: 0.3,
    volume: 0.8,
    length: 1,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
};

// ── A context whose graph can be inspected ───────────────────────────────────

interface MockNode {
    name: string;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    [k: string]: unknown;
}

const param = () => ({
    value: 0,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
});

function makeAudioBuffer(): AudioBuffer {
    return { length: 8, numberOfChannels: 1, sampleRate: RATE, duration: 8 / RATE } as unknown as AudioBuffer;
}

function makeContext() {
    const nodes: MockNode[] = [];
    const node = (name: string, extra: Record<string, unknown> = {}): MockNode => {
        const n = { name, connect: vi.fn(), disconnect: vi.fn(), ...extra } as MockNode;
        nodes.push(n);
        return n;
    };
    const gains: MockNode[] = [];
    const ctx = {
        sampleRate: RATE,
        currentTime: 0,
        createOscillator: vi.fn(() => node('osc', { type: 'sawtooth', frequency: param(), start: vi.fn(), stop: vi.fn() })),
        createBufferSource: vi.fn(() =>
            node('bufsrc', { buffer: null, loop: false, playbackRate: param(), start: vi.fn(), stop: vi.fn() })),
        createBiquadFilter: vi.fn(() => node('biquad', { type: 'lowpass', frequency: param(), Q: { value: 0 } })),
        createGain: vi.fn(() => {
            const g = node(`gain${gains.length}`, { gain: param() });
            gains.push(g);
            return g;
        }),
        createDelay: vi.fn(() => node('delay', { delayTime: { value: 0 } })),
        createStereoPanner: vi.fn(() => node('panner', { pan: param() })),
    } as unknown as AudioContext;
    const find = (name: string) => nodes.find((n) => n.name === name)!;
    // Voice builds filterBus first, then the biquad, then the output gain.
    return { ctx, nodes, find, bus: () => gains[0], outGain: () => gains[1], biquad: () => find('biquad') };
}

// ── Backend stubs ────────────────────────────────────────────────────────────

class StubTable implements OscillatorBackend {
    readonly label: string;
    isSupported = true;
    isReady = true;
    capabilities: BackendCapabilities = {
        simd: false, threads: false, offline: true, polyphony: 8, shapes: ['saw', 'sqr', 'tri', 'sin'],
    };
    lastRequest: GenerateRequest | null = null;
    readonly id: OscillatorBackendId;
    constructor(id: OscillatorBackendId) {
        this.id = id;
        this.label = id;
    }
    init(): Promise<InitResult> {
        return Promise.resolve({ ok: true, backendId: this.id });
    }
    supportsShape(shape: WaveShape): boolean {
        return this.capabilities.shapes.includes(shape);
    }
    generate(): Promise<Float32Array | null> {
        return Promise.resolve(new Float32Array(4));
    }
    renderLoop(_ctx: BaseAudioContext, req: GenerateRequest): LoopRender | null {
        this.lastRequest = req;
        return { buffer: makeAudioBuffer(), baseFrequency: 261.63 };
    }
    dispose(): void {}
}

class StubLive extends StubTable {
    outputs: MockNode[] = [];
    constructor(id: OscillatorBackendId) {
        super(id);
        this.capabilities = { ...this.capabilities, offline: false };
        (this as { renderLoop?: unknown }).renderLoop = undefined;
    }
    acquireVoice(_ctx: BaseAudioContext, reuse: RealtimeVoice | null): RealtimeVoice | null {
        if (reuse?.backendId === this.id && reuse.alive) return reuse;
        const output = { name: 'live', connect: vi.fn(), disconnect: vi.fn() } as MockNode;
        this.outputs.push(output);
        return {
            backendId: this.id,
            output: output as unknown as AudioNode,
            frequency: param() as unknown as AudioParam,
            alive: true,
            start: vi.fn(),
            stop: vi.fn(),
            release: vi.fn(),
        };
    }
}

function install(...backends: OscillatorBackend[]): void {
    const registry = new BackendRegistry();
    for (const b of backends) registry.register(b);
    setOscillatorRegistry(registry);
}

// ── A wasm filter stand-in (WASM OSC by default) ─────────────────────────────

function makeWamFilter(opts: { unavailable?: string | null; acquireFails?: boolean } = {}) {
    return makeStageFilter('wam', opts);
}

function makeStageFilter(
    source: StagedFilterSource,
    opts: { unavailable?: string | null; acquireFails?: boolean } = {},
) {
    const made: Array<{
        input: MockNode;
        output: MockNode;
        set: ReturnType<typeof vi.fn>;
        release: ReturnType<typeof vi.fn>;
    }> = [];
    const node = { name: `${source}filter`, connect: vi.fn(), disconnect: vi.fn() } as MockNode;
    const filter = {
        failure: null as string | null,
        unavailableReason: vi.fn(() => opts.unavailable ?? null),
        acquire: vi.fn(() => {
            if (opts.acquireFails) {
                filter.failure = 'AudioWorkletNode creation failed: boom';
                return null;
            }
            const f = { input: node, output: node, set: vi.fn(), release: vi.fn(), alive: true };
            made.push(f);
            return f as unknown as WamFilterNode;
        }),
    };
    setFilterStage(source, filter as unknown as WamFilter);
    return { filter, made, node };
}

beforeEach(() => {
    // The once-per-cause set is static on Voice; a fresh reason text per test keeps them independent.
    for (const source of ['wam', 'rust'] as const) engineDegradationStore.clear(filterSourceIssueId(source));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    setOscillatorRegistry(null);
    setWamFilter(null);
    setFilterStage('rust', null);
    vi.restoreAllMocks();
});

// ── native filter: default, and the new types ───────────────────────────────

describe('native filter', () => {
    it('is untouched for a song saved before filterType existed: a lowpass at the same cutoff and Q', () => {
        const table = new StubTable('wam');
        install(table, new StubTable('js'));
        const g = makeContext();

        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'wam-saw' }, 'C4', 0);

        const biquad = g.biquad() as unknown as MockNode & { type: string; Q: { value: number }; frequency: ReturnType<typeof param> };
        expect(biquad.type).toBe('lowpass');
        expect(biquad.frequency.setValueAtTime).toHaveBeenCalledWith(2000, 0);
        expect(biquad.Q.value).toBe(6);
        // The legacy case: the host bakes the same lowpass (unchanged behaviour).
        expect(table.lastRequest).toMatchObject({ cutoff: 2000, resonance: 6, filterType: 'lp' });
        // Sources reach the biquad through the bus, and nothing connects past it.
        expect(g.bus().connect).toHaveBeenCalledWith(biquad);
    });

    it.each([['bp', 'bandpass'], ['hp', 'highpass'], ['lp', 'lowpass']] as const)(
        'filterType %s sets the BiquadFilterNode to %s',
        (filterType, biquadType) => {
            install(new StubTable('wam'), new StubTable('js'));
            const g = makeContext();
            new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
                .startNote({ ...BASE, waveform: 'wam-saw', filterType }, 'C4', 0);
            expect((g.biquad() as unknown as { type: string }).type).toBe(biquadType);
        },
    );

    it.each(['bp', 'hp'] as const)(
        'a %s asks the host to bake NO filter of its own (a baked lowpass in front would eat it)',
        (filterType) => {
            const table = new StubTable('wam');
            install(table, new StubTable('js'));
            new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode)
                .startNote({ ...BASE, waveform: 'wam-saw', filterType }, 'C4', 0);
            expect(table.lastRequest).toMatchObject({
                cutoff: maxFilterCutoff(RATE),
                resonance: FLAT_RESONANCE,
                filterType: 'lp',
            });
        },
    );

    it('never touches the WASM filter when it was not asked for', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { filter } = makeWamFilter();
        new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'wam-saw' }, 'C4', 0);
        expect(filter.acquire).not.toHaveBeenCalled();
        expect(engineDegradationStore.getIssue(filterSourceIssueId('wam'))).toBeUndefined();
    });
});

// ── the WASM OSC filter as the source ────────────────────────────────────────

describe('WASM OSC filter source', () => {
    it.each([
        ['wam-saw', 'wam'],
        ['wgsl-saw', 'webgpu'],
        ['pyodide-saw', 'pyodide'],
        ['wav-saw', 'wav'],
    ] as const)('filters a %s table: bus → WASM filter → output gain, biquad parked', (waveform, backendId) => {
        const table = new StubTable(backendId);
        install(table, new StubTable('js'));
        const { made, node } = makeWamFilter();
        const g = makeContext();

        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform, filterType: 'hp', filterSource: 'wam' }, 'C4', 0.5);

        expect(made).toHaveLength(1);
        expect(g.bus().disconnect).toHaveBeenCalledWith(g.biquad());
        expect(g.bus().connect).toHaveBeenCalledWith(node);
        expect(node.connect).toHaveBeenCalledWith(g.outGain());
        expect(made[0].set).toHaveBeenCalledWith(0.5, {
            cutoff: 2000,
            resonance: kernelResonance('hp', 6),
            type: 'hp',
        });
        // The WASM stage does the filtering; the host bakes none (no double filter).
        expect(table.lastRequest).toMatchObject({ cutoff: maxFilterCutoff(RATE), resonance: FLAT_RESONANCE, filterType: 'lp' });
    });

    it('filters a plain OscillatorNode (the terminal js step) too', () => {
        const js = new StubTable('js');
        (js as { renderLoop?: unknown }).renderLoop = undefined; // the real js backend has no table
        install(js);
        const { made, node } = makeWamFilter();
        const g = makeContext();

        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'sawtooth', filterSource: 'wam' }, 'C4', 0);

        const osc = g.find('osc');
        expect(osc.connect).toHaveBeenCalledWith(g.bus());
        expect(g.bus().connect).toHaveBeenCalledWith(node);
        expect(made[0].set).toHaveBeenCalledWith(0, expect.objectContaining({ type: 'lp' }));
    });

    it('filters a worklet-resident host (rust-*) through the same bus', () => {
        const rust = new StubLive('rust');
        install(rust, new StubTable('js'));
        const { made, node } = makeWamFilter();
        const g = makeContext();

        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'rust-saw', filterType: 'bp', filterSource: 'wam' }, 'C4', 0);

        expect(rust.outputs[0].connect).toHaveBeenCalledWith(g.bus());
        expect(g.bus().connect).toHaveBeenCalledWith(node);
        expect(made[0].set).toHaveBeenCalledWith(0, expect.objectContaining({ type: 'bp', resonance: 6 }));
    });

    it('feeds the kernel the Q the native filter would use for the same knob', () => {
        expect(kernelResonance('lp', 0)).toBeCloseTo(1, 12);
        expect(kernelResonance('hp', 20)).toBeCloseTo(10, 12); // 20 dB
        expect(kernelResonance('bp', 5)).toBe(5); // a bandpass reads Q linearly
        expect(kernelResonance('lp', Number.NaN)).toBe(FLAT_RESONANCE);
        expect(kernelResonance('lp', -400)).toBe(0.1); // floored, never zero
    });

    it('keeps one WASM filter across notes instead of acquiring per note', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { filter, made } = makeWamFilter();
        const voice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);
        const params: SynthParams = { ...BASE, waveform: 'wam-saw', filterSource: 'wam' };

        voice.startNote(params, 'C4', 0);
        voice.startNote(params, 'E4', 1);

        expect(filter.acquire).toHaveBeenCalledTimes(1);
        expect(made[0].set).toHaveBeenCalledTimes(2);
        expect(made[0].release).not.toHaveBeenCalled();
    });

    it('hands the filter back and rewires to the biquad when the voice goes back to native', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { made, node } = makeWamFilter();
        const g = makeContext();
        const voice = new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode);

        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'wam' }, 'C4', 0);
        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'native' }, 'C4', 1);

        expect(g.bus().disconnect).toHaveBeenCalledWith(node);
        expect(made[0].release).toHaveBeenCalledTimes(1);
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.biquad());
    });
});

// ── degradation: never silent ────────────────────────────────────────────────

describe('when the WASM OSC filter cannot run', () => {
    it.each([
        ['not initialized', { unavailable: 'not initialized (cold-boot unit test)' }],
        ['a different (offline) context', { unavailable: 'different AudioContext (offline render)' }],
        ['a node that cannot be created', { acquireFails: true }],
    ])('%s: runs the native filter, reports it, and the host still gets what the native filter needs', (_name, opts) => {
        const table = new StubTable('wam');
        install(table, new StubTable('js'));
        makeWamFilter(opts);
        const g = makeContext();

        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'wam-saw', filterType: 'lp', filterSource: 'wam' }, 'C4', 0);

        // The sound is filtered by the native biquad…
        const biquad = g.biquad() as unknown as MockNode & { type: string };
        expect(biquad.type).toBe('lowpass');
        expect(g.bus().disconnect).not.toHaveBeenCalled();
        // …and the host was NOT opened up for a WASM filter that is not there.
        expect(table.lastRequest).toMatchObject({ cutoff: 2000, resonance: 6 });
        // …and it is said, in the store the HUD/banner read.
        const issue = engineDegradationStore.getIssue(filterSourceIssueId('wam'));
        expect(issue?.requestedBackend).toBe('WASM OSC');
        expect(issue?.activeBackend).toBe('Native');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[FilterSourceFallback]'));
    });

    it('with no filter object at all (audio engine not initialized) it also reports, and still filters natively', () => {
        install(new StubTable('wam'), new StubTable('js'));
        setWamFilter(null);
        const g = makeContext();
        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'wam-saw', filterType: 'hp', filterSource: 'wam' }, 'C4', 0);
        expect((g.biquad() as unknown as { type: string }).type).toBe('highpass');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('wam'))?.reason).toContain('audio engine not initialized');
    });

    it('reports a cause once, not once per note', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeWamFilter({ unavailable: 'once-per-cause unit test reason' });
        const voice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);
        const params: SynthParams = { ...BASE, waveform: 'wam-saw', filterSource: 'wam' };
        for (let t = 0; t < 5; t++) voice.startNote(params, 'C4', t);
        const reports = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('[FilterSourceFallback]'));
        expect(reports).toHaveLength(1);
    });

    it('clears the report once the filter works again, and a later failure is reported afresh', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { filter } = makeWamFilter({ unavailable: 'recovery unit test reason' });
        const voice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);
        const params: SynthParams = { ...BASE, waveform: 'wam-saw', filterSource: 'wam' };

        voice.startNote(params, 'C4', 0);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('wam'))?.status).toBe('active');

        filter.unavailableReason.mockReturnValue(null);
        voice.startNote(params, 'C4', 1);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('wam'))?.status).toBe('resolved');

        filter.unavailableReason.mockReturnValue('recovery unit test reason');
        voice.startNote(params, 'C4', 2);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('wam'))?.status).toBe('active');
    });

    it('a filter that goes away mid-session sends the voice back to the native filter', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { filter, made, node } = makeWamFilter();
        const g = makeContext();
        const voice = new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode);
        const params: SynthParams = { ...BASE, waveform: 'wam-saw', filterSource: 'wam' };

        voice.startNote(params, 'C4', 0);
        filter.unavailableReason.mockReturnValue('worklet failed: simulated mid-session loss');
        voice.startNote(params, 'C4', 1);

        expect(made[0].release).toHaveBeenCalledTimes(1);
        expect(g.bus().disconnect).toHaveBeenCalledWith(node);
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.biquad());
        expect(engineDegradationStore.getIssue(filterSourceIssueId('wam'))?.reason).toContain('simulated mid-session loss');
    });
});

// ── the Rust filter as the source (#1672) ────────────────────────────────────

describe('Rust filter source', () => {
    const startRust = (voice: Voice, waveform: string, extra: Partial<SynthParams> = {}, time = 0) =>
        voice.startNote({ ...BASE, waveform, filterSource: 'rust', ...extra } as SynthParams, 'C4', time);

    it.each([
        ['wam-saw', 'wam'],
        ['wgsl-saw', 'webgpu'],
        ['pyodide-saw', 'pyodide'],
        ['wav-saw', 'wav'],
    ] as const)('filters a %s host through the bus, and the host bakes no filter of its own', (waveform, backendId) => {
        const table = new StubTable(backendId);
        install(table, new StubTable('js'));
        const { made, node } = makeStageFilter('rust');
        const g = makeContext();

        startRust(new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode), waveform, { filterType: 'hp' }, 0.5);

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

    it('filters a plain OscillatorNode (the terminal js step) too', () => {
        const js = new StubTable('js');
        (js as { renderLoop?: unknown }).renderLoop = undefined;
        install(js);
        const { made, node } = makeStageFilter('rust');
        const g = makeContext();

        startRust(new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode), 'sawtooth');

        expect(g.find('osc').connect).toHaveBeenCalledWith(g.bus());
        expect(g.bus().connect).toHaveBeenCalledWith(node);
        expect(made[0].set).toHaveBeenCalledWith(0, expect.objectContaining({ type: 'lp' }));
    });

    it('filters the rust-* oscillator itself: the filter is independent of the engine it follows', () => {
        const rust = new StubLive('rust');
        install(rust, new StubTable('js'));
        const { made, node } = makeStageFilter('rust');
        const g = makeContext();

        startRust(new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode), 'rust-saw', { filterType: 'bp' });

        expect(rust.outputs[0].connect).toHaveBeenCalledWith(g.bus());
        expect(g.bus().connect).toHaveBeenCalledWith(node);
        expect(made[0].set).toHaveBeenCalledWith(0, expect.objectContaining({ type: 'bp', resonance: 6 }));
    });

    it('never touches the Rust filter, or the WASM OSC one, when neither was asked for', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const rust = makeStageFilter('rust');
        const wam = makeStageFilter('wam');
        new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'wam-saw' }, 'C4', 0);
        expect(rust.filter.acquire).not.toHaveBeenCalled();
        expect(wam.filter.acquire).not.toHaveBeenCalled();
    });

    it('asks only the Rust filter for a node, not the WASM OSC one', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const rust = makeStageFilter('rust');
        const wam = makeStageFilter('wam');
        startRust(new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode), 'wam-saw');
        expect(rust.filter.acquire).toHaveBeenCalledTimes(1);
        expect(wam.filter.acquire).not.toHaveBeenCalled();
    });

    it('switching WASM OSC → Rust hands the first node back and wires the second', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const wam = makeStageFilter('wam');
        const rust = makeStageFilter('rust');
        const g = makeContext();
        const voice = new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode);

        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'wam' }, 'C4', 0);
        startRust(voice, 'wam-saw', {}, 1);

        expect(wam.made[0].release).toHaveBeenCalledTimes(1);
        expect(g.bus().disconnect).toHaveBeenCalledWith(wam.node);
        expect(rust.made).toHaveLength(1);
        expect(rust.made[0].release).not.toHaveBeenCalled();
        // Last wire: bus → the Rust node (and never the WASM OSC node again).
        expect(g.bus().connect).toHaveBeenLastCalledWith(rust.node);
        expect(rust.node.connect).toHaveBeenCalledWith(g.outGain());
        expect(rust.made[0].set).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'lp' }));
    });

    it('switching Rust → native hands the node back and rewires the biquad', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const rust = makeStageFilter('rust');
        const g = makeContext();
        const voice = new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode);

        startRust(voice, 'wam-saw');
        voice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'native' }, 'C4', 1);

        expect(g.bus().disconnect).toHaveBeenCalledWith(rust.node);
        expect(rust.made[0].release).toHaveBeenCalledTimes(1);
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.biquad());
    });

    it('keeps one Rust filter across notes instead of acquiring per note', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { filter, made } = makeStageFilter('rust');
        const voice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);
        startRust(voice, 'wam-saw', {}, 0);
        startRust(voice, 'wam-saw', {}, 1);
        expect(filter.acquire).toHaveBeenCalledTimes(1);
        expect(made[0].set).toHaveBeenCalledTimes(2);
    });
});

describe('when the Rust filter cannot run', () => {
    it.each([
        ['not initialized', { unavailable: 'rust_osc.wasm fetch HTTP 404' }],
        ['a node that cannot be created', { acquireFails: true }],
    ])('%s: filters natively, says "Rust" was asked for, and opens no host', (_name, opts) => {
        const table = new StubTable('wam');
        install(table, new StubTable('js'));
        makeStageFilter('rust', opts);
        const g = makeContext();

        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'wam-saw', filterType: 'lp', filterSource: 'rust' }, 'C4', 0);

        expect((g.biquad() as unknown as { type: string }).type).toBe('lowpass');
        expect(g.bus().disconnect).not.toHaveBeenCalled();
        expect(table.lastRequest).toMatchObject({ cutoff: 2000, resonance: 6 });
        const issue = engineDegradationStore.getIssue(filterSourceIssueId('rust'));
        expect(issue?.requestedBackend).toBe('Rust');
        expect(issue?.activeBackend).toBe('Native');
    });

    it('with no Rust filter object at all (audio engine not initialized) it reports and filters natively', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const g = makeContext();
        new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode)
            .startNote({ ...BASE, waveform: 'wam-saw', filterType: 'hp', filterSource: 'rust' }, 'C4', 0);
        expect((g.biquad() as unknown as { type: string }).type).toBe('highpass');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('rust'))?.reason).toContain('audio engine not initialized');
    });

    it('its failure is its own: a WASM OSC voice working does not clear it, and it does not raise the WASM OSC issue', () => {
        install(new StubTable('wam'), new StubTable('js'));
        makeStageFilter('rust', { unavailable: 'rust is down (independence unit test)' });
        makeStageFilter('wam');
        const rustVoice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);
        const wamVoice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);

        rustVoice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'rust' }, 'C4', 0);
        wamVoice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'wam' }, 'C4', 0);
        rustVoice.startNote({ ...BASE, waveform: 'wam-saw', filterSource: 'rust' }, 'C4', 1);

        expect(engineDegradationStore.getIssue(filterSourceIssueId('rust'))?.status).toBe('active');
        expect(engineDegradationStore.getIssue(filterSourceIssueId('wam'))).toBeUndefined();
        // Reported once, not once per note and not re-raised after the other voice's success.
        const reports = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('[FilterSourceFallback]'));
        expect(reports).toHaveLength(1);
    });

    it('clears the report once the Rust filter works again, and a later failure is reported afresh', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { filter } = makeStageFilter('rust', { unavailable: 'rust recovery unit test reason' });
        const voice = new Voice(makeContext().ctx, { connect: vi.fn() } as unknown as AudioNode);
        const params: SynthParams = { ...BASE, waveform: 'wam-saw', filterSource: 'rust' };

        voice.startNote(params, 'C4', 0);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('rust'))?.status).toBe('active');
        filter.unavailableReason.mockReturnValue(null);
        voice.startNote(params, 'C4', 1);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('rust'))?.status).toBe('resolved');
        filter.unavailableReason.mockReturnValue('rust recovery unit test reason');
        voice.startNote(params, 'C4', 2);
        expect(engineDegradationStore.getIssue(filterSourceIssueId('rust'))?.status).toBe('active');
    });

    it('a Rust filter that goes away mid-session sends the voice back to the native filter', () => {
        install(new StubTable('wam'), new StubTable('js'));
        const { filter, made, node } = makeStageFilter('rust');
        const g = makeContext();
        const voice = new Voice(g.ctx, { connect: vi.fn() } as unknown as AudioNode);
        const params: SynthParams = { ...BASE, waveform: 'wam-saw', filterSource: 'rust' };

        voice.startNote(params, 'C4', 0);
        filter.unavailableReason.mockReturnValue('worklet failed: rust mid-session loss');
        voice.startNote(params, 'C4', 1);

        expect(made[0].release).toHaveBeenCalledTimes(1);
        expect(g.bus().disconnect).toHaveBeenCalledWith(node);
        expect(g.bus().connect).toHaveBeenLastCalledWith(g.biquad());
    });
});
