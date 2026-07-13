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
export interface WorkerTask {
    id: string;
    type: 'tts' | 'process' | 'pitch';
    data: unknown;
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timestamp: number;
}

/** Worker status */
export interface WorkerStatus {
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
export interface TTSWorkerMessage {
    type: 'init' | 'generate' | 'result' | 'error' | 'ready';
    id?: string;
    data?: unknown;
    error?: string;
}

/** WASM Module interface */
export interface WASMModule {
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
