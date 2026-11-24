// @mode: typescript
// @note-for-ai: This is a native WebGPU implementation (L5 in UIMP).
import { engineTelemetry, logEngineFallback } from '../utils/engineTelemetry';
import { onWebGpuDeviceChange, probeWebGPU } from './backends/webgpuProbe';
import { OSCILLATOR_MAX_BYTES } from '../webgpu/deviceRequirements';
import type { WaveShape } from '../utils/waveformParser';
import {
    SHAPE_INDEX,
    WAVETABLE_LENGTH,
    maxHarmonicFor,
    phaseIncrementFor,
    planWavetableBands,
    type WavetableBand,
} from './backends/wavetableBands';
// The WGSL shader code is embedded in SHADER_CODE constant.
// This file handles GPU resource management and buffer pooling.
// See PERFORMANCE_MIGRATION_STRATEGY.md for migration context.

/** Table slots in the kernel's uniform block (shapes × octave bands, with room). */
const MAX_TABLES = 64;
/** Uniform block: 16-byte header + one vec4<u32> per table. */
const UNIFORM_BYTES = 16 + MAX_TABLES * 16;
/** Matches `@workgroup_size(64)` in the kernel. */
const WORKGROUP_SIZE = 64;

const ALL_SHAPES: readonly WaveShape[] = ['saw', 'sqr', 'tri', 'sin'];

/** One table of a dispatch: what to render and where it lands in the output. */
interface TableSpec {
    phaseIncrement: number;
    maxHarmonic: number;
    shape: WaveShape;
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

export class WebGpuOscillator {
    device: GPUDevice | null = null;
    pipeline: GPUComputePipeline | null = null;
    bindGroupLayout: GPUBindGroupLayout | null = null;
    isSupported: boolean = false;

    // Buffer pool for reuse - keyed by size bucket
    private bufferPool: Map<number, { output: GPUBuffer, read: GPUBuffer }[]> = new Map();
    private readonly MAX_POOL_SIZE_PER_BUCKET = 4;
    private readonly MAX_BUFFER_SIZE = OSCILLATOR_MAX_BYTES; // ~5 seconds at 44.1kHz (limit to prevent OOM)
    private readonly SIZE_BUCKET_BYTES = 4096; // Quantize to 4KB buckets
    private unsubscribeDevice: (() => void) | null = null;
    /** Set once init succeeds, so a restored device re-initialises the oscillator. */
    private wantsDevice = false;

