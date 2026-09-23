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
import { shapeToOscillatorType, type WaveShape } from '../../utils/waveformParser';
import { engineTelemetry } from '../../utils/engineTelemetry';
import {
    PYODIDE_REF_FREQ,
    generatePyodideLoopBuffer,
    type PyodideLike,
} from '../../utils/pyodideBuffers';
import type {
    BackendCapabilities,
    GenerateRequest,
    InitResult,
    LoopRender,
    OscillatorBackend,
    OscillatorBackendId,
} from './OscillatorBackend';
import { BACKEND_LABELS, TABLE_DURATION_SEC, TABLE_REF_FREQ } from './OscillatorBackend';

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
    /**
     * GPU rendering is async and the note path is not, so the four shape tables
     * are pre-rendered once during `init()` and looped from cache afterwards.
     * Before this, `VoiceManager` read a `wgslBuffers` dependency that nothing
     * ever populated — every `wgsl-*` note fell through to `OscillatorNode`.
     */
    private tables: Partial<Record<WaveShape, AudioBuffer>> = {};

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

    /** Only ready once at least one table is actually on hand. */
    get isReady(): boolean {
        return this.initialized && this.isSupported && ALL_SHAPES.some((s) => !!this.tables[s]);
    }

    supportsShape(shape: WaveShape): boolean {
        return !!this.tables[shape];
    }

    async init(ctx?: AudioContext): Promise<InitResult> {
        try {
            await this.engine.init();
        } catch (e) {
            return this.fail(`WebGpuOscillator.init() threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!this.engine.isSupported) {
            return this.fail('WebGPU unavailable (no adapter/device)');
        }
        if (!ctx) {
            return this.fail('no AudioContext — cannot pre-render GPU wavetables');
        }
        const rendered = await this.prerenderTables(ctx);
        return rendered > 0
            ? this.ok(`device-ready (${rendered}/${ALL_SHAPES.length} tables)`)
            : this.fail('GPU device ready but no wavetable could be rendered');
    }

    /** Render every shape once; returns how many succeeded. */
    private async prerenderTables(ctx: AudioContext): Promise<number> {
        let count = 0;
        for (const shape of ALL_SHAPES) {
            try {
                const samples = await this.engine.generate(
                    TABLE_REF_FREQ,
                    TABLE_DURATION_SEC,
                    ctx.sampleRate,
                    shape,
                );
                if (samples && samples.length) {
                    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
                    buffer.getChannelData(0).set(samples);
                    this.tables[shape] = buffer;
                    count++;
                }
            } catch (e) {
                console.warn(`[WebGpuBackend] pre-render of "${shape}" failed`, e);
            }
        }
        return count;
    }

    renderLoop(_ctx: BaseAudioContext, req: GenerateRequest): LoopRender | null {
        if (!this.isReady) return null;
        const buffer = this.tables[req.shape];
        return buffer ? { buffer, baseFrequency: TABLE_REF_FREQ } : null;
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
        this.tables = {};
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

    generate(req: GenerateRequest): Promise<Float32Array | null> {
        return Promise.resolve(this.generateSync(req));
    }

    /** The AS kernel is synchronous, so the realtime path can call it inline. */
    private generateSync(req: GenerateRequest): Float32Array | null {
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

    renderLoop(ctx: BaseAudioContext, req: GenerateRequest): LoopRender | null {
        // Render one table at the reference pitch and resample via playbackRate,
        // rather than re-rendering per note.
        const samples = this.generateSync({
            ...req,
            frequency: TABLE_REF_FREQ,
            duration: TABLE_DURATION_SEC,
        });
        return samples ? toLoopBuffer(ctx, samples, TABLE_REF_FREQ) : null;
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

    renderLoop(_ctx: BaseAudioContext, req: GenerateRequest): LoopRender | null {
        if (!this.isReady || !this.supportsShape(req.shape)) return null;
        const buffer = this.buffers[req.shape];
        // Decoded asset — reused as-is, no per-note copy.
        return buffer ? { buffer, baseFrequency: TABLE_REF_FREQ } : null;
    }
}

/**
 * NumPy/SciPy oscillators running in the vendored CPython (`usePyodideEngine`).
 *
 * Registered as a first-class backend so `pyodide-*` waveforms go through the
 * same selection and fallback path as everything else — previously this lived
 * as its own branch of the `VoiceManager` ladder and was invisible to the
 * registry. It is never a *preferred* backend: it sits below `wam` in
 * `BACKEND_FALLBACK_ORDER` and only becomes ready once the runtime is loaded,
 * so nothing drags Pyodide onto the entry graph (#1257).
 */
export class PyodideBackend extends BaseBackend {
    readonly id = 'pyodide' as const;
    readonly capabilities: BackendCapabilities = {
        simd: false,
        threads: false,
        offline: true,
        polyphony: 8,
        // `tri` is rendered as a sine by generate_wave(); PYODIDE_OSC_TYPE maps
        // it, so the family is declared here and the substitution is the
        // Python side's, not a silent one made by selection code.
        shapes: ALL_SHAPES,
    };

    private engine: PyodideLike | null = null;
    private tables: Partial<Record<WaveShape, AudioBuffer>> = {};
    /** Needed to allocate buffers on the async `generate()` path. */
    private ctx: BaseAudioContext | null = null;

    constructor(engine: PyodideLike | null = null) {
        super();
        this.engine = engine;
    }

    /** Pyodide loads lazily and long after audio init, so the handle is late-bound. */
    setEngine(engine: PyodideLike | null): void {
        this.engine = engine;
        this.initialized = !!engine;
        if (!engine) this.tables = {};
    }

    /** Pre-rendered tables from the idle-time warm-up, when there are any. */
    setTables(tables: Partial<Record<WaveShape, AudioBuffer | null>>): void {
        for (const [shape, buf] of Object.entries(tables)) {
            if (buf) this.tables[shape as WaveShape] = buf;
        }
    }

    get isSupported(): boolean {
        return !!this.engine;
    }

    init(ctx?: AudioContext): Promise<InitResult> {
        if (ctx) this.ctx = ctx;
        return Promise.resolve(
            this.engine ? this.ok('pyodide-runtime-attached') : this.fail('Pyodide runtime not loaded'),
        );
    }

    generate(req: GenerateRequest): Promise<Float32Array | null> {
        if (!this.ctx) return Promise.resolve(null);
        const rendered = this.renderLoop(this.ctx, req);
        return Promise.resolve(rendered ? rendered.buffer.getChannelData(0).slice() : null);
    }

    renderLoop(ctx: BaseAudioContext, req: GenerateRequest): LoopRender | null {
        if (!this.isReady || !this.engine) return null;
        this.ctx = ctx;
        const cached = this.tables[req.shape];
        if (cached) return { buffer: cached, baseFrequency: PYODIDE_REF_FREQ };
        const buffer = this.timed(() =>
            generatePyodideLoopBuffer(this.engine!, ctx, req.shape, req.cutoff, req.resonance),
        );
        if (!buffer) return null;
        this.tables[req.shape] = buffer;
        return { buffer, baseFrequency: PYODIDE_REF_FREQ };
    }

    dispose(): void {
        super.dispose();
        this.engine = null;
        this.ctx = null;
        this.tables = {};
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

/**
 * Wrap rendered samples in an `AudioBuffer` for the looped realtime path.
 * Kept in one place so every generator backend allocates identically.
 */
function toLoopBuffer(
    ctx: BaseAudioContext,
    samples: Float32Array,
    baseFrequency: number,
): LoopRender | null {
    if (!samples.length) return null;
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    return { buffer, baseFrequency };
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
