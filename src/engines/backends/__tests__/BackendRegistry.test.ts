import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackendRegistry, OSCILLATOR_SUBSYSTEM } from '../BackendRegistry';
import {
    BACKEND_FALLBACK_ORDER,
    type BackendCapabilities,
    type GenerateRequest,
    type InitResult,
    type LoopRender,
    type OscillatorBackend,
    type OscillatorBackendId,
    type RealtimeVoice,
} from '../OscillatorBackend';
import { JsOscillatorBackend } from '../adapters';
import { engineTelemetry } from '../../../utils/engineTelemetry';
import { engineDegradationStore } from '../../../stores/engineDegradationStore';
import type { WaveShape } from '../../../utils/waveformParser';

/** Configurable stub honouring the shared contract — no `as any` anywhere. */
class StubBackend implements OscillatorBackend {
    readonly label: string;
    isSupported: boolean;
    isReady: boolean;
    generateResult: Float32Array | null;
    throwOnGenerate = false;
    generateCalls = 0;

    readonly id: OscillatorBackendId;

    constructor(
        id: OscillatorBackendId,
        opts: {
            supported?: boolean;
            ready?: boolean;
            shapes?: readonly WaveShape[];
            result?: Float32Array | null;
        } = {},
    ) {
        this.id = id;
        this.label = id;
        this.isSupported = opts.supported ?? true;
        this.isReady = opts.ready ?? true;
        this.capabilities = {
            simd: false,
            threads: false,
            offline: true,
            polyphony: 8,
            shapes: opts.shapes ?? ['saw', 'sqr', 'tri', 'sin'],
        };
        this.generateResult = opts.result !== undefined ? opts.result : new Float32Array([1, -1, 1, -1]);
    }

    capabilities: BackendCapabilities;

    async init(): Promise<InitResult> {
        return { ok: this.isReady, backendId: this.id };
    }

    supportsShape(shape: WaveShape): boolean {
        return this.capabilities.shapes.includes(shape);
    }

    async generate(_req: GenerateRequest): Promise<Float32Array | null> {
        this.generateCalls++;
        if (this.throwOnGenerate) throw new Error('boom');
        return this.generateResult;
    }

    renderLoopCalls = 0;

    renderLoop(ctx: BaseAudioContext, _req: GenerateRequest): LoopRender | null {
        this.renderLoopCalls++;
        if (this.throwOnGenerate) throw new Error('boom');
        if (!this.generateResult || !this.generateResult.length) return null;
        const buffer = ctx.createBuffer(1, this.generateResult.length, 44100);
        buffer.getChannelData(0).set(this.generateResult);
        return { buffer, baseFrequency: 261.63 };
    }

    dispose(): void {
        this.isReady = false;
    }
}

const REQ: GenerateRequest = {
    frequency: 261.63,
    duration: 0.05,
    sampleRate: 44100,
    shape: 'saw',
    cutoff: 8000,
    resonance: 1,
};

describe('BackendRegistry ordering', () => {
    beforeEach(() => {
        engineDegradationStore.clear('oscillator-backend');
        vi.restoreAllMocks();
    });

    it('exposes the documented (DWGS) → WebGPU → rust → cpp → wam → pyodide → wav → js chain', () => {
        expect(BACKEND_FALLBACK_ORDER).toEqual(['dwgs', 'webgpu', 'rust', 'cpp', 'wam', 'pyodide', 'wav', 'js']);
    });

    it('orders registered backends by preference, not registration order', () => {
        const registry = new BackendRegistry();
        registry.register(new StubBackend('js'));
        registry.register(new StubBackend('webgpu'));
        registry.register(new StubBackend('pyodide'));
        expect(registry.ordered().map((b) => b.id)).toEqual(['webgpu', 'pyodide', 'js']);
    });

    it('selects the highest-preference backend that is supported and ready', () => {
        const registry = new BackendRegistry();
        registry.register(new StubBackend('webgpu', { supported: false }));
        registry.register(new StubBackend('wam', { ready: false }));
        registry.register(new StubBackend('pyodide'));
        registry.register(new JsOscillatorBackend());

        const resolution = registry.resolve();
        expect(resolution.active).toBe('pyodide');
        expect(resolution.requested).toBe('webgpu');
        expect(resolution.degraded).toBe(true);
        expect(resolution.reason).toContain('webgpu: unsupported in this environment');
        expect(resolution.reason).toContain('wam: not initialized');
    });

    it('is not degraded when the preferred backend is usable', () => {
        const registry = new BackendRegistry();
        registry.register(new StubBackend('webgpu'));
        registry.register(new JsOscillatorBackend());
        const resolution = registry.resolve();
        expect(resolution.active).toBe('webgpu');
        expect(resolution.degraded).toBe(false);
        expect(resolution.reason).toBeUndefined();
    });

    it('skips backends that cannot render the requested shape natively', () => {
        const registry = new BackendRegistry();
        registry.register(new StubBackend('pyodide', { shapes: ['saw', 'sqr'] }));
        registry.register(new JsOscillatorBackend());

        expect(registry.resolve('saw').active).toBe('pyodide');

        const tri = registry.resolve('tri');
        expect(tri.active).toBe('js');
        expect(tri.reason).toContain('does not render "tri" natively');
    });

    it('always resolves to js rather than returning nothing', () => {
        const registry = new BackendRegistry();
        registry.register(new StubBackend('webgpu', { supported: false }));
        registry.register(new JsOscillatorBackend());
        expect(registry.resolve().active).toBe('js');
    });
});

