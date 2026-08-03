/**
 * Adapters wrapping each concrete oscillator engine in the shared
 * `OscillatorBackend` contract (#1034).
 *
 * The adapters own no DSP — they normalize readiness, capabilities and the
 * generate signature so lifecycle/selection code has exactly one shape to
 * talk to. Engines keep their existing public API for direct callers
 * (VoiceManager still calls `wasmEngine.generate(...)` on the hot path).
 */

import type { WebGpuOscillator } from '../WebGpuOscillator';
import type { WasmOscillator } from '../WasmOscillator';
import type { RustOscillator } from '../RustOscillator';
import { shapeToOscillatorType, type WaveShape } from '../../utils/waveformParser';
import { engineTelemetry } from '../../utils/engineTelemetry';
import type {
    BackendCapabilities,
    GenerateRequest,
    InitResult,
    OscillatorBackend,
    OscillatorBackendId,
} from './OscillatorBackend';
import { BACKEND_LABELS } from './OscillatorBackend';

const ALL_SHAPES: readonly WaveShape[] = ['saw', 'sqr', 'tri', 'sin'];

/** Shared plumbing: id/label, init bookkeeping, telemetry-safe helpers. */
abstract class BaseBackend implements OscillatorBackend {
    abstract readonly id: OscillatorBackendId;
    abstract readonly capabilities: BackendCapabilities;

    protected initialized = false;
    protected failureReason: string | null = null;

    get label(): string {
        return BACKEND_LABELS[this.id];
    }

    abstract get isSupported(): boolean;

    get isReady(): boolean {
        return this.initialized && this.isSupported;
    }

    supportsShape(shape: WaveShape): boolean {
        return this.capabilities.shapes.includes(shape);
    }

    abstract init(ctx: AudioContext): Promise<InitResult>;
    abstract generate(req: GenerateRequest): Promise<Float32Array | null>;

    dispose(): void {
        this.initialized = false;
    }

    protected ok(reason?: string): InitResult {
        this.initialized = true;
        this.failureReason = null;
        return { ok: true, backendId: this.id, reason };
    }

    protected fail(reason: string): InitResult {
        this.initialized = false;
        this.failureReason = reason;
        return { ok: false, backendId: this.id, reason };
    }

    /** Latency recording must never break audio init. */
    protected timed<T>(fn: () => T): T {
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        const out = fn();
        try {
            if (typeof performance !== 'undefined') {
                engineTelemetry.recordLatency(`oscillator-${this.id}`, performance.now() - t0);
            }
        } catch {
            /* telemetry is best-effort */
        }
        return out;
    }
}

export class WebGpuBackend extends BaseBackend {
    readonly id = 'webgpu' as const;
    readonly capabilities: BackendCapabilities = {
        simd: false,
        threads: true,
        offline: true,
        polyphony: 64,
        shapes: ALL_SHAPES,
    };

    private readonly engine: WebGpuOscillator;

    constructor(engine: WebGpuOscillator) {
        super();
        this.engine = engine;
    }

    /** Exposed so lifecycle code can keep handing the raw engine to consumers. */
    get raw(): WebGpuOscillator {
        return this.engine;
    }

    get isSupported(): boolean {
        return this.engine.isSupported;
    }