    /**
     * Additive, band-limited kernel (#1668). One invocation writes one sample of
     * one table: `global_id.x` is the sample, `global_id.y` the table. A whole
     * table set (every shape × every octave band) is one dispatch and one
     * readback; an offline `generate` is the same kernel with one table.
     *
     * Phase is 32-bit fixed point: `index * phaseInc` and the per-harmonic
     * accumulation wrap modulo 2^32, which is exactly "mod one cycle". Nothing
     * is accumulated in f32, so there is no drift over a long render, and a
     * table whose increment is `cycles * 2^32 / length` returns to phase 0 at
     * sample `length` — the loop has no seam.
     *
     * Series (each matches the naive shape it replaces, sign and level):
     *   saw  2p-1            = -(2/π) Σ sin(2πhp)/h       all h ≤ H
     *   sqr  +1 then -1      =  (4/π) Σ sin(2πhp)/h       odd h ≤ H
     *   tri  2|2p-1|-1       = (8/π²) Σ cos(2πhp)/h²      odd h ≤ H
     *   sin                  =  sin(2πp)                  H ≥ 1
     * `H = 0` is silence: the pitch has no harmonic under Nyquist.
     */
    private readonly SHADER_CODE = `
        const MAX_TABLES: u32 = ${MAX_TABLES}u;

        struct Params {
            numSamples: u32,
            tableCount: u32,
            _pad0: u32,
            _pad1: u32,
            // x: phase increment (2^32 = one cycle), y: highest harmonic,
            // z: shape (0 saw, 1 sqr, 2 tri, 3 sin), w: output offset in samples.
            tables: array<vec4<u32>, MAX_TABLES>,
        };

        @group(0) @binding(0) var<uniform> params: Params;
        @group(0) @binding(1) var<storage, read_write> audioBuffer: array<f32>;

        const PI: f32 = 3.14159265358979;
        // 2π / 2^32: fixed-point phase → radians.
        const PHASE_TO_RAD: f32 = 1.4629180792671596e-9;

        fn rad(p: u32) -> f32 {
            return f32(p) * PHASE_TO_RAD;
        }

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
            let index = global_id.x;
            let table = global_id.y;
            if (index >= params.numSamples || table >= params.tableCount) {
                return;
            }

            let t = params.tables[table];
            let inc = t.x;
            let harmonics = t.y;
            let shape = t.z;
            // Wraps modulo 2^32 — that is the phase, in cycles, exactly.
            let p1 = index * inc;

            var sum: f32 = 0.0;
            switch (shape) {
                case 0u: {
                    var ph = p1;
                    for (var h = 1u; h <= harmonics; h = h + 1u) {
                        sum = sum + sin(rad(ph)) / f32(h);
                        ph = ph + p1;
                    }
                    sum = sum * (-2.0 / PI);
                }
                case 1u: {
                    var ph = p1;
                    let step = p1 * 2u;
                    for (var h = 1u; h <= harmonics; h = h + 2u) {
                        sum = sum + sin(rad(ph)) / f32(h);
                        ph = ph + step;
                    }
                    sum = sum * (4.0 / PI);
                }
                case 2u: {
                    var ph = p1;
                    let step = p1 * 2u;
                    for (var h = 1u; h <= harmonics; h = h + 2u) {
                        let fh = f32(h);
                        sum = sum + cos(rad(ph)) / (fh * fh);
                        ph = ph + step;
                    }
                    sum = sum * (8.0 / (PI * PI));
                }
                default: {
                    if (harmonics >= 1u) {
                        sum = sin(rad(p1));
                    }
                }
            }

            audioBuffer[t.w + index] = sum;
        }
    `;

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