describe('BackendRegistry fallback is always logged and surfaced', () => {
    beforeEach(() => {
        engineDegradationStore.clear('oscillator-backend');
    });

    it('records a telemetry resolution and a degradation store issue on fallback', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry = new BackendRegistry();
        registry.register(new StubBackend('webgpu', { supported: false }));
        registry.register(new JsOscillatorBackend());

        const resolution = registry.resolveAndPublish();
        expect(resolution.active).toBe('js');

        const snapshot = engineTelemetry.snapshot();
        expect(snapshot[OSCILLATOR_SUBSYSTEM]?.resolution?.backend).toBe('js');
        expect(snapshot[OSCILLATOR_SUBSYSTEM]?.resolution?.reason).toContain('webgpu');

        const issue = engineDegradationStore.getIssue('oscillator-backend');
        expect(issue).toBeDefined();
        expect(issue?.activeBackend).toBe('js');
        expect(issue?.requestedBackend).toBe('webgpu');
        expect(issue?.status).toBe('active');

        expect(warn).toHaveBeenCalled();
        expect(warn.mock.calls.some(([msg]) => String(msg).includes('fell back'))).toBe(true);
        warn.mockRestore();
    });

    it('clears the degradation issue when the preferred backend is active', () => {
        const registry = new BackendRegistry();
        registry.register(new StubBackend('webgpu'));
        registry.register(new JsOscillatorBackend());
        registry.resolveAndPublish();
        expect(engineDegradationStore.getIssue('oscillator-backend')?.status).not.toBe('active');
    });
});

describe('BackendRegistry.generate', () => {
    beforeEach(() => {
        engineDegradationStore.clear('oscillator-backend');
    });

    it('falls through to the next backend when one returns no samples', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const gpu = new StubBackend('webgpu', { result: new Float32Array(0) });
        const fallbackBackend = new StubBackend('pyodide');
        const registry = new BackendRegistry();
        registry.register(gpu);
        registry.register(fallbackBackend);

        const out = await registry.generate(REQ);
        expect(out?.backendId).toBe('pyodide');
        expect(gpu.generateCalls).toBe(1);
        expect(fallbackBackend.generateCalls).toBe(1);
        expect(engineDegradationStore.getIssue('oscillator-backend')?.activeBackend).toBe('pyodide');
        warn.mockRestore();
    });

    it('falls through when a backend throws, and records the error', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const gpu = new StubBackend('webgpu');
        gpu.throwOnGenerate = true;
        const registry = new BackendRegistry();
        registry.register(gpu);
        registry.register(new StubBackend('js'));

        const out = await registry.generate(REQ);
        expect(out?.backendId).toBe('js');
        expect(engineTelemetry.snapshot()[OSCILLATOR_SUBSYSTEM]?.errors.count).toBeGreaterThan(0);
        warn.mockRestore();
    });

    it('reports null (loudly) when nothing can render the request', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const registry = new BackendRegistry();
        registry.register(new StubBackend('pyodide', { shapes: ['saw'] }));
        const out = await registry.generate({ ...REQ, shape: 'tri' });
        expect(out).toBeNull();
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
});


/**
 * `renderLoopFrom` is the realtime entry point that replaced VoiceManager's
 * per-prefix ladder (#1294) — it must honour the same single fallback order.
 */
