/// <reference types="@webgpu/types" />

export class WebGpuBackend {
    device: GPUDevice | null = null;
    adapter: GPUAdapter | null = null;
    pipelines: Record<string, GPUComputePipeline> = {};
    ready: boolean = false;

    // Persistent 16-byte uniform buffer reused across all runOp() calls
    private uniformBuffer: GPUBuffer | null = null;

    async init(): Promise<boolean> {
        if (!navigator.gpu) {
            console.warn("WebGPU not supported on this browser.");
            return false;
        }

        try {
            this.adapter = await navigator.gpu.requestAdapter();
            if (!this.adapter) {
                console.warn("No appropriate GPUAdapter found.");
                return false;
            }
            this.device = await this.adapter.requestDevice();
            this.initShaders();
            // Allocate persistent uniform buffer (16 bytes: rows, cols, factor, seed)
            this.uniformBuffer = this.device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            this.ready = true;
            console.log("WebGPU Backend Initialized 🚀");
            return true;
        } catch (e) {
            console.error("WebGPU Init Failed:", e);
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
}
