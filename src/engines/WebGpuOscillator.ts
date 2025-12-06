import { OSCILLATOR_SHADER } from '../gpu/shaders/oscillator.wgsl';

export class WebGpuOscillator {
    device: GPUDevice | null = null;
    pipeline: GPUComputePipeline | null = null;
    bindGroupLayout: GPUBindGroupLayout | null = null;
    isSupported: boolean = false;

    /**
     * Constructor that optionally accepts a pre-initialized device
     * If no device is provided, it will initialize its own (legacy behavior)
     */
    constructor(device?: GPUDevice) {
        if (device) {
            this.device = device;
            this.isSupported = true;
        }
    }

    async init() {
        // If device was provided in constructor, skip initialization
        if (this.device) {
            console.log('WebGpuOscillator: Using provided device, creating pipeline');
            return this.createPipeline();
        }
        if (!navigator.gpu) {
            console.warn("WebGPU not supported in this browser.");
            return;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) throw new Error("No GPU adapter found.");

            this.device = await adapter.requestDevice();
            this.isSupported = true;
            
            return this.createPipeline();
        } catch (e) {
            console.error("Failed to init WebGPU Audio:", e);
        }
    }

    /**
     * Creates the compute pipeline using the imported shader
     * @private
     */
    private async createPipeline() {
        if (!this.device) {
            throw new Error('Device not initialized');
        }

        const shaderModule = this.device.createShaderModule({
            code: OSCILLATOR_SHADER
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

        console.log("WebGPU Oscillator Engine Initialized");
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
