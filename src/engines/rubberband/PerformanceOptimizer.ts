/**
 * PerformanceOptimizer - Real-time performance optimizations for Rubber Band
 *
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 7: Real-Time Performance Optimizations
 *
 * Provides:
 * - Pre-allocated circular buffers in WASM memory
 * - SIMD instruction support detection
 * - Adaptive quality based on CPU load
 * - Worker pool for parallel TTS generation
 *
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 7
 */

/** CPU load monitoring result */
export interface CpuLoadStatus {
    /** Current CPU load estimate (0.0 - 1.0) */
    load: number;
    /** Whether system is overloaded */
    isOverloaded: boolean;
    /** Recommended quality setting */
    recommendedQuality: 'high' | 'medium' | 'low';
    /** Estimated processing headroom in ms */
    headroomMs: number;
}

/** Configuration for performance optimizer */
export interface PerformanceConfig {
    /** Buffer size for WASM processing (default: 4096) */
    bufferSize: number;
    /** Number of worker threads for TTS (default: 4) */
    workerPoolSize: number;
    /** CPU load threshold for quality reduction (default: 0.8) */
    overloadThreshold: number;
    /** Enable SIMD optimizations if available (default: true) */
    enableSimd: boolean;
    /** Enable SharedArrayBuffer for lock-free communication (default: true) */
    enableSharedArrayBuffer: boolean;
    /** Sample rate for audio processing (default: 44100) */
    sampleRate: number;
    /** Number of channels (default: 2 for stereo) */
    numChannels: number;
    /** Enable adaptive buffer sizing based on load (default: true) */
    adaptiveBufferSizing: boolean;
    /** Polling interval for CPU monitoring in ms (default: 100) */
    cpuMonitorIntervalMs: number;
}

/** Default performance configuration */
export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
    bufferSize: 4096,
    workerPoolSize: 4,
    overloadThreshold: 0.8,
    enableSimd: true,
    enableSharedArrayBuffer: true,
    sampleRate: 44100,
    numChannels: 2,
    adaptiveBufferSizing: true,
    cpuMonitorIntervalMs: 100
};

/** WASM memory allocation info */
export interface WasmMemoryAllocation {
    /** Pointer to input buffer in WASM memory */
    inputPtr: number;
    /** Pointer to output buffer in WASM memory */
    outputPtr: number;
    /** Buffer size in samples */
    bufferSize: number;
    /** Number of channels */
    numChannels: number;
    /** Whether allocation was successful */
    success: boolean;
    /** Error message if allocation failed */
    error?: string;
}

/** Circular buffer for lock-free audio processing */
export interface CircularBuffer {
    /** SharedArrayBuffer for lock-free access */
    buffer: SharedArrayBuffer;
    /** Typed array view for convenient access */
    view: Float32Array;
    /** Current write position (Atomic) */
    writeIndex: Int32Array;
    /** Current read position (Atomic) */
    readIndex: Int32Array;
    /** Buffer capacity in samples */
    capacity: number;
    /** Number of channels */
    numChannels: number;
}

/** Worker pool task */
interface WorkerTask {
    id: string;
    type: 'tts' | 'process' | 'pitch';
    data: unknown;
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timestamp: number;
}

/** Worker status */
interface WorkerStatus {
    worker: Worker;
    busy: boolean;
    taskId: string | null;
    lastActivity: number;
}

/** Quality levels for adaptive processing */
export type QualityLevel = 'high' | 'medium' | 'low';

/** Quality configuration mapping */
export interface QualityConfig {
    /** Engine type: 'finer' for quality, 'faster' for speed */
    engine: 'finer' | 'faster';
    /** Transient handling: 'crisp', 'mixed', or 'smooth' */
    transients: 'crisp' | 'mixed' | 'smooth';
    /** Phase mode: 'laminar' or 'independent' */
    phase: 'laminar' | 'independent';
    /** Formant handling: 'preserved' or 'shifted' */
    formant: 'preserved' | 'shifted';
    /** Buffer size multiplier */
    bufferMultiplier: number;
    /** Enable SIMD processing */
    useSimd: boolean;
}

