// @mode: typescript
// @note-for-ai: This is a native WebGPU implementation (L5 in UIMP).
import { engineTelemetry, logEngineFallback } from '../utils/engineTelemetry';
import { onWebGpuDeviceChange, probeWebGPU } from './backends/webgpuProbe';
import { OSCILLATOR_BANK_MAX_BYTES, OSCILLATOR_MAX_BYTES } from '../webgpu/deviceRequirements';
import type { WaveShape } from '../utils/waveformParser';
import {
    MAX_HARMONICS,
    SHAPE_INDEX,
    WAVETABLE_LENGTH,
    maxHarmonicFor,
    phaseIncrementFor,
    planWavetableBands,
    type WavetableBand,
} from './backends/wavetableBands';
import {
    GPU_FILTER_CUTOFF_MIN,
    GPU_FILTER_Q_MAX,
    GPU_FILTER_Q_MIN,
    planFilteredBank,
    type BankNote,
    type GpuFilterSpec,
} from './backends/gpuFilter';
import { maxFilterCutoff } from './backends/filterSource';
import { oscillatorShader } from './WebGpuOscillatorShader';
// The WGSL lives in WebGpuOscillatorShader.ts. This file handles GPU resource management and buffer pooling.
// See PERFORMANCE_MIGRATION_STRATEGY.md for migration context.

/** Table slots in the kernel's uniform block (a 116-note bank, or shapes × octave bands, with room). */
const MAX_TABLES = 128;
/**
 * Uniform block, as the WGSL `Params` struct lays it out:
 *   0   numSamples, tableCount, filterType, coefStride          (u32 × 4)
 *   16  resp: tan(w0/2), 1/Q, _, _                              (f32 × 4)
 *   32  coefBase, _, _, _                                       (u32 × 4)
 *   48  tables[i]: phase increment, harmonics, shape, offset    (u32 × 4 each)
 *   48 + 16·MAX_TABLES  freqs[i]: audible f0 / sampleRate, _, _, _  (f32 × 4 each)
 */
const HEADER_BYTES = 48;
const TABLES_OFFSET_WORDS = HEADER_BYTES / 4;
const FREQS_OFFSET_WORDS = TABLES_OFFSET_WORDS + MAX_TABLES * 4;
const UNIFORM_BYTES = HEADER_BYTES + MAX_TABLES * 32;
/** Matches `@workgroup_size(64)` in the kernel. */
const WORKGROUP_SIZE = 64;
/** `filterType` value that means "no filter": every harmonic keeps its series gain and phase. */
const FILTER_NONE = 3;

const ALL_SHAPES: readonly WaveShape[] = ['saw', 'sqr', 'tri', 'sin'];
const FILTER_TYPE_INDEX = { lp: 0, bp: 1, hp: 2 } as const;

/** One table of a dispatch: what to render and where it lands in the output. */
interface TableSpec {
    phaseIncrement: number;
    maxHarmonic: number;
    shape: WaveShape;
    /** Audible fundamental in Hz — the pitch the filter's response is evaluated at. Only read when filtering. */
    f0?: number;
}

/** What one `dispatch` is asked to do beyond the tables themselves. */
interface DispatchOptions {
    sampleRate: number;
    filter?: GpuFilterSpec | null;
    /** Cap on the audio bytes read back; the oscillator's default is ~5 s of mono. */
    maxBytes?: number;
}

/** The whole band-limited table set for one sample rate (`renderWavetables`). */
export interface WavetableSet {
    sampleRate: number;
    /** Samples per table (`WAVETABLE_LENGTH`). */
    length: number;
    bands: WavetableBand[];
    /** `tables[shape][band]` — one loopable table per shape per band. */
    tables: Record<WaveShape, Float32Array[]>;
    /** Wall time of the single dispatch + readback, ms. */
    renderMs: number;
}

/**
 * One shape, filtered, for every MIDI note (`renderFilteredBank`, #1675): one
 * loopable table per note, each filtered for *its* pitch. Index `i` is
 * `notes[i].midi`; the table sounds at `bands[notes[i].band].baseFrequency`
 * at `playbackRate` 1.
 */