    async init(_ctx?: AudioContext): Promise<InitResult> {
        try {
            await this.engine.init();
        } catch (e) {
            return this.fail(`WebGpuOscillator.init() threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        return this.engine.isSupported
            ? this.ok('device-ready')
            : this.fail('WebGPU unavailable (no adapter/device)');
    }

    async generate(req: GenerateRequest): Promise<Float32Array | null> {
        if (!this.isReady) return null;
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        const out = await this.engine.generate(req.frequency, req.duration, req.sampleRate, req.shape);
        try {
            if (typeof performance !== 'undefined') {
                engineTelemetry.recordLatency('oscillator-webgpu', performance.now() - t0);
            }
        } catch {
            /* best-effort */
        }
        return out;
    }

    dispose(): void {
        super.dispose();
        this.engine.destroy();
    }
}

export class WamWasmBackend extends BaseBackend {
    readonly id = 'wam' as const;
    readonly capabilities: BackendCapabilities = {
        simd: true,
        threads: false,
        offline: true,
        polyphony: 16,
        shapes: ALL_SHAPES,
    };

    private readonly engine: WasmOscillator;

    constructor(engine: WasmOscillator) {
        super();
        this.engine = engine;
    }

    get raw(): WasmOscillator {
        return this.engine;
    }

    get isSupported(): boolean {
        return typeof WebAssembly !== 'undefined';
    }

    async init(_ctx?: AudioContext): Promise<InitResult> {
        if (!this.isSupported) return this.fail('WebAssembly unavailable');
        try {
            await this.engine.init();
        } catch (e) {
            return this.fail(`WasmOscillator.init() threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        return this.engine.isReady
            ? this.ok('loaded')
            : this.fail('oscillators.wasm instantiation failed');
    }

    get isReady(): boolean {
        return this.initialized && this.engine.isReady;
    }

    async generate(req: GenerateRequest): Promise<Float32Array | null> {
        if (!this.isReady) return null;
        return this.timed(() =>
            this.engine.generate(
                req.frequency,
                req.duration,
                req.sampleRate,
                req.shape,
                req.cutoff,
                req.resonance,
            ),
        );
    }
}

export class RustWasmBackend extends BaseBackend {
    readonly id = 'rust' as const;
    /** The Rust kernel only implements saw/sqr — tri/sin are NOT substituted here. */
    readonly capabilities: BackendCapabilities = {
        simd: true,
        threads: false,
        offline: true,
        polyphony: 16,
        shapes: ['saw', 'sqr'],
    };

    private readonly engine: RustOscillator;

    constructor(engine: RustOscillator) {
        super();
        this.engine = engine;
    }

    get raw(): RustOscillator {
        return this.engine;
    }

    get isSupported(): boolean {
        return typeof WebAssembly !== 'undefined';
    }

    async init(_ctx?: AudioContext): Promise<InitResult> {
        if (!this.isSupported) return this.fail('WebAssembly unavailable');
        try {
            await this.engine.init();
        } catch (e) {
            return this.fail(`RustOscillator.init() threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        return this.engine.isReady ? this.ok('loaded') : this.fail('rust-wasm module import failed');
    }

    get isReady(): boolean {
        return this.initialized && this.engine.isReady;
    }

    async generate(req: GenerateRequest): Promise<Float32Array | null> {
        // A tri/sin request would come out as a saw — refuse rather than
        // silently change wave family. Callers fall back and log.
        if (!this.isReady || !this.supportsShape(req.shape)) return null;
        return this.timed(() =>
            this.engine.generate(
                req.frequency,
                req.duration,
                req.sampleRate,
                req.shape as 'saw' | 'sqr',
                req.cutoff,
                req.resonance,
            ),
        );
    }
}

/**
 * Pre-decoded WAV/PCM single-cycle tables. Only saw and square exist as assets,
 * matching the buffers loaded in engineLifecycle.
 */
export class WavPcmBackend extends BaseBackend {
    readonly id = 'wav' as const;
    readonly capabilities: BackendCapabilities = {
        simd: false,
        threads: false,
        offline: true,
        polyphony: Number.POSITIVE_INFINITY,
        shapes: ['saw', 'sqr'],
    };

    private buffers: Partial<Record<WaveShape, AudioBuffer | null>> = {};

    constructor(buffers: Partial<Record<WaveShape, AudioBuffer | null>> = {}) {
        super();
        this.buffers = buffers;
    }

    setBuffers(buffers: Partial<Record<WaveShape, AudioBuffer | null>>): void {
        this.buffers = { ...this.buffers, ...buffers };
    }

    get isSupported(): boolean {
        return this.capabilities.shapes.some((s) => !!this.buffers[s]);
    }

    async init(_ctx?: AudioContext): Promise<InitResult> {
        return this.isSupported ? this.ok('pcm-tables-loaded') : this.fail('no WAV tables decoded');
    }

    supportsShape(shape: WaveShape): boolean {
        return this.capabilities.shapes.includes(shape) && !!this.buffers[shape];
    }

    async generate(req: GenerateRequest): Promise<Float32Array | null> {
        if (!this.isReady || !this.supportsShape(req.shape)) return null;
        const buf = this.buffers[req.shape];
        if (!buf) return null;
        // PCM tables are fixed-rate assets; hand back the raw channel data and
        // let the caller resample via playbackRate (as Voice already does).
        return buf.getChannelData(0).slice();
    }
}

/**
 * Terminal backend. Always supported, always ready — renders the correct wave
 * family analytically so the fallback path is never silence and never the
 * wrong harmonic character.
 */
export class JsOscillatorBackend extends BaseBackend {
    readonly id = 'js' as const;
    readonly capabilities: BackendCapabilities = {
        simd: false,
        threads: false,
        offline: true,
        polyphony: Number.POSITIVE_INFINITY,
        shapes: ALL_SHAPES,
    };

    get isSupported(): boolean {
        return true;
    }

    get isReady(): boolean {
        return true;
    }

    async init(_ctx?: AudioContext): Promise<InitResult> {
        return this.ok('always-available');
    }

    /** Native Web Audio type for the shape — used when driving an OscillatorNode. */
    oscillatorTypeFor(shape: WaveShape): OscillatorType {
        return shapeToOscillatorType(shape);
    }

    async generate(req: GenerateRequest): Promise<Float32Array | null> {
        const n = Math.max(1, Math.ceil(req.sampleRate * req.duration));
        const out = new Float32Array(n);
        const inc = req.frequency / req.sampleRate;
        let phase = 0;
        for (let i = 0; i < n; i++) {
            out[i] = sampleShape(req.shape, phase);
            phase += inc;
            if (phase >= 1) phase -= 1;
        }
        return out;
    }
}

/** Naive (non-bandlimited) shape evaluation — matches the JS oscillator family. */
function sampleShape(shape: WaveShape, phase: number): number {
    switch (shape) {
        case 'saw':
            return 2 * phase - 1;
        case 'sqr':
            return phase < 0.5 ? 1 : -1;
        case 'tri':
            return 2 * Math.abs(2 * phase - 1) - 1;
        case 'sin':
            return Math.sin(2 * Math.PI * phase);
    }
}