describe('BackendRegistry.renderLoopFrom', () => {
    // Minimal BaseAudioContext: renderLoopFrom only ever needs createBuffer.
    const ctx = {
        sampleRate: 44100,
        createBuffer: (channels: number, length: number, sampleRate: number) => {
            const data = new Float32Array(length);
            return {
                length,
                numberOfChannels: channels,
                sampleRate,
                getChannelData: () => data,
            } as unknown as AudioBuffer;
        },
    } as unknown as BaseAudioContext;

    beforeEach(() => {
        engineDegradationStore.clear('oscillator-backend');
    });

    it('enters the chain at the requested backend and never climbs back up', () => {
        const gpu = new StubBackend('webgpu');
        const wav = new StubBackend('wav');
        const registry = new BackendRegistry();
        registry.register(gpu);
        registry.register(wav);
        registry.register(new JsOscillatorBackend());

        expect(registry.renderLoopFrom('wav', ctx, REQ)).not.toBeNull();
        // Selecting wav-* must not silently promote the note to the GPU engine.
        expect(gpu.renderLoopCalls).toBe(0);
        expect(wav.renderLoopCalls).toBe(1);
    });

    it('drops to the next backend down and reports the degradation', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wam = new StubBackend('wam', { ready: false });
        const wav = new StubBackend('wav');
        const registry = new BackendRegistry();
        registry.register(wam);
        registry.register(wav);

        expect(registry.renderLoopFrom('wam', ctx, REQ)).not.toBeNull();
        const issue = engineDegradationStore.getIssue('oscillator-backend');
        expect(issue?.requestedBackend).toBe('wam');
        expect(issue?.activeBackend).toBe('wav');
        warn.mockRestore();
    });

    it('returns null for the terminal js step, and still publishes it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry = new BackendRegistry();
        registry.register(new StubBackend('wam', { ready: false }));
        registry.register(new JsOscillatorBackend());

        // js has no renderLoop: the caller builds an OscillatorNode instead.
        expect(registry.renderLoopFrom('wam', ctx, REQ)).toBeNull();
        expect(engineDegradationStore.getIssue('oscillator-backend')?.activeBackend).toBe('js');
        warn.mockRestore();
    });

    it('survives a backend that throws and keeps walking', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wam = new StubBackend('wam');
        wam.throwOnGenerate = true;
        const wav = new StubBackend('wav');
        const registry = new BackendRegistry();
        registry.register(wam);
        registry.register(wav);

        expect(registry.renderLoopFrom('wam', ctx, REQ)).not.toBeNull();
        expect(wav.renderLoopCalls).toBe(1);
        warn.mockRestore();
    });
});


/** A worklet-resident backend stub: hands out live voices, renders no table. */
class StubRealtimeBackend extends StubBackend {
    acquireCalls: Array<RealtimeVoice | null> = [];
    voice: RealtimeVoice | null;

    constructor(id: OscillatorBackendId, opts: { ready?: boolean; voice?: RealtimeVoice | null } = {}) {
        super(id, { ready: opts.ready });
        this.capabilities = { ...this.capabilities, offline: false };
        this.voice = opts.voice !== undefined ? opts.voice : fakeVoice(id);
    }

    acquireVoice(_ctx: BaseAudioContext, reuse: RealtimeVoice | null): RealtimeVoice | null {
        this.acquireCalls.push(reuse);
        return reuse && reuse.backendId === this.id ? reuse : this.voice;
    }
}

function fakeVoice(id: OscillatorBackendId): RealtimeVoice {
    return {
        backendId: id,
        output: {} as AudioNode,
        frequency: {} as AudioParam,
        alive: true,
        start: vi.fn(),
        stop: vi.fn(),
        release: vi.fn(),
    };
}

/**
 * `sourceFrom` is the note path's entry point once worklet-resident engines
 * exist (#1664): same single order, but a backend may answer with a live voice.
 */