        try {
            this.device = probe.device;

            const shaderModule = this.device.createShaderModule({
                code: this.SHADER_CODE
            });

            this.bindGroupLayout = this.device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
                    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
                ]
            });

            this.pipeline = this.device.createComputePipeline({
                layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
                compute: { module: shaderModule, entryPoint: "main" }
            });

            this.isSupported = true;
            this.wantsDevice = true;
            try { engineTelemetry.registerResolution('webgpu', 'webgpu', 'device-ready'); } catch (_) {}
        } catch (e) {
            logEngineFallback('webgpu', 'webgpu', 'GPUDevice or compute pipeline creation failed', e);
        }
    }

    // Quantize size to bucket for better reuse
    private getSizeBucket(size: number): number {
        return Math.ceil(size / this.SIZE_BUCKET_BYTES) * this.SIZE_BUCKET_BYTES;
    }

    // Get or create buffer pair from pool
    private getBuffers(size: number): { output: GPUBuffer, read: GPUBuffer } | null {
        if (!this.device) return null;

        const bucketSize = this.getSizeBucket(size);
        const pool = this.bufferPool.get(bucketSize);

        if (pool && pool.length > 0) {
            return pool.pop()!;
        }

        // Create new buffers
        try {
            const output = this.device.createBuffer({
                size: bucketSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });

            const read = this.device.createBuffer({
                size: bucketSize,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
            });

            return { output, read };
        } catch (e) {
            logEngineFallback('webgpu', 'webgpu', 'GPUBuffer allocation failed', e);
            return null;
        }
    }

    // Return buffers to pool for reuse
    private returnBuffers(buffers: { output: GPUBuffer, read: GPUBuffer }, size: number) {
        const bucketSize = this.getSizeBucket(size);

        if (!this.bufferPool.has(bucketSize)) {
            this.bufferPool.set(bucketSize, []);
        }

        const pool = this.bufferPool.get(bucketSize)!;

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
     */
    async generate(frequency: number, duration: number, sampleRate: number, type: WaveShape): Promise<Float32Array | null> {
        if (!this.device || !this.pipeline || !this.bindGroupLayout) return null;

        const phaseIncrement = phaseIncrementFor(frequency, sampleRate);
        if (phaseIncrement === null) return null;

        let numSamples = Math.ceil(sampleRate * duration);
        if (!(numSamples > 0)) return null;

        // Guard against very large requests
        if (numSamples * 4 > this.MAX_BUFFER_SIZE) {
            console.warn(`WebGPU: ${numSamples * 4} B exceeds max ${this.MAX_BUFFER_SIZE}, clamping duration`);
            numSamples = Math.floor(this.MAX_BUFFER_SIZE / 4);
        }

        return this.dispatch(
            [{ phaseIncrement, maxHarmonic: maxHarmonicFor(frequency, sampleRate), shape: type }],
            numSamples,
        );
    }

    /**
     * Every shape × every octave band for `sampleRate`, in ONE dispatch and ONE
     * readback (the old pre-render was four submits and four `mapAsync`s, one
     * per naive shape). Null when WebGPU is not ready or the render failed —
     * the caller fails closed to the next backend.
     */
    async renderWavetables(sampleRate: number): Promise<WavetableSet | null> {
        if (!this.device || !this.pipeline || !this.bindGroupLayout) return null;
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

        const out = await this.dispatch(specs, WAVETABLE_LENGTH);
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
     * Run the kernel once over `specs.length` tables of `numSamples` each and
     * read the result back as one contiguous array (table-major).
     */
    private async dispatch(specs: readonly TableSpec[], numSamples: number): Promise<Float32Array | null> {
        if (!this.device || !this.pipeline || !this.bindGroupLayout) return null;
        if (specs.length === 0 || specs.length > MAX_TABLES) return null;

        const totalSamples = numSamples * specs.length;
        const bufferSize = totalSamples * 4;
        const groupsX = Math.ceil(numSamples / WORKGROUP_SIZE);
        const maxGroups = this.device.limits?.maxComputeWorkgroupsPerDimension ?? 65535;
        if (bufferSize > this.MAX_BUFFER_SIZE || groupsX > maxGroups) {
            logEngineFallback('webgpu', 'webgpu', `dispatch of ${totalSamples} samples exceeds one dispatch on this device`);
            return null;
        }

        // 1. Get Buffers from pool
        const buffers = this.getBuffers(bufferSize);
        if (!buffers) return null;

        const { output: outputBuffer, read: readBuffer } = buffers;

        // 2. Uniforms: header + one vec4<u32> per table.
        const uniformData = new Uint32Array(UNIFORM_BYTES / 4);
        uniformData[0] = numSamples;
        uniformData[1] = specs.length;
        specs.forEach((spec, i) => {
            const o = 4 + i * 4;
            uniformData[o] = spec.phaseIncrement >>> 0;
            uniformData[o + 1] = Math.max(0, Math.floor(spec.maxHarmonic));
            uniformData[o + 2] = SHAPE_INDEX[spec.shape] ?? SHAPE_INDEX.saw;
            uniformData[o + 3] = i * numSamples;
        });

        const uniformBuffer = this.device.createBuffer({
            size: UNIFORM_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        // 3. Bind Group
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: { buffer: outputBuffer } }
            ]
        });

        // 4. Dispatch: x = samples, y = tables.
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(groupsX, specs.length);
        passEncoder.end();

        commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, bufferSize);
        this.device.queue.submit([commandEncoder.finish()]);

        // 5. Readback
        try {
            await readBuffer.mapAsync(GPUMapMode.READ);
            const copyArray = new Float32Array(readBuffer.getMappedRange());
            const result = new Float32Array(totalSamples);
            result.set(copyArray.subarray(0, totalSamples)); // Only copy actual samples
            readBuffer.unmap();

            // 6. Return buffers to pool
            this.returnBuffers(buffers, bufferSize);

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
