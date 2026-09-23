// Tests for Voice.startNote engine routing (#1294).
//
// Voice no longer knows any concrete engine: it asks `BackendRegistry` for the
// backend the engine catalog names for the selected family, and builds an
// `OscillatorNode` of the right wave family only when the chain runs out. Both
// halves are asserted here, plus the two cases that used to be invisible:
// native-worklet families (303 / Prophecy) and retired waveform ids.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Voice } from '../VoiceManager';
import {
    BackendRegistry,
    setOscillatorRegistry,
} from '../backends/BackendRegistry';
import type {
    BackendCapabilities,
    GenerateRequest,
    InitResult,
    LoopRender,
    OscillatorBackend,
    OscillatorBackendId,
} from '../backends/OscillatorBackend';
import type { SynthParams } from '../../types';
import type { WaveShape } from '../../utils/waveformParser';
import { engineDegradationStore } from '../../stores/engineDegradationStore';

// ── Minimal SynthParams fixture ──────────────────────────────────────────────

const BASE_PARAMS: SynthParams = {
    waveform: 'sawtooth',
    pitch: 0,
    filterCutoff: 2000,
    filterResonance: 1,
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

// ── Web Audio mock helpers ───────────────────────────────────────────────────
// We construct a fresh mock AudioContext per test so spy counts stay isolated.

function makeBufferSourceMock() {
    return {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        buffer: null as AudioBuffer | null,
        loop: false,
        playbackRate: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
}

function makeOscillatorMock() {
    return {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        type: 'sawtooth' as OscillatorType,
        frequency: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
}

function makeAudioBuffer(length = 1024): AudioBuffer {
    return {
        length,
        numberOfChannels: 1,
        sampleRate: 44100,
        getChannelData: vi.fn(() => new Float32Array(length)),
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
        duration: length / 44100,
    } as unknown as AudioBuffer;
}

function makeContext(oscMock = makeOscillatorMock(), bufSrcMock = makeBufferSourceMock()) {
    const context = {
        sampleRate: 44100,
        currentTime: 0,
        createOscillator: vi.fn(() => oscMock),
        createBufferSource: vi.fn(() => bufSrcMock),
        createBiquadFilter: vi.fn(() => ({
            connect: vi.fn(),
            frequency: { value: 0, setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
            Q: { value: 0, setValueAtTime: vi.fn() },
            type: 'lowpass',
        })),
        createGain: vi.fn(() => ({
            connect: vi.fn(),
            gain: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        })),
        createDelay: vi.fn(() => ({
            connect: vi.fn(),
            delayTime: { value: 0 },
        })),
        createStereoPanner: vi.fn(() => ({
            connect: vi.fn(),
            pan: { value: 0, setValueAtTime: vi.fn() },
        })),
        createBuffer: vi.fn((_ch: number, len: number) => makeAudioBuffer(len)),
    } as unknown as AudioContext;
    return context;
}

function makeDestination() {
    return { connect: vi.fn() } as unknown as AudioNode;
}

// ── A backend stub honouring the shared contract ─────────────────────────────

class StubBackend implements OscillatorBackend {
    readonly label: string;
    isSupported = true;
    isReady = true;
    capabilities: BackendCapabilities;
    renderLoopCalls = 0;
    lastRequest: GenerateRequest | null = null;
    /** null ⇒ this backend cannot service the request and the chain continues. */
    table: AudioBuffer | null;

    readonly id: OscillatorBackendId;

    constructor(
        id: OscillatorBackendId,
        opts: { ready?: boolean; shapes?: readonly WaveShape[]; table?: AudioBuffer | null } = {},
    ) {
        this.id = id;
        this.label = id;
        this.isReady = opts.ready ?? true;
        this.capabilities = {
            simd: false,
            threads: false,
            offline: true,
            polyphony: 8,
            shapes: opts.shapes ?? ['saw', 'sqr', 'tri', 'sin'],
        };
        this.table = opts.table !== undefined ? opts.table : makeAudioBuffer();
    }

    init(): Promise<InitResult> {
        return Promise.resolve({ ok: this.isReady, backendId: this.id });
    }

    supportsShape(shape: WaveShape): boolean {
        return this.capabilities.shapes.includes(shape);
    }

    generate(): Promise<Float32Array | null> {
        return Promise.resolve(this.table ? new Float32Array(4) : null);
    }

    renderLoop(_ctx: BaseAudioContext, req: GenerateRequest): LoopRender | null {
        this.renderLoopCalls++;
        this.lastRequest = req;
        return this.table ? { buffer: this.table, baseFrequency: 261.63 } : null;
    }

    dispose(): void {
        this.isReady = false;
    }
}

/** Install a registry holding `backends` for the duration of one test. */
function installRegistry(...backends: OscillatorBackend[]): BackendRegistry {
    const registry = new BackendRegistry();
    for (const b of backends) registry.register(b);
    setOscillatorRegistry(registry);
    return registry;
}

function makeVoice(ctx?: AudioContext) {
    return new Voice(ctx ?? makeContext(), makeDestination());
}

beforeEach(() => {
    engineDegradationStore.clear('oscillator-backend');
});

afterEach(() => {
    setOscillatorRegistry(null);
    vi.restoreAllMocks();
});

// ── Registry-driven selection ────────────────────────────────────────────────

describe('Voice.startNote — backend selection', () => {
    it.each([
        ['wav-saw', 'wav', 'saw'],
        ['wam-sqr', 'wam', 'sqr'],
        ['wgsl-tri', 'webgpu', 'tri'],
        ['pyodide-sine', 'pyodide', 'sin'],
    ] as const)('routes %s to the %s backend', (waveform, backendId, shape) => {
        const backend = new StubBackend(backendId);
        installRegistry(backend, new StubBackend('js', { table: null }));
        const ctx = makeContext();
        const voice = makeVoice(ctx);

        voice.startNote({ ...BASE_PARAMS, waveform }, 'C4', 0);

        expect(backend.renderLoopCalls).toBe(1);
        expect(backend.lastRequest?.shape).toBe(shape);
        expect(ctx.createBufferSource).toHaveBeenCalled();
        expect(ctx.createOscillator).not.toHaveBeenCalled();
    });

    it('does not promote a wav-* note up the chain to a preferred backend', () => {
        const gpu = new StubBackend('webgpu');
        const wav = new StubBackend('wav');
        installRegistry(gpu, wav);
        const voice = makeVoice();

        voice.startNote({ ...BASE_PARAMS, waveform: 'wav-saw' }, 'C4', 0);

        expect(gpu.renderLoopCalls).toBe(0);
        expect(wav.renderLoopCalls).toBe(1);
    });

    it('drops to the next backend down and records the degradation', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wam = new StubBackend('wam', { table: null });
        const wav = new StubBackend('wav');
        installRegistry(wam, wav);
        const ctx = makeContext();

        makeVoice(ctx).startNote({ ...BASE_PARAMS, waveform: 'wam-saw' }, 'C4', 0);

        expect(wav.renderLoopCalls).toBe(1);
        expect(ctx.createBufferSource).toHaveBeenCalled();
        const issue = engineDegradationStore.getIssue('oscillator-backend');
        expect(issue?.requestedBackend).toBe('wam');
        expect(issue?.activeBackend).toBe('wav');
    });
});

// ── Terminal JS oscillator ───────────────────────────────────────────────────

describe('Voice.startNote — terminal JS oscillator', () => {
    it('uses createOscillator for plain waveforms without complaint', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        installRegistry(new StubBackend('js', { table: null }));
        const oscMock = makeOscillatorMock();
        const ctx = makeContext(oscMock);

        makeVoice(ctx).startNote({ ...BASE_PARAMS, waveform: 'sawtooth' }, 'C4', 0);

        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(oscMock.type).toBe('sawtooth');
        expect(error).not.toHaveBeenCalled();
    });

    it('maps waveform shapes correctly (square, triangle, sine)', () => {
        installRegistry(new StubBackend('js', { table: null }));
        const shapes: Array<[import('../../types').Waveform, OscillatorType]> = [
            ['square', 'square'],
            ['triangle', 'triangle'],
            ['sine', 'sine'],
        ];
        for (const [waveform, expected] of shapes) {
            const oscMock = makeOscillatorMock();
            const ctx = makeContext(oscMock);
            makeVoice(ctx).startNote({ ...BASE_PARAMS, waveform }, 'C4', 0);
            expect(oscMock.type).toBe(expected);
        }
    });

    it('falls back to the right wave family when the whole chain is unavailable', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        installRegistry(new StubBackend('webgpu', { ready: false }));
        const oscMock = makeOscillatorMock();
        const ctx = makeContext(oscMock);

        makeVoice(ctx).startNote({ ...BASE_PARAMS, waveform: 'wgsl-sqr' }, 'C4', 0);

        expect(oscMock.type).toBe('square');
        expect(engineDegradationStore.getIssue('oscillator-backend')?.activeBackend).toBe('js');
    });

    it('reports, rather than silently serves, a note with no registry at all', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        setOscillatorRegistry(null);
        const ctx = makeContext();

        makeVoice(ctx).startNote({ ...BASE_PARAMS, waveform: 'wam-saw' }, 'C4', 0);

        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('no oscillator backend registry'));
    });
});