export interface FilteredBankSet {
    sampleRate: number;
    shape: WaveShape;
    filter: GpuFilterSpec;
    length: number;
    bands: WavetableBand[];
    notes: BankNote[];
    tables: Float32Array[];
    /** Wall time of the single dispatch + readback, ms. */
    renderMs: number;
}

/** A filter the kernel can be given: finite, with a response it knows. */
function usableFilter(filter: GpuFilterSpec, sampleRate: number): boolean {
    return (
        filter.type in FILTER_TYPE_INDEX &&
        Number.isFinite(filter.cutoff) &&
        Number.isFinite(filter.q) &&
        filter.cutoff >= GPU_FILTER_CUTOFF_MIN &&
        filter.cutoff <= maxFilterCutoff(sampleRate) &&
        filter.q >= GPU_FILTER_Q_MIN &&
        filter.q <= GPU_FILTER_Q_MAX
    );
}

export class WebGpuOscillator {
    device: GPUDevice | null = null;
    /** Synthesis pass: sums each table's filtered harmonics. */
    pipeline: GPUComputePipeline | null = null;
    /** Coefficient pass: one gain + phase per (table, harmonic), the filter's response folded in. */
    coefPipeline: GPUComputePipeline | null = null;
    bindGroupLayout: GPUBindGroupLayout | null = null;
    isSupported: boolean = false;

    // Buffer pool for reuse - keyed by size bucket
    private bufferPool: Map<string, { output: GPUBuffer, read: GPUBuffer }[]> = new Map();
    private readonly MAX_POOL_SIZE_PER_BUCKET = 4;
    private readonly MAX_BUFFER_SIZE = OSCILLATOR_MAX_BYTES; // ~5 seconds at 44.1kHz (limit to prevent OOM)
    private readonly SIZE_BUCKET_BYTES = 4096; // Quantize to 4KB buckets
    private unsubscribeDevice: (() => void) | null = null;
    /** Set once init succeeds, so a restored device re-initialises the oscillator. */
    private wantsDevice = false;

    /** Pipeline and pooled buffers die with the shared device; rebuild on restore. */
    private watchDevice(): void {
        if (this.unsubscribeDevice) return;
        this.unsubscribeDevice = onWebGpuDeviceChange((change) => {
            if (change.type === 'lost') {
                if (change.device === this.device) this.releaseDevice();
            } else if (change.type === 'restored') {
                if (this.wantsDevice && !this.isSupported) void this.init();
            } else {
                this.releaseDevice();
            }
        });
    }

    private releaseDevice(): void {
        this.bufferPool.clear();
        this.device = null;
        this.pipeline = null;
        this.coefPipeline = null;
        this.bindGroupLayout = null;
        this.isSupported = false;
    }

    async init() {
        this.watchDevice();
        const probe = await probeWebGPU();
        if (!probe.ok || !probe.device) {
            logEngineFallback(
                'webgpu',
                'webgpu',
                probe.reason ?? 'WebGPU unavailable (no adapter/device)',
            );
            return;
        }

        const device = probe.device;
        // A shader that does not compile does not throw: WebGPU reports it on an
        // error scope and hands back an invalid pipeline, and every dispatch after
        // that silently renders zeros. Catch it here, so the backend is *not*
        // supported and the registry walks on to the next engine.
        const scoped = typeof device.pushErrorScope === 'function' && typeof device.popErrorScope === 'function';
        let invalid: string | null = null;
        try {
            this.device = device;
            if (scoped) device.pushErrorScope('validation');
            try {
                const shaderModule = device.createShaderModule({
                    code: oscillatorShader(MAX_TABLES)
                });

                this.bindGroupLayout = device.createBindGroupLayout({
                    entries: [
                        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
                        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
                    ]
                });

                const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
                this.coefPipeline = device.createComputePipeline({
                    layout,
                    compute: { module: shaderModule, entryPoint: "coeffs" }
                });
                this.pipeline = device.createComputePipeline({
                    layout,
                    compute: { module: shaderModule, entryPoint: "main" }
                });
            } finally {
                if (scoped) {
                    const error = await device.popErrorScope();
                    if (error) invalid = error.message;
                }
            }
            if (invalid) throw new Error(`oscillator shader or pipeline is invalid: ${invalid}`);

            this.isSupported = true;
            this.wantsDevice = true;
            try { engineTelemetry.registerResolution('webgpu', 'webgpu', 'device-ready'); } catch (_) {}
        } catch (e) {
            this.pipeline = null;
            this.coefPipeline = null;
            this.bindGroupLayout = null;
            logEngineFallback('webgpu', 'webgpu', 'GPUDevice or compute pipeline creation failed', e);
        }
    }