describe('BackendRegistry.sourceFrom', () => {
    const ctx = {
        sampleRate: 44100,
        createBuffer: (channels: number, length: number, sampleRate: number) => {
            const data = new Float32Array(length);
            return { length, numberOfChannels: channels, sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
        },
    } as unknown as BaseAudioContext;

    beforeEach(() => {
        engineDegradationStore.clear('oscillator-backend');
    });

    it('returns a live voice from a worklet-resident backend, without degrading', () => {
        const rust = new StubRealtimeBackend('rust');
        const wam = new StubBackend('wam');
        const registry = new BackendRegistry();
        registry.register(rust);
        registry.register(wam);

        const source = registry.sourceFrom('rust', ctx, REQ);
        expect(source?.kind).toBe('realtime');
        expect(source?.kind === 'realtime' && source.voice.backendId).toBe('rust');
        expect(wam.renderLoopCalls).toBe(0);
        expect(engineDegradationStore.getIssue('oscillator-backend')).toBeUndefined();
    });

    it('offers the voice\'s current live source back for reuse', () => {
        const rust = new StubRealtimeBackend('rust');
        const registry = new BackendRegistry();
        registry.register(rust);
        const current = fakeVoice('rust');

        const source = registry.sourceFrom('rust', ctx, REQ, current);
        expect(rust.acquireCalls).toEqual([current]);
        expect(source?.kind === 'realtime' && source.voice).toBe(current);
    });

    it('drops rust → wam table when the worklet is not ready, and reports it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry = new BackendRegistry();
        registry.register(new StubRealtimeBackend('rust', { ready: false }));
        const wam = new StubBackend('wam');
        registry.register(wam);

        const source = registry.sourceFrom('rust', ctx, REQ);
        expect(source?.kind).toBe('loop');
        expect(wam.renderLoopCalls).toBe(1);
        const issue = engineDegradationStore.getIssue('oscillator-backend');
        expect(issue?.requestedBackend).toBe('rust');
        expect(issue?.activeBackend).toBe('wam');
        warn.mockRestore();
    });

    it('drops past a backend that returns no voice', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry = new BackendRegistry();
        registry.register(new StubRealtimeBackend('rust', { voice: null }));
        registry.register(new StubBackend('wam'));

        expect(registry.sourceFrom('rust', ctx, REQ)?.kind).toBe('loop');
        expect(engineDegradationStore.getIssue('oscillator-backend')?.reason).toContain('rust: returned no voice');
        warn.mockRestore();
    });

    it('a wgsl-* note without WebGPU lands on the live Rust voice, one step down', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry = new BackendRegistry();
        registry.register(new StubBackend('webgpu', { ready: false }));
        registry.register(new StubRealtimeBackend('rust'));
        registry.register(new StubBackend('wam'));

        const source = registry.sourceFrom('webgpu', ctx, REQ);
        expect(source?.kind === 'realtime' && source.voice.backendId).toBe('rust');
        expect(engineDegradationStore.getIssue('oscillator-backend')?.activeBackend).toBe('rust');
        warn.mockRestore();
    });

    it('renderLoopFrom (tables only) walks past a live-only backend', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rust = new StubRealtimeBackend('rust');
        // A live-only backend has no table to give.
        (rust as { renderLoop?: unknown }).renderLoop = undefined;
        const registry = new BackendRegistry();
        registry.register(rust);
        registry.register(new StubBackend('wam'));

        expect(registry.renderLoopFrom('rust', ctx, REQ)).not.toBeNull();
        expect(rust.acquireCalls).toEqual([]);
        expect(engineDegradationStore.getIssue('oscillator-backend')?.reason).toContain('live source only');
        warn.mockRestore();
    });

    it('falling off the chain to the terminal OscillatorNode is published and reaches the HUD', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry = new BackendRegistry();
        registry.register(new StubRealtimeBackend('rust', { ready: false }));
        registry.register(new StubBackend('wam', { supported: false }));
        registry.register(new JsOscillatorBackend());

        // `js` has no table or voice: the chain runs out and the caller builds an OscillatorNode.
        expect(registry.sourceFrom('rust', ctx, REQ)).toBeNull();

        const issue = engineDegradationStore.getIssue('oscillator-backend');
        expect(issue?.activeBackend).toBe('js');
        expect(issue?.requestedBackend).toBe('rust');
        expect(issue?.reason).toContain('rust: not initialized');
        expect(issue?.reason).toContain('wam: unsupported');

        // The HUD reads getLastResolution(); it must name the engine that sounds.
        const last = registry.getLastResolution();
        expect(last?.active).toBe('js');
        expect(last?.degraded).toBe(true);
        expect(last?.attempts.map((a) => a.id)).toEqual(['rust', 'wam', 'js']);
        warn.mockRestore();
    });

    it('a plain JS oscillator part is the preferred path, not a degradation', () => {
        const registry = new BackendRegistry();
        registry.register(new JsOscillatorBackend());
        expect(registry.sourceFrom('js', ctx, REQ)).toBeNull();
        expect(registry.getLastResolution()?.active).toBe('js');
        expect(registry.getLastResolution()?.degraded).toBe(false);
        expect(engineDegradationStore.getIssue('oscillator-backend')).toBeUndefined();
    });

    it('offline generate() skips a realtime-only backend with that reason', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rust = new StubRealtimeBackend('rust');
        const wam = new StubBackend('wam');
        const registry = new BackendRegistry();
        registry.register(rust);
        registry.register(wam);

        const out = await registry.generate(REQ);
        expect(out?.backendId).toBe('wam');
        expect(rust.generateCalls).toBe(0);
        expect(engineDegradationStore.getIssue('oscillator-backend')?.reason).toContain('rust: realtime only');
        warn.mockRestore();
    });
});