// ── Families Voice must not render ───────────────────────────────────────────

describe('Voice.startNote — native-worklet families', () => {
    it.each(['303-saw', 'prophecy-tri'] as const)(
        'reports %s as owned by its worklet manager instead of rendering it',
        (waveform) => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            const gpu = new StubBackend('webgpu');
            installRegistry(gpu);
            const ctx = makeContext();

            makeVoice(ctx).startNote({ ...BASE_PARAMS, waveform }, 'C4', 0);

            // No backend is consulted and nothing is looped — the managers own
            // these voices.
            expect(gpu.renderLoopCalls).toBe(0);
            expect(ctx.createBufferSource).not.toHaveBeenCalled();
            expect(error).toHaveBeenCalledWith(expect.stringContaining('Manager'));
        },
    );
});

// ── Retired waveform ids ─────────────────────────────────────────────────────

describe('Voice.startNote — retired waveform ids', () => {
    it.each([
        ['rust-saw', 'saw'],
        ['cpp-sqr', 'sqr'],
        ['cpp-rand', 'saw'],
    ] as const)('renders %s on the WASM oscillator and reports the rewrite', (waveform, shape) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wam = new StubBackend('wam');
        installRegistry(wam);

        makeVoice().startNote(
            { ...BASE_PARAMS, waveform: waveform as SynthParams['waveform'] },
            'C4',
            0,
        );

        expect(wam.renderLoopCalls).toBe(1);
        expect(wam.lastRequest?.shape).toBe(shape);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('WaveformSubstitution'));
    });
});