/** Quality level configurations */
export const QUALITY_CONFIGS: Record<QualityLevel, QualityConfig> = {
    high: {
        engine: 'finer',
        transients: 'crisp',
        phase: 'laminar',
        formant: 'preserved',
        bufferMultiplier: 1,
        useSimd: true
    },
    medium: {
        engine: 'faster',
        transients: 'mixed',
        phase: 'laminar',
        formant: 'preserved',
        bufferMultiplier: 1,
        useSimd: true
    },
    low: {
        engine: 'faster',
        transients: 'smooth',
        phase: 'independent',
        formant: 'shifted',
        bufferMultiplier: 2,
        useSimd: false
    }
};

/** TTS Worker message types */
interface TTSWorkerMessage {
    type: 'init' | 'generate' | 'result' | 'error' | 'ready';
    id?: string;
    data?: unknown;
    error?: string;
}

/** WASM Module interface */
interface WASMModule {
    _malloc(size: number): number;
    _free(ptr: number): void;
    HEAPU8: Uint8Array;
    HEAPF32: Float32Array;
    simd?: boolean;
}

/**
 * PerformanceOptimizer class for maximizing real-time audio performance.
 *
 * Features:
 * - SIMD detection and utilization
 * - Pre-allocated WASM memory buffers
 * - Circular buffer management with SharedArrayBuffer
 * - TTS worker pool with load balancing
 * - Adaptive quality based on CPU load monitoring
 */
export class PerformanceOptimizer {
    private config: PerformanceConfig;
    private workers: WorkerStatus[] = [];
    private taskQueue: WorkerTask[] = [];
    private processingTimes: number[] = [];
    private readonly SAMPLE_WINDOW = 30;
    private wasmModule: WASMModule | null = null;
    private wasmAllocation: WasmMemoryAllocation | null = null;
    private circularBuffers: Map<string, CircularBuffer> = new Map();
    private currentQuality: QualityLevel = 'high';
    private overloadCallbacks: ((status: CpuLoadStatus) => void)[] = [];
    private qualityChangeCallbacks: ((quality: QualityLevel) => void)[] = [];
    private cpuMonitorInterval: ReturnType<typeof setInterval> | null = null;
    private taskIdCounter = 0;
    private isInitialized = false;
    private workerScriptUrl: string | null = null;

    constructor(config: Partial<PerformanceConfig> = {}) {
        this.config = { ...DEFAULT_PERFORMANCE_CONFIG, ...config };
    }

    /**
     * Initialize the performance optimizer.
     *
     * @param wasmModule The Rubber Band WASM module
     * @param workerScriptUrl Optional URL to worker script for TTS pooling
     */
    async init(wasmModule?: WASMModule, workerScriptUrl?: string): Promise<void> {
        if (this.isInitialized) {
            console.warn('PerformanceOptimizer: Already initialized');
            return;
        }

        this.wasmModule = wasmModule || null;
        this.workerScriptUrl = workerScriptUrl || null;

        // Check SIMD support
        const simdSupported = this.isSimdSupported();
        if (this.config.enableSimd && simdSupported) {
            console.log('PerformanceOptimizer: SIMD enabled');
        } else if (this.config.enableSimd && !simdSupported) {
            console.warn('PerformanceOptimizer: SIMD requested but not supported');
            this.config.enableSimd = false;
        }

        // Check SharedArrayBuffer support (requires COOP/COEP headers)
        const sabSupported = this.isSharedArrayBufferSupported();
        if (this.config.enableSharedArrayBuffer && !sabSupported) {
            console.warn('PerformanceOptimizer: SharedArrayBuffer not available (requires COOP/COEP headers)');
            this.config.enableSharedArrayBuffer = false;
        }

        // Allocate WASM memory if module provided
        if (this.wasmModule) {
            this.wasmAllocation = this.allocateBuffers();
            if (!this.wasmAllocation.success) {
                console.error('PerformanceOptimizer: WASM buffer allocation failed:', this.wasmAllocation.error);
            }
        }

        // Create worker pool if script URL provided
        if (workerScriptUrl) {
            this.createWorkerPool(workerScriptUrl);
        }

        // Start CPU monitoring
        this.startCpuMonitoring();

        this.isInitialized = true;
        console.log('PerformanceOptimizer: Initialized successfully');
    }

