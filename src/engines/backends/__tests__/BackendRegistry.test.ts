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

    it('exposes the documented WebGPU → wam → rust → wav → js chain', () => {
        expect(BACKEND_FALLBACK_ORDER).toEqual(['webgpu', 'wam', 'pyodide', 'wav', 'js']);
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