    // Quantize size to bucket for better reuse
    private getSizeBucket(size: number): number {
        return Math.ceil(size / this.SIZE_BUCKET_BYTES) * this.SIZE_BUCKET_BYTES;
    }

    // Get or create buffer pair from pool. `outBytes` is the whole storage buffer
    // (audio + coefficients); `readBytes` only the audio the copy brings back.
    private getBuffers(outBytes: number, readBytes: number): { output: GPUBuffer, read: GPUBuffer } | null {
        if (!this.device) return null;

        const outBucket = this.getSizeBucket(outBytes);
        const readBucket = this.getSizeBucket(readBytes);
        const pool = this.bufferPool.get(`${outBucket}:${readBucket}`);

        if (pool && pool.length > 0) {
            return pool.pop()!;
        }

        // Create new buffers
        try {
            const output = this.device.createBuffer({
                size: outBucket,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });

            const read = this.device.createBuffer({
                size: readBucket,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
            });

            return { output, read };
        } catch (e) {
            logEngineFallback('webgpu', 'webgpu', 'GPUBuffer allocation failed', e);
            return null;
        }
    }

    // Return buffers to pool for reuse
    private returnBuffers(buffers: { output: GPUBuffer, read: GPUBuffer }, outBytes: number, readBytes: number) {
        const key = `${this.getSizeBucket(outBytes)}:${this.getSizeBucket(readBytes)}`;

        if (!this.bufferPool.has(key)) {
            this.bufferPool.set(key, []);
        }

        const pool = this.bufferPool.get(key)!;

        if (pool.length < this.MAX_POOL_SIZE_PER_BUCKET) {
            pool.push(buffers);
        } else {
            // Pool is full, destroy these buffers
            buffers.output.destroy();
            buffers.read.destroy();
        }
    }

    // Clean up all pooled buffers (call on dispose)
    destroy() {
        for (const pool of this.bufferPool.values()) {
            for (const buffers of pool) {
                buffers.output.destroy();
                buffers.read.destroy();
            }
        }
        this.bufferPool.clear();
        this.unsubscribeDevice?.();
        this.unsubscribeDevice = null;
        this.wantsDevice = false;
    }

    /**
     * Offline render of `duration` seconds at a fixed pitch — band-limited, so
     * an export of a `wgsl-*` part no longer aliases. Null when WebGPU is not
     * ready or the pitch is not renderable (non-finite, ≤ 0, ≥ Nyquist).
     *
     * With a `filter` (#1675) the note is rendered *through* it: every harmonic
     * is scaled and phase-shifted by the resonant filter's response at its
     * audible frequency, so the result is the biquad's steady state with no
     * onset transient. An unusable filter (non-finite, out of range, unknown
     * response) is refused, never rendered as a different filter.
     */
    async generate(
        frequency: number,
        duration: number,
        sampleRate: number,
        type: WaveShape,
        filter?: GpuFilterSpec | null,
    ): Promise<Float32Array | null> {
        if (!this.device || !this.pipeline || !this.coefPipeline || !this.bindGroupLayout) return null;

        const phaseIncrement = phaseIncrementFor(frequency, sampleRate);
        if (phaseIncrement === null) return null;
        if (filter && !usableFilter(filter, sampleRate)) {
            logEngineFallback('webgpu', 'webgpu', `filter ${JSON.stringify(filter)} is outside what the GPU kernel renders`);
            return null;
        }

        let numSamples = Math.ceil(sampleRate * duration);
        if (!(numSamples > 0)) return null;

        // Guard against very large requests
        if (numSamples * 4 > this.MAX_BUFFER_SIZE) {
            console.warn(`WebGPU: ${numSamples * 4} B exceeds max ${this.MAX_BUFFER_SIZE}, clamping duration`);
            numSamples = Math.floor(this.MAX_BUFFER_SIZE / 4);
        }

        return this.dispatch(
            [{ phaseIncrement, maxHarmonic: maxHarmonicFor(frequency, sampleRate), shape: type, f0: frequency }],
            numSamples,
            { sampleRate, filter },
        );
    }

