/// <reference types="@webgpu/types" />
import { engineTelemetry, logEngineFallback } from '../utils/engineTelemetry';
import { probeWebGPU } from '../engines/backends/webgpuProbe';

export class WebGpuBackend {
    device: GPUDevice | null = null;
    adapter: GPUAdapter | null = null;
    pipelines: Record<string, GPUComputePipeline> = {};
    ready: boolean = false;

    // Persistent 16-byte uniform buffer reused across all runOp() calls
    private uniformBuffer: GPUBuffer | null = null;

    // ── Pooled, size-bucketed buffer allocator (mirrors WebGpuOscillator.ts) ──
    // Ping-pong STORAGE buffers (STORAGE | COPY_SRC | COPY_DST) keyed by bucket.
    private storagePool: Map<number, GPUBuffer[]> = new Map();
    // Readback buffers (MAP_READ | COPY_DST) keyed by bucket.
    private readPool: Map<number, GPUBuffer[]> = new Map();
    private readonly MAX_POOL_SIZE_PER_BUCKET = 4;
    private readonly SIZE_BUCKET_BYTES = 4096; // Quantize to 4KB buckets
    private readonly MAX_BUFFER_SIZE = 64 * 1024 * 1024; // 64MB guard against OOM

    async init(): Promise<boolean> {
        const probe = await probeWebGPU();
        if (!probe.ok || !probe.device || !probe.adapterHandle) {
            console.warn("WebGPU not supported on this browser.");
            logEngineFallback(
                'webgpu-compute',
                'webgpu',
                probe.reason ?? 'navigator.gpu unavailable (browser lacks WebGPU)',
            );
            return false;
        }

        try {
            this.adapter = probe.adapterHandle;
            this.device = probe.device;
            this.initShaders();
            // Allocate persistent uniform buffer (16 bytes: rows, cols, factor, seed)
            this.uniformBuffer = this.device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            this.ready = true;
            console.log("WebGPU Backend Initialized 🚀");
            try { engineTelemetry.registerResolution('webgpu-compute', 'webgpu', 'device-ready'); } catch (_) {}
            return true;
        } catch (e) {
            console.error("WebGPU Init Failed:", e);
            logEngineFallback('webgpu-compute', 'webgpu', 'GPUDevice or compute pipeline creation failed', e);
            return false;
        }
    }

    initShaders() {
        if (!this.device) return;

        const shaderCode = `
        struct Params {
            rows: f32,
            cols: f32,
            factor: f32,
            seed: f32,
        };

        @group(0) @binding(0) var<storage, read> inputBuf : array<f32>;
        @group(0) @binding(1) var<storage, read_write> outputBuf : array<f32>;
        @group(0) @binding(2) var<uniform> params : Params;

        // Simple hash for randomness
        fn hash(u: u32) -> f32 {
            var x = u + u32(params.seed);
            x = ((x >> 16u) ^ x) * 0x45d9f3bu;
            x = ((x >> 16u) ^ x) * 0x45d9f3bu;
            x = (x >> 16u) ^ x;
            return f32(x) / 4294967295.0;
        }

        @compute @workgroup_size(64)
        fn sharpen(@builtin(global_invocation_id) global_id : vec3<u32>) {
            let idx = global_id.x;
            let total = u32(params.rows * params.cols);
            if (idx >= total) { return; }

            let cols = u32(params.cols);
            let r = idx / cols;
            let c = idx % cols;

            // Gradient across features (columns)
            let c_prev = select(c - 1u, 0u, c == 0u);
            let c_next = select(c + 1u, cols - 1u, c == cols - 1u);

            let val_prev = inputBuf[r * cols + c_prev];
            let val_next = inputBuf[r * cols + c_next];
            
            let grad = (val_next - val_prev) / 2.0;
            
            outputBuf[idx] = inputBuf[idx] + (grad * params.factor);
        }

        @compute @workgroup_size(64)
        fn quantize(@builtin(global_invocation_id) global_id : vec3<u32>) {
            let idx = global_id.x;
            if (idx >= u32(params.rows * params.cols)) { return; }
            
            let val = inputBuf[idx];
            let f = params.factor;
            outputBuf[idx] = round(val * f) / f;
        }

        @compute @workgroup_size(64)
        fn echo(@builtin(global_invocation_id) global_id : vec3<u32>) {
            let idx = global_id.x;
            if (idx >= u32(params.rows * params.cols)) { return; }

            let cols = u32(params.cols);
            let r = idx / cols;
            let c = idx % cols;

            // Roll right by 2
            let shift = 2u;
            var srcC = c;
            if (c >= shift) { srcC = c - shift; } 
            else { srcC = c + cols - shift; }

            let echoVal = inputBuf[r * cols + srcC] * 0.5;
            outputBuf[idx] = inputBuf[idx] + echoVal;
        }

        @compute @workgroup_size(64)
        fn tremolo(@builtin(global_invocation_id) global_id : vec3<u32>) {
            let idx = global_id.x;
            if (idx >= u32(params.rows * params.cols)) { return; }

            let cols = u32(params.cols);
            let c = idx % cols;
            let pi = 3.14159265;

            let t = (f32(c) / f32(cols - 1u)) * 2.0 * pi;
            let envelope = 1.0 + 0.5 * sin(t);

            outputBuf[idx] = inputBuf[idx] * envelope;
        }

        @compute @workgroup_size(64)
        fn jitter(@builtin(global_invocation_id) global_id : vec3<u32>) {
            let idx = global_id.x;
            if (idx >= u32(params.rows * params.cols)) { return; }

            let rnd = hash(idx); 
            let factor = 0.8 + (rnd * 0.4);

            outputBuf[idx] = inputBuf[idx] * factor;
        }

        @compute @workgroup_size(64)
        fn multiply(@builtin(global_invocation_id) global_id : vec3<u32>) {
            let idx = global_id.x;
            if (idx >= u32(params.rows * params.cols)) { return; }
            outputBuf[idx] = inputBuf[idx] * params.factor;
        }

        @compute @workgroup_size(64)
        fn add(@builtin(global_invocation_id) global_id : vec3<u32>) {
            let idx = global_id.x;
            if (idx >= u32(params.rows * params.cols)) { return; }
            outputBuf[idx] = inputBuf[idx] + params.factor;
        }
        `;

        const module = this.device.createShaderModule({ code: shaderCode });

        const ops = ['sharpen', 'quantize', 'echo', 'tremolo', 'jitter', 'multiply', 'add'];

        ops.forEach(op => {
            this.pipelines[op] = this.device!.createComputePipeline({
                layout: 'auto',
                compute: { module: module, entryPoint: op }
            });
        });
    }