    /**
     * Check if SIMD instructions are supported.
     * Uses WebAssembly validation with SIMD feature detection.
     */
    isSimdSupported(): boolean {
        // Test for SIMD support using WebAssembly.validate with a v128-type module
        // v128 type byte is 0x7b in WASM
        const simdTestModule = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, // WASM magic
            0x01, 0x00, 0x00, 0x00, // Version 1
            0x01, 0x05, 0x01,       // Type section
            0x60, 0x00, 0x01,       // Function type: () ->
            0x7b                    // v128 return type
        ]);

        try {
            return typeof WebAssembly === 'object' &&
                   typeof WebAssembly.validate === 'function' &&
                   WebAssembly.validate(simdTestModule);
        } catch {
            return false;
        }
    }

    /**
     * Check if SharedArrayBuffer is supported.
     * Requires COOP/COEP headers for cross-origin isolation.
     */
    isSharedArrayBufferSupported(): boolean {
        try {
            if (typeof SharedArrayBuffer === 'undefined') {
                return false;
            }
            // Test creating a small SharedArrayBuffer
            const test = new SharedArrayBuffer(4);
            return test.byteLength === 4;
        } catch {
            return false;
        }
    }

    /**
     * Check if Atomics API is supported for lock-free operations.
     */
    isAtomicsSupported(): boolean {
        return typeof Atomics === 'object' &&
               typeof Atomics.load === 'function' &&
               typeof Atomics.store === 'function' &&
               typeof Atomics.add === 'function';
    }

    /**
     * Pre-allocate circular buffers in WASM memory.
     * Uses the WASM module's malloc function for zero-copy processing.
     *
     * @returns Allocation info with pointers and success status
     */
    allocateBuffers(): WasmMemoryAllocation {
        if (!this.wasmModule) {
            return {
                inputPtr: 0,
                outputPtr: 0,
                bufferSize: this.config.bufferSize,
                numChannels: this.config.numChannels,
                success: false,
                error: 'WASM module not provided'
            };
        }

        try {
            const { bufferSize, numChannels } = this.config;
            const bytesPerSample = 4; // Float32
            const totalSamples = bufferSize * numChannels;
            const totalBytes = totalSamples * bytesPerSample;

            // Allocate input buffer
            const inputPtr = this.wasmModule._malloc(totalBytes);
            if (inputPtr === 0) {
                throw new Error('Failed to allocate input buffer');
            }

            // Allocate output buffer
            const outputPtr = this.wasmModule._malloc(totalBytes);
            if (outputPtr === 0) {
                // Free input buffer if output allocation fails
                this.wasmModule._free(inputPtr);
                throw new Error('Failed to allocate output buffer');
            }

            // Initialize buffers to zero
            const inputView = new Float32Array(this.wasmModule.HEAPF32.buffer, inputPtr, totalSamples);
            const outputView = new Float32Array(this.wasmModule.HEAPF32.buffer, outputPtr, totalSamples);
            inputView.fill(0);
            outputView.fill(0);

            return {
                inputPtr,
                outputPtr,
                bufferSize,
                numChannels,
                success: true
            };
        } catch (error) {
            return {
                inputPtr: 0,
                outputPtr: 0,
                bufferSize: this.config.bufferSize,
                numChannels: this.config.numChannels,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown allocation error'
            };
        }
    }

    /**
     * Free WASM allocated buffers.
     */
    freeBuffers(): void {
        if (!this.wasmModule || !this.wasmAllocation?.success) {
            return;
        }

        if (this.wasmAllocation.inputPtr) {
            this.wasmModule._free(this.wasmAllocation.inputPtr);
        }
        if (this.wasmAllocation.outputPtr) {
            this.wasmModule._free(this.wasmAllocation.outputPtr);
        }

        this.wasmAllocation = null;
    }

    /**
     * Create a circular buffer with SharedArrayBuffer for lock-free access.
     *
     * @param id Unique identifier for this buffer
     * @param capacity Capacity in samples per channel
     * @param numChannels Number of audio channels
     * @returns CircularBuffer instance or null if SharedArrayBuffer not supported
     */
    createCircularBuffer(id: string, capacity: number, numChannels: number): CircularBuffer | null {
        if (!this.config.enableSharedArrayBuffer || !this.isSharedArrayBufferSupported()) {
            return null;
        }

        // Calculate sizes
        const samplesSize = capacity * numChannels * 4; // Float32 = 4 bytes
        const indexSize = 4; // Int32 = 4 bytes

        // Create SharedArrayBuffer: [audio data][writeIndex][readIndex]
        const totalSize = samplesSize + indexSize * 2;
        const sharedBuffer = new SharedArrayBuffer(totalSize);

        // Create views
        const view = new Float32Array(sharedBuffer, 0, capacity * numChannels);
        const writeIndex = new Int32Array(sharedBuffer, samplesSize, 1);
        const readIndex = new Int32Array(sharedBuffer, samplesSize + indexSize, 1);

        // Initialize indices to 0
        Atomics.store(writeIndex, 0, 0);
        Atomics.store(readIndex, 0, 0);

        const circularBuffer: CircularBuffer = {
            buffer: sharedBuffer,
            view,
            writeIndex,
            readIndex,
            capacity,
            numChannels
        };

        this.circularBuffers.set(id, circularBuffer);
        return circularBuffer;
    }

    /**
     * Get a circular buffer by ID.
     */
    getCircularBuffer(id: string): CircularBuffer | undefined {
        return this.circularBuffers.get(id);
    }

    /**
     * Delete a circular buffer.
     */
    deleteCircularBuffer(id: string): boolean {
        return this.circularBuffers.delete(id);
    }

    /**
     * Write samples to a circular buffer (thread-safe with Atomics).
     *
     * @param id Buffer ID
     * @param samples Float32Array of interleaved samples
     * @returns Number of samples written
     */
    writeToCircularBuffer(id: string, samples: Float32Array): number {
        const buffer = this.circularBuffers.get(id);
        if (!buffer || !this.isAtomicsSupported()) {
            return 0;
        }

        const { view, writeIndex, readIndex, capacity, numChannels } = buffer;
        const maxSamples = capacity * numChannels;

        let writePos = Atomics.load(writeIndex, 0);
        const readPos = Atomics.load(readIndex, 0);

        // Calculate available space
        let available = readPos <= writePos
            ? maxSamples - (writePos - readPos)
            : readPos - writePos;

        // Leave one sample gap to distinguish full from empty
        available -= numChannels;

        const toWrite = Math.min(samples.length, available);

        for (let i = 0; i < toWrite; i++) {
            view[writePos] = samples[i];
            writePos = (writePos + 1) % maxSamples;
        }

        Atomics.store(writeIndex, 0, writePos);
        return toWrite;
    }

    /**
     * Read samples from a circular buffer (thread-safe with Atomics).
     *
     * @param id Buffer ID
     * @param count Number of samples to read
     * @returns Float32Array with read samples (may be smaller than requested)
     */
    readFromCircularBuffer(id: string, count: number): Float32Array {
        const buffer = this.circularBuffers.get(id);
        if (!buffer || !this.isAtomicsSupported()) {
            return new Float32Array(0);
        }

        const { view, writeIndex, readIndex, capacity, numChannels } = buffer;
        const maxSamples = capacity * numChannels;

        const writePos = Atomics.load(writeIndex, 0);
        let readPos = Atomics.load(readIndex, 0);

        // Calculate available data
        const available = writePos >= readPos
            ? writePos - readPos
            : maxSamples - (readPos - writePos);

        const toRead = Math.min(count, available);
        const result = new Float32Array(toRead);

        for (let i = 0; i < toRead; i++) {
            result[i] = view[readPos];
            readPos = (readPos + 1) % maxSamples;
        }

        Atomics.store(readIndex, 0, readPos);
        return result;
    }

    /**
     * Create a worker pool for parallel TTS generation.
     *
     * @param workerScript URL to worker script
     */
    createWorkerPool(workerScript: string): void {
        // Terminate existing workers
        this.terminateWorkers();

        const { workerPoolSize } = this.config;

        for (let i = 0; i < workerPoolSize; i++) {
            try {
                const worker = new Worker(workerScript, { type: 'module' });
                const status: WorkerStatus = {
                    worker,
                    busy: false,
                    taskId: null,
                    lastActivity: performance.now()
                };

                // Set up message handler
                worker.onmessage = (event: MessageEvent<TTSWorkerMessage>) => {
                    this.handleWorkerMessage(status, event.data);
                };

                worker.onerror = (error: ErrorEvent) => {
                    console.error(`Worker ${i} error:`, error);
                    this.handleWorkerError(status, error);
                };

                this.workers.push(status);
            } catch (error) {
                console.error(`Failed to create worker ${i}:`, error);
            }
        }

        console.log(`PerformanceOptimizer: Created ${this.workers.length} TTS workers`);
    }

    /**
     * Handle messages from workers.
     */
    private handleWorkerMessage(status: WorkerStatus, message: TTSWorkerMessage): void {
        status.lastActivity = performance.now();

        if (message.type === 'ready') {
            status.busy = false;
            status.taskId = null;
            this.processTaskQueue();
            return;
        }

        if (message.type === 'result' && status.taskId) {
            const task = this.findTask(status.taskId);
            if (task) {
                task.resolve(message.data);
                this.removeTask(status.taskId);
            }
            status.busy = false;
            status.taskId = null;
            this.processTaskQueue();
        }

        if (message.type === 'error' && status.taskId) {
            const task = this.findTask(status.taskId);
            if (task) {
                task.reject(new Error(message.error || 'Worker error'));
                this.removeTask(status.taskId);
            }
            status.busy = false;
            status.taskId = null;
            this.processTaskQueue();
        }
    }

    /**
     * Handle worker errors.
     */
    private handleWorkerError(status: WorkerStatus, error: ErrorEvent): void {
        if (status.taskId) {
            const task = this.findTask(status.taskId);
            if (task) {
                task.reject(new Error(error.message || 'Worker error'));
                this.removeTask(status.taskId);
            }
        }
        status.busy = false;
        status.taskId = null;
    }

    /**
     * Find a task by ID.
     */
    private findTask(id: string): WorkerTask | undefined {
        return this.taskQueue.find(t => t.id === id);
    }

    /**
     * Remove a task from the queue.
     */
    private removeTask(id: string): void {
        const index = this.taskQueue.findIndex(t => t.id === id);
        if (index !== -1) {
            this.taskQueue.splice(index, 1);
        }
    }

    /**
     * Process pending tasks in the queue.
     */
    private processTaskQueue(): void {
        const pendingTasks = this.taskQueue.filter(t =>
            !this.workers.some(w => w.taskId === t.id)
        );

        for (const task of pendingTasks) {
            const worker = this.getAvailableWorker();
            if (!worker) break;

            this.assignTaskToWorker(worker, task);
        }
    }

    /**
     * Get an available worker from the pool.
     */
    private getAvailableWorker(): WorkerStatus | null {
        // Find idle worker
        const idleWorker = this.workers.find(w => !w.busy);
        if (idleWorker) return idleWorker;

        // If all busy, return null (task will be queued)
        return null;
    }

    /**
     * Assign a task to a worker.
     */
    private assignTaskToWorker(status: WorkerStatus, task: WorkerTask): void {
        status.busy = true;
        status.taskId = task.id;
        status.lastActivity = performance.now();

        status.worker.postMessage({
            type: task.type,
            id: task.id,
            data: task.data
        } as TTSWorkerMessage);
    }

    /**
     * Get an available worker from the pool (public API).
     * Returns null if all workers are busy.
     */
    getWorker(): Worker | null {
        const status = this.getAvailableWorker();
        return status?.worker || null;
    }

    /**
     * Submit a task to the worker pool.
     *
     * @param type Task type ('tts', 'process', 'pitch')
     * @param data Task data
     * @returns Promise that resolves with the result
     */
    async submitTask(type: WorkerTask['type'], data: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const task: WorkerTask = {
                id: `task-${++this.taskIdCounter}`,
                type,
                data,
                resolve,
                reject,
                timestamp: performance.now()
            };

            this.taskQueue.push(task);
            this.processTaskQueue();
        });
    }

    /**
     * Terminate all workers in the pool.
     */
    terminateWorkers(): void {
        this.workers.forEach(status => {
            status.worker.terminate();
        });
        this.workers = [];
        this.taskQueue = [];
    }

    /**
     * Record processing time for CPU load estimation.
     *
     * @param processingTimeMs Time taken for processing in milliseconds
     * @param bufferDurationMs Duration of the audio buffer in milliseconds
     */
    recordProcessingTime(processingTimeMs: number, bufferDurationMs: number): void {
        // Calculate CPU load as ratio of processing time to buffer duration
        const load = processingTimeMs / bufferDurationMs;

        this.processingTimes.push(load);
        if (this.processingTimes.length > this.SAMPLE_WINDOW) {
            this.processingTimes.shift();
        }

        // Check for quality adjustment
        this.checkQualityAdjustment();
    }

    /**
     * Get current CPU load status.
     */
    getCpuLoadStatus(): CpuLoadStatus {
        if (this.processingTimes.length === 0) {
            return {
                load: 0,
                isOverloaded: false,
                recommendedQuality: 'high',
                headroomMs: Infinity
            };
        }

        // Calculate average load using exponential moving average for responsiveness
        let avgLoad = 0;
        const alpha = 0.3; // Smoothing factor
        for (let i = 0; i < this.processingTimes.length; i++) {
            avgLoad = alpha * this.processingTimes[i] + (1 - alpha) * avgLoad;
        }

        const isOverloaded = avgLoad > this.config.overloadThreshold;

        let recommendedQuality: QualityLevel;
        if (avgLoad > 0.9) {
            recommendedQuality = 'low';
        } else if (avgLoad > 0.6) {
            recommendedQuality = 'medium';
        } else {
            recommendedQuality = 'high';
        }

        // Calculate headroom based on current buffer duration
        const bufferDurationMs = (this.config.bufferSize / this.config.sampleRate) * 1000;
        const headroomMs = Math.max(0, bufferDurationMs * (1 - avgLoad));

        return {
            load: avgLoad,
            isOverloaded,
            recommendedQuality,
            headroomMs
        };
    }

    /**
     * Start CPU load monitoring.
     */
    private startCpuMonitoring(): void {
        if (this.cpuMonitorInterval) {
            clearInterval(this.cpuMonitorInterval);
        }

        this.cpuMonitorInterval = setInterval(() => {
            const status = this.getCpuLoadStatus();

            if (status.isOverloaded) {
                this.overloadCallbacks.forEach(cb => {
                    try {
                        cb(status);
                    } catch (e) {
                        console.error('Error in overload callback:', e);
                    }
                });
            }
        }, this.config.cpuMonitorIntervalMs);
    }

    /**
     * Stop CPU load monitoring.
     */
    stopCpuMonitoring(): void {
        if (this.cpuMonitorInterval) {
            clearInterval(this.cpuMonitorInterval);
            this.cpuMonitorInterval = null;
        }
    }

    /**
     * Check and adjust quality based on CPU load.
     */
    private checkQualityAdjustment(): void {
        const status = this.getCpuLoadStatus();

        if (status.recommendedQuality !== this.currentQuality) {
            const oldQuality = this.currentQuality;
            this.currentQuality = status.recommendedQuality;

            console.log(`PerformanceOptimizer: Quality adjusted ${oldQuality} -> ${this.currentQuality} (load: ${(status.load * 100).toFixed(1)}%)`);

            this.qualityChangeCallbacks.forEach(cb => {
                try {
                    cb(this.currentQuality);
                } catch (e) {
                    console.error('Error in quality change callback:', e);
                }
            });
        }
    }

    /**
     * Register a callback for CPU overload events.
     *
     * @param callback Function to call when CPU is overloaded
     */
    onOverload(callback: (status: CpuLoadStatus) => void): void {
        this.overloadCallbacks.push(callback);
    }

    /**
     * Remove an overload callback.
     */
    offOverload(callback: (status: CpuLoadStatus) => void): void {
        const index = this.overloadCallbacks.indexOf(callback);
        if (index !== -1) {
            this.overloadCallbacks.splice(index, 1);
        }
    }

    /**
     * Register a callback for quality level changes.
     *
     * @param callback Function to call when quality changes
     */
    onQualityChange(callback: (quality: QualityLevel) => void): void {
        this.qualityChangeCallbacks.push(callback);
    }

    /**
     * Remove a quality change callback.
     */
    offQualityChange(callback: (quality: QualityLevel) => void): void {
        const index = this.qualityChangeCallbacks.indexOf(callback);
        if (index !== -1) {
            this.qualityChangeCallbacks.splice(index, 1);
        }
    }

    /**
     * Get current quality level.
     */
    getCurrentQuality(): QualityLevel {
        return this.currentQuality;
    }

    /**
     * Get quality configuration for current or specified level.
     */
    getQualityConfig(level?: QualityLevel): QualityConfig {
        return QUALITY_CONFIGS[level || this.currentQuality];
    }

    /**
     * Manually set quality level.
     */
    setQuality(level: QualityLevel): void {
        if (this.currentQuality !== level) {
            this.currentQuality = level;
            this.qualityChangeCallbacks.forEach(cb => {
                try {
                    cb(level);
                } catch (e) {
                    console.error('Error in quality change callback:', e);
                }
            });
        }
    }

    /**
     * Get optimal buffer size based on current performance.
     */
    getOptimalBufferSize(): number {
        if (!this.config.adaptiveBufferSizing) {
            return this.config.bufferSize;
        }

        const status = this.getCpuLoadStatus();
        const baseSize = this.config.bufferSize;

        // Larger buffers for lower CPU, smaller for more responsiveness
        if (status.load < 0.3) {
            return Math.max(256, Math.floor(baseSize / 2)); // Low latency
        } else if (status.load < 0.6) {
            return baseSize; // Balanced
        } else {
            return Math.min(16384, baseSize * 2); // Safety margin
        }
    }

    /**
     * Get the WASM memory allocation info.
     */
    getWasmAllocation(): WasmMemoryAllocation | null {
        return this.wasmAllocation;
    }

    /**
     * Check if the optimizer is initialized.
     */
    getInitialized(): boolean {
        return this.isInitialized;
    }

    /**
     * Get worker pool statistics.
     */
    getWorkerStats(): { total: number; busy: number; idle: number; queueLength: number } {
        const busy = this.workers.filter(w => w.busy).length;
        return {
            total: this.workers.length,
            busy,
            idle: this.workers.length - busy,
            queueLength: this.taskQueue.length
        };
    }

    /**
     * Dispose of all resources.
     */
    dispose(): void {
        this.stopCpuMonitoring();
        this.terminateWorkers();
        this.freeBuffers();
        this.circularBuffers.clear();
        this.overloadCallbacks = [];
        this.qualityChangeCallbacks = [];
        this.isInitialized = false;
        console.log('PerformanceOptimizer: Disposed');
    }
}