    /**
     * Every shape × every octave band for `sampleRate`, in ONE dispatch and ONE
     * readback (the old pre-render was four submits and four `mapAsync`s, one
     * per naive shape). Null when WebGPU is not ready or the render failed —
     * the caller fails closed to the next backend.
     */
    async renderWavetables(sampleRate: number): Promise<WavetableSet | null> {
        if (!this.device || !this.pipeline || !this.coefPipeline || !this.bindGroupLayout) return null;
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

        const bands = planWavetableBands(sampleRate);
        if (bands.length === 0) return null;
        const specs: TableSpec[] = [];
        for (const shape of ALL_SHAPES) {
            for (const band of bands) {
                specs.push({ phaseIncrement: band.phaseIncrement, maxHarmonic: band.maxHarmonic, shape });
            }
        }
        if (specs.length > MAX_TABLES || specs.length * WAVETABLE_LENGTH * 4 > this.MAX_BUFFER_SIZE) {
            logEngineFallback('webgpu', 'webgpu', `wavetable set of ${specs.length} tables exceeds the oscillator budget`);
            return null;
        }

        const out = await this.dispatch(specs, WAVETABLE_LENGTH, { sampleRate });
        if (!out) return null;

        const tables = {} as Record<WaveShape, Float32Array[]>;
        let k = 0;
        for (const shape of ALL_SHAPES) {
            tables[shape] = bands.map(() => {
                const view = out.subarray(k * WAVETABLE_LENGTH, (k + 1) * WAVETABLE_LENGTH);
                k++;
                return view;
            });
        }
        const renderMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        return { sampleRate, length: WAVETABLE_LENGTH, bands, tables, renderMs };
    }

    /**
     * One shape, filtered, for every MIDI note (#1675): `BANK_NOTE_COUNT` tables
     * in ONE dispatch and ONE readback. Each note's table has the filter's
     * response evaluated at *its* pitch, so a voice that loops it at
     * `freq / baseFrequency` gets the cutoff it asked for in Hz whatever the
     * note — a cutoff baked in table time would follow the pitch instead.
     * Null when WebGPU is not ready, the filter is unusable or the pass failed.
     */
    async renderFilteredBank(
        sampleRate: number,
        shape: WaveShape,
        filter: GpuFilterSpec,
    ): Promise<FilteredBankSet | null> {
        if (!this.device || !this.pipeline || !this.coefPipeline || !this.bindGroupLayout) return null;
        if (!usableFilter(filter, sampleRate)) {
            logEngineFallback('webgpu', 'webgpu', `filter ${JSON.stringify(filter)} is outside what the GPU kernel renders`);
            return null;
        }
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

        const bands = planWavetableBands(sampleRate);
        const notes = planFilteredBank(bands);
        if (notes.length === 0 || notes.length > MAX_TABLES) return null;
        const specs: TableSpec[] = notes.map((note) => ({
            phaseIncrement: bands[note.band].phaseIncrement,
            maxHarmonic: bands[note.band].maxHarmonic,
            shape,
            f0: note.f0,
        }));

        const out = await this.dispatch(specs, WAVETABLE_LENGTH, {
            sampleRate,
            filter,
            maxBytes: OSCILLATOR_BANK_MAX_BYTES,
        });
        if (!out) return null;

        const tables = notes.map((_, i) => out.subarray(i * WAVETABLE_LENGTH, (i + 1) * WAVETABLE_LENGTH));
        const renderMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        return { sampleRate, shape, filter, length: WAVETABLE_LENGTH, bands, notes, tables, renderMs };
    }

