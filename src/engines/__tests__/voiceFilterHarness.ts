// Shared harness for the Voice filter-source suites (#1663, #1672, #1673):
// an inspectable AudioContext, oscillator backend stubs and wasm filter stage
// stand-ins. Voice.filterSource.test.ts, Voice.cppFilterSource.test.ts and
// Voice.dwgsFilterSource.test.ts use it.

import { afterEach, beforeEach, vi } from 'vitest';
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
import { filterSourceIssueId } from '../backends/filterSource';
import { setWamFilter, type WamFilter, type WamFilterNode } from '../WamFilter';
import { setFilterStage, setGpuFilter, setPyodideFilter, type StagedFilterSource } from '../filterStages';
import type { GpuLookup, WebGpuFilter } from '../WebGpuFilter';
import type { PyodideFilter, PyodideLookup } from '../PyodideFilter';
import type { SynthParams } from '../../types';
import type { WaveShape } from '../../utils/waveformParser';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { resetFilterPairingsForTests } from '../../utils/engineTelemetry';

export const RATE = 44100;

export const BASE: SynthParams = {
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

export interface MockNode {
    name: string;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    [k: string]: unknown;
}

export const param = () => ({
    value: 0,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
});

function makeAudioBuffer(): AudioBuffer {
    return { length: 8, numberOfChannels: 1, sampleRate: RATE, duration: 8 / RATE } as unknown as AudioBuffer;
}

export function makeContext() {
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

export class StubTable implements OscillatorBackend {
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

export class StubLive extends StubTable {
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

export function install(...backends: OscillatorBackend[]): void {
    const registry = new BackendRegistry();
    for (const b of backends) registry.register(b);
    setOscillatorRegistry(registry);
}

// ── A wasm filter stand-in (WASM OSC by default) ─────────────────────────────

export function makeWamFilter(opts: { unavailable?: string | null; acquireFails?: boolean } = {}) {
    return makeStageFilter('wam', opts);
}

export function makeStageFilter(
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

// ── The WebGPU filter's bank cache (#1675) ───────────────────────────────────

/** A stand-in for `WebGpuFilter` whose `lookup` answers what the test says. */
export function makeGpuFilter(
    answer: GpuLookup | ((shape: WaveShape, freq: number) => GpuLookup),
    opts: { unavailable?: string | null } = {},
) {
    const filter = {
        unavailableReason: vi.fn(() => opts.unavailable ?? null),
        lookup: vi.fn((_ctx: BaseAudioContext, shape: WaveShape, _spec: unknown, freq: number) =>
            typeof answer === 'function' ? answer(shape, freq) : answer),
    };
    setGpuFilter(filter as unknown as WebGpuFilter);
    return filter;
}

/** A stand-in for `PyodideFilter` (#1676) whose `lookup` answers what the test says. */
export function makePyodideFilter(
    answer: PyodideLookup | ((shape: WaveShape, freq: number) => PyodideLookup),
) {
    const filter = {
        lookup: vi.fn((_ctx: BaseAudioContext, shape: WaveShape, _spec: unknown, freq: number) =>
            typeof answer === 'function' ? answer(shape, freq) : answer),
    };
    setPyodideFilter(filter as unknown as PyodideFilter);
    return filter;
}

/** What a ready bank hands the voice: a loop table and the pitch it sounds at. */
export function readyTable(baseFrequency = 130.8125): Extract<GpuLookup, { kind: 'ready' }> {
    return { kind: 'ready', render: { buffer: makeAudioBuffer(), baseFrequency } };
}

/** The per-test reset every Voice filter-source suite needs. */
export function registerFilterSourceHooks(): void {
    beforeEach(() => {
        // The once-per-cause set is static on Voice; a fresh reason text per test keeps them independent.
        for (const source of ['wam', 'rust', 'cpp', 'dwgs', 'webgpu', 'pyodide'] as const) engineDegradationStore.clear(filterSourceIssueId(source));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        resetFilterPairingsForTests();
    });

    afterEach(() => {
        setOscillatorRegistry(null);
        setWamFilter(null);
        setFilterStage('rust', null);
        setFilterStage('cpp', null);
        setFilterStage('dwgs', null);
        setGpuFilter(null);
        setPyodideFilter(null);
        vi.restoreAllMocks();
    });

}