/**
 * Create a TTS worker script as a Blob URL.
 * Useful for creating workers without external files.
 *
 * @returns Blob URL for the worker script
 */
export function createTTSWorkerBlob(): string {
    const workerCode = `
        // TTS Worker for parallel text-to-speech generation
        let synth = null;

        // Initialize speech synthesis if available
        if (typeof self !== 'undefined' && 'speechSynthesis' in self) {
            synth = self.speechSynthesis;
        }

        self.onmessage = function(event) {
            const { type, id, data } = event.data;

            switch (type) {
                case 'init':
                    self.postMessage({ type: 'ready', id });
                    break;

                case 'tts':
                case 'generate':
                    handleTTS(id, data);
                    break;

                case 'process':
                    handleProcess(id, data);
                    break;

                case 'pitch':
                    handlePitchShift(id, data);
                    break;

                default:
                    self.postMessage({
                        type: 'error',
                        id,
                        error: 'Unknown task type: ' + type
                    });
            }
        };

        function handleTTS(id, data) {
            try {
                const { text, pitch = 1.0, rate = 1.0 } = data || {};

                if (!synth) {
                    // Fallback: generate placeholder audio data
                    const sampleRate = 22050;
                    const duration = (text?.length || 10) * 0.1; // Rough estimate
                    const samples = Math.floor(sampleRate * duration);
                    const audio = new Float32Array(samples);

                    // Generate simple waveform as placeholder
                    for (let i = 0; i < samples; i++) {
                        const t = i / sampleRate;
                        audio[i] = Math.sin(2 * Math.PI * 440 * pitch * t) * 0.1;
                        // Add envelope
                        if (t < 0.01) audio[i] *= t / 0.01;
                        if (t > duration - 0.01) audio[i] *= (duration - t) / 0.01;
                    }

                    self.postMessage({
                        type: 'result',
                        id,
                        data: { audio, sampleRate, text }
                    }, [audio.buffer]);
                    return;
                }

                // Use Web Speech API
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.pitch = pitch;
                utterance.rate = rate;

                // Note: Actual audio buffer extraction from Web Speech API
                // requires MediaRecorder or AudioWorklet capture on main thread
                // This is a simplified implementation

                utterance.onend = () => {
                    self.postMessage({
                        type: 'result',
                        id,
                        data: { text, pitch, rate, completed: true }
                    });
                };

                utterance.onerror = (e) => {
                    self.postMessage({
                        type: 'error',
                        id,
                        error: e.error
                    });
                };

                synth.speak(utterance);
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    id,
                    error: error.message
                });
            }
        }

        function handleProcess(id, data) {
            try {
                const { buffer, operation } = data || {};

                if (!buffer || !(buffer instanceof Float32Array)) {
                    throw new Error('Invalid buffer data');
                }

                const result = new Float32Array(buffer.length);

                switch (operation) {
                    case 'normalize':
                        const max = Math.max(...buffer.map(Math.abs));
                        const scale = max > 0 ? 1 / max : 1;
                        for (let i = 0; i < buffer.length; i++) {
                            result[i] = buffer[i] * scale;
                        }
                        break;

                    case 'fadeIn':
                        const fadeInLength = Math.min(buffer.length, Math.floor(0.01 * 44100));
                        for (let i = 0; i < buffer.length; i++) {
                            const gain = i < fadeInLength ? i / fadeInLength : 1;
                            result[i] = buffer[i] * gain;
                        }
                        break;

                    case 'fadeOut':
                        const fadeOutLength = Math.min(buffer.length, Math.floor(0.01 * 44100));
                        for (let i = 0; i < buffer.length; i++) {
                            const gain = i >= buffer.length - fadeOutLength
                                ? (buffer.length - i) / fadeOutLength
                                : 1;
                            result[i] = buffer[i] * gain;
                        }
                        break;

                    default:
                        result.set(buffer);
                }

                self.postMessage({
                    type: 'result',
                    id,
                    data: { result, operation }
                }, [result.buffer]);
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    id,
                    error: error.message
                });
            }
        }

        function handlePitchShift(id, data) {
            try {
                const { buffer, ratio, sampleRate = 44100 } = data || {};

                if (!buffer || !(buffer instanceof Float32Array)) {
                    throw new Error('Invalid buffer data');
                }

                // Simple time-domain pitch shift using resampling
                // For production, use Rubber Band or similar
                const outputLength = Math.floor(buffer.length / ratio);
                const result = new Float32Array(outputLength);

                for (let i = 0; i < outputLength; i++) {
                    const sourceIndex = i * ratio;
                    const index1 = Math.floor(sourceIndex);
                    const index2 = Math.min(index1 + 1, buffer.length - 1);
                    const frac = sourceIndex - index1;

                    result[i] = buffer[index1] * (1 - frac) + buffer[index2] * frac;
                }

                self.postMessage({
                    type: 'result',
                    id,
                    data: { result, ratio, sampleRate }
                }, [result.buffer]);
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    id,
                    error: error.message
                });
            }
        }

        // Signal ready on load
        self.postMessage({ type: 'ready' });
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
}

export default PerformanceOptimizer;