    async runOp(opName: string, data: Float32Array, dims: number[], params: { factor?: number } = {}): Promise<Float32Array | null> {
        if (!this.ready || !this.device || !this.uniformBuffer) return null;

        const rows = dims[1];
        const cols = dims[2];
        const size = rows * cols;
        const bufferSize = size * 4;

        // 1. Buffers
        const inputBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Float32Array(inputBuffer.getMappedRange()).set(data);
        inputBuffer.unmap();

        const outputBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        // 2. Uniforms — reuse persistent buffer, just write new values
        const factor = params.factor !== undefined ? params.factor : 1.0;
        const seed = Math.random() * 10000;
        const uniformData = new Float32Array([rows, cols, factor, seed]);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        const uniformBuffer = this.uniformBuffer;

        // 3. Bind Group
        const pipeline = this.pipelines[opName];
        const bindGroup = this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: inputBuffer } },
                { binding: 1, resource: { buffer: outputBuffer } },
                { binding: 2, resource: { buffer: uniformBuffer } }
            ]
        });

        // 4. Dispatch
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(size / 64));
        passEncoder.end();

        // 5. Readback
        const readbackBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        commandEncoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, bufferSize);
        this.device.queue.submit([commandEncoder.finish()]);

        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(readbackBuffer.getMappedRange());
        const finalData = new Float32Array(result);
        readbackBuffer.unmap();

        // Cleanup — uniformBuffer is persistent and must NOT be destroyed here
        inputBuffer.destroy();
        outputBuffer.destroy();
        readbackBuffer.destroy();

        return finalData;
    }

    // ── Pooled buffer allocator ───────────────────────────────────────────────
    // Quantize a byte size up to the nearest bucket so differently-sized chains
    // can still share buffers.
    private getSizeBucket(size: number): number {
        return Math.ceil(size / this.SIZE_BUCKET_BYTES) * this.SIZE_BUCKET_BYTES;
    }

    private acquire(
        pool: Map<number, GPUBuffer[]>,
        bucket: number,
        usage: GPUBufferUsageFlags,
    ): GPUBuffer | null {
        if (!this.device) return null;
        const free = pool.get(bucket);
        if (free && free.length > 0) return free.pop()!;
        try {
            return this.device.createBuffer({ size: bucket, usage });
        } catch (e) {
            logEngineFallback('webgpu-compute', 'webgpu', 'GPUBuffer allocation failed', e);
            return null;
        }
    }

    private release(pool: Map<number, GPUBuffer[]>, bucket: number, buffer: GPUBuffer) {
        let free = pool.get(bucket);
        if (!free) {
            free = [];
            pool.set(bucket, free);
        }
        if (free.length < this.MAX_POOL_SIZE_PER_BUCKET) {
            free.push(buffer);
        } else {
            buffer.destroy();
        }
    }

    /**
     * GPU-resident op chaining. Runs `ops` in sequence, ping-ponging between two
     * persistent STORAGE buffers so intermediate results never leave the GPU —
     * only the final result is read back (one mapAsync, one submit).
     *
     * Returns null when WebGPU is unavailable so callers fall back to CPU,
     * matching runOp()'s contract. Offline/precompute only — never await this
     * on the audio worklet thread.
     */
    async runChain(
        ops: string[],
        data: Float32Array,
        dims: number[],
        params: { factor?: number }[] = [],
    ): Promise<Float32Array | null> {
        if (!this.ready || !this.device) return null;
        if (ops.length === 0) return new Float32Array(data); // nothing to do

        const rows = dims[1];
        const cols = dims[2];
        const size = rows * cols;
        const bufferSize = size * 4;

        if (bufferSize > this.MAX_BUFFER_SIZE) {
            logEngineFallback(
                'webgpu-compute',
                'webgpu',
                `chain buffer ${bufferSize}B exceeds max ${this.MAX_BUFFER_SIZE}B`,
            );
            return null;
        }

        const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const bucket = this.getSizeBucket(bufferSize);
        const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

        // Two persistent ping-pong buffers + one readback buffer from the pool.
        const bufA = this.acquire(this.storagePool, bucket, storageUsage);
        const bufB = this.acquire(this.storagePool, bucket, storageUsage);
        const readback = this.acquire(this.readPool, bucket, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        if (!bufA || !bufB || !readback) {
            if (bufA) this.release(this.storagePool, bucket, bufA);
            if (bufB) this.release(this.storagePool, bucket, bufB);
            if (readback) this.release(this.readPool, bucket, readback);
            return null;
        }

        // Seed the chain: upload input into bufA.
        this.device.queue.writeBuffer(bufA, 0, data.buffer, data.byteOffset, data.byteLength);

        // One uniform buffer per op — all passes coexist in a single submit, so
        // they cannot share one mutable uniform buffer.
        const uniformBuffers: GPUBuffer[] = [];
        const commandEncoder = this.device.createCommandEncoder();

        let src = bufA;
        let dst = bufB;
        try {
            for (let i = 0; i < ops.length; i++) {
                const pipeline = this.pipelines[ops[i]];
                if (!pipeline) {
                    throw new Error(`unknown op "${ops[i]}"`);
                }

                const factor = params[i]?.factor !== undefined ? params[i]!.factor! : 1.0;
                const seed = Math.random() * 10000;
                const uniformBuffer = this.device.createBuffer({
                    size: 16,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });
                this.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([rows, cols, factor, seed]));
                uniformBuffers.push(uniformBuffer);

                const bindGroup = this.device.createBindGroup({
                    layout: pipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: src } },
                        { binding: 1, resource: { buffer: dst } },
                        { binding: 2, resource: { buffer: uniformBuffer } },
                    ],
                });

                const pass = commandEncoder.beginComputePass();
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(Math.ceil(size / 64));
                pass.end();

                // Ping-pong: this op's output becomes the next op's input.
                const tmp = src;
                src = dst;
                dst = tmp;
            }

            // After the loop the freshest result lives in `src`.
            commandEncoder.copyBufferToBuffer(src, 0, readback, 0, bufferSize);
            this.device.queue.submit([commandEncoder.finish()]);

            await readback.mapAsync(GPUMapMode.READ);
            const mapped = new Float32Array(readback.getMappedRange(), 0, size);
            const finalData = new Float32Array(mapped); // copy out before unmap
            readback.unmap();

            try { engineTelemetry.recordLatency('webgpu-compute', (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0); } catch (_) {}

            // Return all pooled buffers for reuse.
            this.release(this.storagePool, bucket, bufA);
            this.release(this.storagePool, bucket, bufB);
            this.release(this.readPool, bucket, readback);
            uniformBuffers.forEach(b => b.destroy());

            return finalData;
        } catch (e) {
            logEngineFallback('webgpu-compute', 'webgpu', 'runChain dispatch/readback failed', e);
            // Don't return buffers to the pool on error — destroy them.
            bufA.destroy();
            bufB.destroy();
            readback.destroy();
            uniformBuffers.forEach(b => b.destroy());
            return null;
        }
    }

    // Release all pooled buffers (call on teardown).
    destroy() {
        for (const free of this.storagePool.values()) free.forEach(b => b.destroy());
        for (const free of this.readPool.values()) free.forEach(b => b.destroy());
        this.storagePool.clear();
        this.readPool.clear();
    }
}