/**
 * DWGS (#1666) heads the order but is `entryOnly`: `dwgs-*` parts enter there
 * and walk the chain below it, while no other family ever lands on it and the
 * generic resolve()/generate() do not consider it.
 */
describe('BackendRegistry entry-only backends (dwgs)', () => {
    const ctx = {
        sampleRate: 44100,
        createBuffer: (channels: number, length: number, sampleRate: number) => {
            const data = new Float32Array(length);
            return { length, numberOfChannels: channels, sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
        },
    } as unknown as BaseAudioContext;

    const entryOnly = (opts: { ready?: boolean } = {}) => {
        const b = new StubRealtimeBackend('dwgs', opts);
        b.capabilities = { ...b.capabilities, entryOnly: true };
        return b;
    };

    beforeEach(() => {
        engineDegradationStore.clear('oscillator-backend');
    });

    it('serves the family that enters at it, without degrading', () => {
        const dwgs = entryOnly();
        const registry = new BackendRegistry();
        registry.register(dwgs);
        registry.register(new StubRealtimeBackend('rust'));

        const source = registry.sourceFrom('dwgs', ctx, REQ);
        expect(source?.kind === 'realtime' && source.voice.backendId).toBe('dwgs');
        expect(engineDegradationStore.getIssue('oscillator-backend')).toBeUndefined();
    });

    it('walks the chain below it when its worklet is not ready, and reports it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry = new BackendRegistry();
        registry.register(entryOnly({ ready: false }));
        registry.register(new StubBackend('webgpu', { ready: false }));
        registry.register(new StubRealtimeBackend('rust'));

        const source = registry.sourceFrom('dwgs', ctx, { ...REQ, shape: 'sqr' });
        expect(source?.kind === 'realtime' && source.voice.backendId).toBe('rust');
        const issue = engineDegradationStore.getIssue('oscillator-backend');
        expect(issue?.requestedBackend).toBe('dwgs');
        expect(issue?.activeBackend).toBe('rust');
        warn.mockRestore();
    });

    it('is never a fallback for another family', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const dwgs = entryOnly();
        const registry = new BackendRegistry();
        registry.register(dwgs);
        registry.register(new StubBackend('webgpu', { ready: false }));
        registry.register(new StubBackend('wam'));

        // Ordered before webgpu, yet a wgsl-* part skips it on the way down.
        expect(registry.sourceFrom('webgpu', ctx, REQ)?.kind).toBe('loop');
        expect(dwgs.acquireCalls).toEqual([]);
        expect(engineDegradationStore.getIssue('oscillator-backend')?.reason ?? '').not.toContain('dwgs');
        warn.mockRestore();
    });

    it('is not what a generic resolve() or generate() requests or picks', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const dwgs = entryOnly();
        const registry = new BackendRegistry();
        registry.register(dwgs);
        registry.register(new StubBackend('wam'));
        registry.register(new JsOscillatorBackend());

        const resolution = registry.resolve();
        expect(resolution.requested).toBe('wam');
        expect(resolution.active).toBe('wam');
        expect(resolution.attempts.map((a) => a.id)).not.toContain('dwgs');

        const out = await registry.generate(REQ);
        expect(out?.backendId).toBe('wam');
        expect(dwgs.generateCalls).toBe(0);
        expect(engineDegradationStore.getIssue('oscillator-backend')).toBeUndefined();
        warn.mockRestore();
    });
});
