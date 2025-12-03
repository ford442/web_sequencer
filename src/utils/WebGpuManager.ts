
export class WebGpuManager {
    private static instance: WebGpuManager;
    private device: GPUDevice | null = null;
    private adapter: GPUAdapter | null = null;
    private initPromise: Promise<GPUDevice | null> | null = null;

    private constructor() {}

    public static getInstance(): WebGpuManager {
        if (!WebGpuManager.instance) {
            WebGpuManager.instance = new WebGpuManager();
        }
        return WebGpuManager.instance;
    }

    // For testing purposes only
    public static resetInstance(): void {
        // @ts-ignore
        WebGpuManager.instance = undefined;
    }

    public async getDevice(): Promise<GPUDevice | null> {
        // Return existing device if active
        if (this.device) return this.device;

        // Return existing promise if initialization is in progress
        if (this.initPromise) return this.initPromise;

        // Start initialization
        this.initPromise = this.initialize();
        return this.initPromise;
    }

    private async initialize(): Promise<GPUDevice | null> {
        if (!navigator.gpu) {
            console.warn("WebGPU not supported.");
            return null;
        }

        try {
            this.adapter = await navigator.gpu.requestAdapter();
            if (!this.adapter) {
                console.error("No WebGPU adapter found.");
                return null;
            }

            this.device = await this.adapter.requestDevice();

            this.device.lost.then((info) => {
                console.error(`WebGPU Device lost: ${info.message}`);
                this.device = null;
                this.initPromise = null; // Allow re-init
            });

            return this.device;
        } catch (e) {
            console.error("Failed to request WebGPU device:", e);
            this.initPromise = null;
            return null;
        }
    }
}
