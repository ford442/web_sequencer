
export class WebGpuOscillator {
    device: GPUDevice | null = null;
    pipeline: GPUComputePipeline | null = null;
    bindGroupLayout: GPUBindGroupLayout | null = null;
    isSupported: boolean = false;

    // Shader Code: Generates raw audio samples
    private readonly SHADER_CODE = `
        struct Uniforms {
            sampleRate: f32,
            frequency: f32,
            duration: f32,
            waveType: u32, // 0: Saw, 1: Square, 2: Triangle, 3: Sine
        };

        @group(0) @binding(0) var<uniform> params: Uniforms;
        @group(0) @binding(1) var<storage, read_write> audioBuffer: array<f32>;

        const PI: f32 = 3.14159265359;

        fn oscSine(phase: f32) -> f32 {
            return sin(2.0 * PI * phase);
        }

        fn oscSaw(phase: f32) -> f32 {
            return 2.0 * fract(phase) - 1.0;
        }

        fn oscSquare(phase: f32) -> f32 {
            return step(0.5, fract(phase)) * -2.0 + 1.0;
        }

        fn oscTriangle(phase: f32) -> f32 {
            return 2.0 * abs(2.0 * fract(phase) - 1.0) - 1.0;
        }

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
            let index = global_id.x;

            // Calculate total samples needed
            let totalSamples = u32(params.sampleRate * params.duration);

            if (index >= totalSamples) {
                return;
            }

            // Time in seconds
            let t = f32(index) / params.sampleRate;
            let phase = t * params.frequency;

            var sample: f32 = 0.0;
            switch (params.waveType) {
                case 0u: { sample = oscSaw(phase); }
                case 1u: { sample = oscSquare(phase); }
                case 2u: { sample = oscTriangle(phase); }
                case 3u: { sample = oscSine(phase); }
                default: { sample = 0.0; }
            }

            audioBuffer[index] = sample;
        }
    `;

    async init() {
        if (!navigator.gpu) {
            console.warn("WebGPU not supported in this browser.");
            return;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) throw new Error("No GPU adapter found.");

            this.device = await adapter.requestDevice();

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
            console.log("WebGPU Oscillator Engine Initialized");
        } catch (e) {
            console.error("Failed to init WebGPU Audio:", e);
        }
    }

    async generate(frequency: number, duration: number, sampleRate: number, type: 'saw' | 'sqr' | 'tri' | 'sin'): Promise<Float32Array | null> {
        if (!this.device || !this.pipeline || !this.bindGroupLayout) return null;

        const numSamples = Math.ceil(sampleRate * duration);
        // Align to 4 bytes
        const bufferSize = Math.ceil((numSamples * 4) / 4) * 4;

        // 1. Create Buffers
        const outputBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const readBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        // 2. Prepare Uniforms
        const uniformData = new ArrayBuffer(16); // 4 floats/u32 * 4 bytes
        const view = new DataView(uniformData);
        view.setFloat32(0, sampleRate, true);
        view.setFloat32(4, frequency, true);
        view.setFloat32(8, duration, true);

        let typeIdx = 0;
        if (type === 'sqr') typeIdx = 1;
        if (type === 'tri') typeIdx = 2;
        if (type === 'sin') typeIdx = 3;
        view.setUint32(12, typeIdx, true);

        const uniformBuffer = this.device.createBuffer({
            size: 16,
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

        // 4. Dispatch
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(numSamples / 64));
        passEncoder.end();

        commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, bufferSize);
        this.device.queue.submit([commandEncoder.finish()]);

        // 5. Readback
        await readBuffer.mapAsync(GPUMapMode.READ);
        const copyArray = new Float32Array(readBuffer.getMappedRange());
        const result = new Float32Array(copyArray); // Copy to own memory
        readBuffer.unmap();

        // Clean up GPU resources usually handled by GC, but explicit destroy helps VRAM
        outputBuffer.destroy();
        readBuffer.destroy();
        uniformBuffer.destroy();

        return result;
    }
}
