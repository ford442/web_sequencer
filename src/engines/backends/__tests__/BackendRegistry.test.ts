import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackendRegistry, OSCILLATOR_SUBSYSTEM } from '../BackendRegistry';
import {
    BACKEND_FALLBACK_ORDER,
    type BackendCapabilities,
    type GenerateRequest,
    type InitResult,
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
        expect(BACKEND_FALLBACK_ORDER).toEqual(['webgpu', 'wam', 'rust', 'wav', 'js']);
    });

    it('orders registered backends by preference, not registration order', () => {
        const registry = new BackendRegistry();
        registry.register(new StubBackend('js'));
        registry.register(new StubBackend('webgpu'));
        registry.register(new StubBackend('rust'));
        expect(registry.ordered().map((b) => b.id)).toEqual(['webgpu', 'rust', 'js']);
    });

    it('selects the highest-preference backend that is supported and ready', () => {
        const registry = new BackendRegistry();
        registry.register(new StubBackend('webgpu', { supported: false }));
        registry.register(new StubBackend('wam', { ready: false }));
        registry.register(new StubBackend('rust'));
        registry.register(new JsOscillatorBackend());

        const resolution = registry.resolve();
        expect(resolution.active).toBe('rust');
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
        registry.register(new StubBackend('rust', { shapes: ['saw', 'sqr'] }));
        registry.register(new JsOscillatorBackend());

        expect(registry.resolve('saw').active).toBe('rust');

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
        const rust = new StubBackend('rust');
        const registry = new BackendRegistry();
        registry.register(gpu);
        registry.register(rust);

        const out = await registry.generate(REQ);
        expect(out?.backendId).toBe('rust');
        expect(gpu.generateCalls).toBe(1);
        expect(rust.generateCalls).toBe(1);
        expect(engineDegradationStore.getIssue('oscillator-backend')?.activeBackend).toBe('rust');
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
        registry.register(new StubBackend('rust', { shapes: ['saw'] }));
        const out = await registry.generate({ ...REQ, shape: 'tri' });
        expect(out).toBeNull();
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
});