    /**
     * Run the kernel once over `specs.length` tables of `numSamples` each and
     * read the result back as one contiguous array (table-major).
     */
    private async dispatch(
        specs: readonly TableSpec[],
        numSamples: number,
        opts: DispatchOptions,
    ): Promise<Float32Array | null> {
        if (!this.device || !this.pipeline || !this.coefPipeline || !this.bindGroupLayout) return null;
        if (specs.length === 0 || specs.length > MAX_TABLES) return null;

        const totalSamples = numSamples * specs.length;
        const audioBytes = totalSamples * 4;
        // Filtered only: a gain and a phase per (table, harmonic), in the buffer's tail.
        const filter = opts.filter ?? null;
        const coefStride = filter
            ? Math.max(1, ...specs.map((s) => Math.min(MAX_HARMONICS, Math.max(0, Math.floor(s.maxHarmonic)))))
            : 0;
        const outBytes = audioBytes + specs.length * coefStride * 8;
        const groupsX = Math.ceil(numSamples / WORKGROUP_SIZE);
        const coefGroupsX = Math.ceil(coefStride / WORKGROUP_SIZE);
        const maxGroups = this.device.limits?.maxComputeWorkgroupsPerDimension ?? 65535;
        if (audioBytes > (opts.maxBytes ?? this.MAX_BUFFER_SIZE) || groupsX > maxGroups) {
            logEngineFallback('webgpu', 'webgpu', `dispatch of ${totalSamples} samples exceeds one dispatch on this device`);
            return null;
        }

        // 1. Get Buffers from pool
        const buffers = this.getBuffers(outBytes, audioBytes);
        if (!buffers) return null;

        const { output: outputBuffer, read: readBuffer } = buffers;

        // 2. Uniforms: header, one vec4<u32> and one vec4<f32> per table.
        const uniformWords = new ArrayBuffer(UNIFORM_BYTES);
        const u32 = new Uint32Array(uniformWords);
        const f32 = new Float32Array(uniformWords);
        u32[0] = numSamples;
        u32[1] = specs.length;
        u32[2] = filter ? FILTER_TYPE_INDEX[filter.type] : FILTER_NONE;
        u32[3] = coefStride;
        if (filter) {
            f32[4] = Math.tan((Math.PI * filter.cutoff) / opts.sampleRate);
            f32[5] = 1 / filter.q;
        }
        u32[8] = totalSamples;
        specs.forEach((spec, i) => {
            const o = TABLES_OFFSET_WORDS + i * 4;
            u32[o] = spec.phaseIncrement >>> 0;
            u32[o + 1] = Math.max(0, Math.floor(spec.maxHarmonic));
            u32[o + 2] = SHAPE_INDEX[spec.shape] ?? SHAPE_INDEX.saw;
            u32[o + 3] = i * numSamples;
            f32[FREQS_OFFSET_WORDS + i * 4] = filter && spec.f0 ? spec.f0 / opts.sampleRate : 0;
        });

        const uniformBuffer = this.device.createBuffer({
            size: UNIFORM_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(uniformBuffer, 0, u32);

        // 3. Bind Group
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: { buffer: outputBuffer } }
            ]
        });

        // 4. Filtered: a coefficient pass first (x = harmonic, y = table), a separate pass so
        //    its writes are visible to the synthesis. Then x = sample, y = table.
        const commandEncoder = this.device.createCommandEncoder();
        if (filter) {
            const coefPass = commandEncoder.beginComputePass();
            coefPass.setPipeline(this.coefPipeline);
            coefPass.setBindGroup(0, bindGroup);
            coefPass.dispatchWorkgroups(coefGroupsX, specs.length);
            coefPass.end();
        }
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(groupsX, specs.length);
        passEncoder.end();

        commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, audioBytes);
        this.device.queue.submit([commandEncoder.finish()]);

        // 5. Readback
        try {
            await readBuffer.mapAsync(GPUMapMode.READ);
            const copyArray = new Float32Array(readBuffer.getMappedRange());
            const result = new Float32Array(totalSamples);
            result.set(copyArray.subarray(0, totalSamples)); // Only copy actual samples
            readBuffer.unmap();

            // 6. Return buffers to pool
            this.returnBuffers(buffers, outBytes, audioBytes);

            // Destroy small uniform buffer (not worth pooling)
            uniformBuffer.destroy();

            return result;
        } catch (e) {
            logEngineFallback('webgpu', 'webgpu', 'GPU buffer readback failed', e);
            // Destroy buffers on error - don't return to pool
            outputBuffer.destroy();
            readBuffer.destroy();
            uniformBuffer.destroy();
            return null;
        }
    }
}
