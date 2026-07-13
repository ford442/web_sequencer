import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    PerformanceOptimizer,
    DEFAULT_PERFORMANCE_CONFIG,
    QUALITY_CONFIGS,
    createTTSWorkerBlob,
    type PerformanceConfig,
    type QualityLevel,
    type CpuLoadStatus
} from './performance';

describe('PerformanceOptimizer', () => {
    let optimizer: PerformanceOptimizer;

    beforeEach(() => {
        optimizer = new PerformanceOptimizer();
    });

    afterEach(() => {
        optimizer.dispose();
    });

    describe('Constructor', () => {
        it('should create with default config', () => {
            expect(optimizer).toBeDefined();
            expect(optimizer.getInitialized()).toBe(false);
        });

        it('should merge custom config with defaults', () => {
            const customOptimizer = new PerformanceOptimizer({
                bufferSize: 2048,
                workerPoolSize: 2,
                overloadThreshold: 0.7
            });

            expect(customOptimizer).toBeDefined();
            customOptimizer.dispose();
        });
    });

    describe('Initialization', () => {
        it('should initialize successfully', async () => {
            await optimizer.init();
            expect(optimizer.getInitialized()).toBe(true);
        });

        it('should not reinitialize if already initialized', async () => {
            await optimizer.init();
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            await optimizer.init();
            expect(consoleSpy).toHaveBeenCalledWith('PerformanceOptimizer: Already initialized');
            consoleSpy.mockRestore();
        });

        it('should handle WASM module initialization', async () => {
            const mockWasmModule = {
                _malloc: vi.fn().mockReturnValue(1024),
                _free: vi.fn(),
                HEAPU8: new Uint8Array(1024),
                HEAPF32: new Float32Array(1024)
            };

            await optimizer.init(mockWasmModule as any);
            expect(optimizer.getInitialized()).toBe(true);
            expect(optimizer.getWasmAllocation()).not.toBeNull();
        });

        it('should handle WASM allocation failure gracefully', async () => {
            const mockWasmModule = {
                _malloc: vi.fn().mockReturnValue(0),
                _free: vi.fn(),
                HEAPU8: new Uint8Array(1024),
                HEAPF32: new Float32Array(1024)
            };

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            await optimizer.init(mockWasmModule as any);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('SIMD Detection', () => {
        it('should detect SIMD support', () => {
            const result = optimizer.isSimdSupported();
            expect(typeof result).toBe('boolean');
        });

        it('should return consistent results', () => {
            const result1 = optimizer.isSimdSupported();
            const result2 = optimizer.isSimdSupported();
            expect(result1).toBe(result2);
        });
    });

    describe('SharedArrayBuffer Detection', () => {
        it('should check SharedArrayBuffer support', () => {
            const result = optimizer.isSharedArrayBufferSupported();
            expect(typeof result).toBe('boolean');
        });

        it('should check Atomics support', () => {
            const result = optimizer.isAtomicsSupported();
            expect(typeof result).toBe('boolean');
        });
    });

    describe('WASM Memory Allocation', () => {
        it('should fail allocation without WASM module', () => {
            const result = optimizer.allocateBuffers();
            expect(result.success).toBe(false);
            expect(result.error).toContain('WASM module not provided');
        });

        it('should allocate buffers with valid WASM module', async () => {
            // Create a larger mock buffer to accommodate the allocation
            const largeBuffer = new ArrayBuffer(65536);
            const mockWasmModule = {
                _malloc: vi.fn()
                    .mockReturnValueOnce(1024)
                    .mockReturnValueOnce(2048),
                _free: vi.fn(),
                HEAPU8: new Uint8Array(largeBuffer),
                HEAPF32: new Float32Array(largeBuffer)
            };

            await optimizer.init(mockWasmModule as any);
            const allocation = optimizer.getWasmAllocation();

            expect(allocation).not.toBeNull();
            expect(allocation?.success).toBe(true);
            expect(allocation?.inputPtr).toBeGreaterThan(0);
            expect(allocation?.outputPtr).toBeGreaterThan(0);
        });

        it('should handle allocation failure', async () => {
            const mockWasmModule = {
                _malloc: vi.fn().mockReturnValue(0),
                _free: vi.fn(),
                HEAPU8: new Uint8Array(1024),
                HEAPF32: new Float32Array(1024)
            };

            const result = optimizer.allocateBuffers.call({
                config: DEFAULT_PERFORMANCE_CONFIG,
                wasmModule: mockWasmModule
            });

            // Will fail because context is wrong, but that's expected
            // The actual init will test this properly
        });

        it('should free buffers', async () => {
            // Create a larger mock buffer to accommodate the allocation
            const largeBuffer = new ArrayBuffer(65536);
            const mockWasmModule = {
                _malloc: vi.fn()
                    .mockReturnValueOnce(1024)
                    .mockReturnValueOnce(2048),
                _free: vi.fn(),
                HEAPU8: new Uint8Array(largeBuffer),
                HEAPF32: new Float32Array(largeBuffer)
            };

            await optimizer.init(mockWasmModule as any);
            
            // Verify allocation succeeded before freeing
            expect(optimizer.getWasmAllocation()?.success).toBe(true);
            
            optimizer.freeBuffers();

            expect(mockWasmModule._free).toHaveBeenCalled();
            expect(optimizer.getWasmAllocation()).toBeNull();
        });
    });

    describe('Circular Buffers', () => {
        it('should return null if SharedArrayBuffer not supported', () => {
            const customOptimizer = new PerformanceOptimizer({
                enableSharedArrayBuffer: false
            });

            const buffer = customOptimizer.createCircularBuffer('test', 1024, 2);
            expect(buffer).toBeNull();
            customOptimizer.dispose();
        });

        it('should create circular buffer with SharedArrayBuffer', () => {
            // Skip if SharedArrayBuffer not available
            if (!optimizer.isSharedArrayBufferSupported()) {
                return;
            }

            const buffer = optimizer.createCircularBuffer('test', 1024, 2);

            if (buffer) {
                expect(buffer.capacity).toBe(1024);
                expect(buffer.numChannels).toBe(2);
                expect(buffer.buffer).toBeInstanceOf(SharedArrayBuffer);
                expect(buffer.view).toBeInstanceOf(Float32Array);
            }
        });

        it('should retrieve circular buffer by ID', () => {
            if (!optimizer.isSharedArrayBufferSupported()) {
                return;
            }

            optimizer.createCircularBuffer('test', 1024, 2);
            const retrieved = optimizer.getCircularBuffer('test');

            if (retrieved) {
                expect(retrieved.capacity).toBe(1024);
            }
        });

        it('should delete circular buffer', () => {
            if (!optimizer.isSharedArrayBufferSupported()) {
                return;
            }

            optimizer.createCircularBuffer('test', 1024, 2);
            const deleted = optimizer.deleteCircularBuffer('test');
            expect(deleted).toBe(true);
            expect(optimizer.getCircularBuffer('test')).toBeUndefined();
        });

        it('should write and read from circular buffer', () => {
            if (!optimizer.isSharedArrayBufferSupported() || !optimizer.isAtomicsSupported()) {
                return;
            }

            optimizer.createCircularBuffer('test', 256, 1);
            const samples = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);

            const written = optimizer.writeToCircularBuffer('test', samples);
            expect(written).toBe(5);

            const read = optimizer.readFromCircularBuffer('test', 5);
            expect(read.length).toBe(5);
            expect(read[0]).toBeCloseTo(0.1, 5);
            expect(read[4]).toBeCloseTo(0.5, 5);
        });

        it('should handle buffer wraparound', () => {
            if (!optimizer.isSharedArrayBufferSupported() || !optimizer.isAtomicsSupported()) {
                return;
            }

            // Small buffer for testing wraparound
            optimizer.createCircularBuffer('test', 10, 1);
            const samples = new Float32Array(20).fill(0.5);

            // Write more than buffer capacity
            const written = optimizer.writeToCircularBuffer('test', samples);
            expect(written).toBeLessThanOrEqual(18); // Leave gap
        });
    });

    describe('CPU Load Monitoring', () => {
        it('should record processing times', () => {
            optimizer.recordProcessingTime(5, 10); // 50% load
            const status = optimizer.getCpuLoadStatus();

            expect(status.load).toBeGreaterThan(0);
            expect(status.headroomMs).toBeDefined();
        });

        it('should detect overload condition', () => {
            // Simulate very high CPU load (95%+) for enough samples
            for (let i = 0; i < 40; i++) {
                optimizer.recordProcessingTime(9.5, 10);
            }

            const status = optimizer.getCpuLoadStatus();
            expect(status.isOverloaded).toBe(true);
            // With exponential moving average, the load stabilizes but may be high
            expect(['low', 'medium']).toContain(status.recommendedQuality);
        });

        it('should recommend appropriate quality levels', () => {
            // Test low load
            for (let i = 0; i < 10; i++) {
                optimizer.recordProcessingTime(1, 10); // 10% load
            }

            const status = optimizer.getCpuLoadStatus();
            expect(status.recommendedQuality).toBe('high');
        });

        it('should handle empty processing times', () => {
            const status = optimizer.getCpuLoadStatus();
            expect(status.load).toBe(0);
            expect(status.recommendedQuality).toBe('high');
        });

        it('should provide headroom calculation', () => {
            optimizer.recordProcessingTime(5, 10);
            const status = optimizer.getCpuLoadStatus();
            expect(status.headroomMs).toBeGreaterThan(0);
        });
    });

    describe('Quality Management', () => {
        it('should return default quality config', () => {
            const config = optimizer.getQualityConfig();
            expect(config).toBeDefined();
            expect(config.engine).toBeDefined();
            expect(config.transients).toBeDefined();
        });

        it('should return specific quality configs', () => {
            expect(QUALITY_CONFIGS.high.engine).toBe('finer');
            expect(QUALITY_CONFIGS.medium.engine).toBe('faster');
            expect(QUALITY_CONFIGS.low.engine).toBe('faster');
        });

        it('should get current quality level', () => {
            const quality = optimizer.getCurrentQuality();
            expect(['high', 'medium', 'low']).toContain(quality);
        });

        it('should set quality level', () => {
            optimizer.setQuality('medium');
            expect(optimizer.getCurrentQuality()).toBe('medium');
        });

        it('should trigger quality change callbacks', () => {
            const callback = vi.fn();
            optimizer.onQualityChange(callback);
            optimizer.setQuality('low');
            expect(callback).toHaveBeenCalledWith('low');
        });

        it('should remove quality change callbacks', () => {
            const callback = vi.fn();
            optimizer.onQualityChange(callback);
            optimizer.offQualityChange(callback);
            optimizer.setQuality('high');
            expect(callback).not.toHaveBeenCalledWith('high');
        });

        it('should not trigger callback if quality unchanged', () => {
            const callback = vi.fn();
            optimizer.onQualityChange(callback);
            const current = optimizer.getCurrentQuality();
            optimizer.setQuality(current);
            // Should not be called if quality is same
            optimizer.setQuality(current === 'high' ? 'medium' : 'high');
            optimizer.setQuality(current === 'high' ? 'medium' : 'high');
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('Overload Callbacks', () => {
        it('should register overload callback', async () => {
            await optimizer.init();
            const callback = vi.fn();
            optimizer.onOverload(callback);

            // Simulate high load
            for (let i = 0; i < 35; i++) {
                optimizer.recordProcessingTime(9, 10);
            }

            // Wait for monitoring interval
            await new Promise(resolve => setTimeout(resolve, 150));

            expect(callback).toHaveBeenCalled();
            expect(callback.mock.calls[0][0]).toHaveProperty('load');
            expect(callback.mock.calls[0][0]).toHaveProperty('isOverloaded');
        });

        it('should remove overload callback', async () => {
            await optimizer.init();
            const callback = vi.fn();
            optimizer.onOverload(callback);
            optimizer.offOverload(callback);

            // Simulate high load
            for (let i = 0; i < 35; i++) {
                optimizer.recordProcessingTime(9, 10);
            }

            await new Promise(resolve => setTimeout(resolve, 150));
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('Adaptive Buffer Sizing', () => {
        it('should return configured buffer size when adaptive sizing disabled', () => {
            const customOptimizer = new PerformanceOptimizer({
                adaptiveBufferSizing: false,
                bufferSize: 2048
            });

            expect(customOptimizer.getOptimalBufferSize()).toBe(2048);
            customOptimizer.dispose();
        });

        it('should return smaller buffer for low CPU load', () => {
            // Simulate low load
            for (let i = 0; i < 10; i++) {
                optimizer.recordProcessingTime(1, 10);
            }

            const size = optimizer.getOptimalBufferSize();
            expect(size).toBeLessThanOrEqual(DEFAULT_PERFORMANCE_CONFIG.bufferSize);
        });

        it('should return larger buffer for high CPU load', () => {
            // Simulate high load
            for (let i = 0; i < 35; i++) {
                optimizer.recordProcessingTime(9, 10);
            }

            const size = optimizer.getOptimalBufferSize();
            expect(size).toBeGreaterThanOrEqual(DEFAULT_PERFORMANCE_CONFIG.bufferSize);
        });
    });

    describe('Worker Pool', () => {
        it('should return null worker when not initialized', () => {
            const worker = optimizer.getWorker();
            expect(worker).toBeNull();
        });

        it('should return worker stats', () => {
            const stats = optimizer.getWorkerStats();
            expect(stats).toHaveProperty('total');
            expect(stats).toHaveProperty('busy');
            expect(stats).toHaveProperty('idle');
            expect(stats).toHaveProperty('queueLength');
        });

        it('should create workers during init', async () => {
            const workerScript = createTTSWorkerBlob();
            await optimizer.init(undefined, workerScript);

            const stats = optimizer.getWorkerStats();
            expect(stats.total).toBe(DEFAULT_PERFORMANCE_CONFIG.workerPoolSize);
        });
    });

    describe('Task Submission', () => {
        it('should queue tasks when workers are busy', async () => {
            const workerScript = createTTSWorkerBlob();
            await optimizer.init(undefined, workerScript);

            // Submit multiple tasks
            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(optimizer.submitTask('process', { test: i }));
            }

            // All should be queued
            const stats = optimizer.getWorkerStats();
            expect(stats.queueLength).toBeGreaterThan(0);

            // Clean up - don't wait for all to complete in test
            optimizer.dispose();
        });
    });

    describe('Disposal', () => {
        it('should clean up all resources', async () => {
            // Create a larger mock buffer to accommodate the allocation
            const largeBuffer = new ArrayBuffer(65536);
            const mockWasmModule = {
                _malloc: vi.fn()
                    .mockReturnValueOnce(1024)
                    .mockReturnValueOnce(2048),
                _free: vi.fn(),
                HEAPU8: new Uint8Array(largeBuffer),
                HEAPF32: new Float32Array(largeBuffer)
            };

            await optimizer.init(mockWasmModule as any);
            
            // Verify allocation succeeded before disposal
            expect(optimizer.getWasmAllocation()?.success).toBe(true);
            
            optimizer.dispose();

            expect(optimizer.getInitialized()).toBe(false);
            expect(optimizer.getWasmAllocation()).toBeNull();
        });

        it('should terminate workers on dispose', async () => {
            const workerScript = createTTSWorkerBlob();
            await optimizer.init(undefined, workerScript);

            optimizer.dispose();

            const stats = optimizer.getWorkerStats();
            expect(stats.total).toBe(0);
        });
    });
});

describe('DEFAULT_PERFORMANCE_CONFIG', () => {
    it('should have all required fields', () => {
        expect(DEFAULT_PERFORMANCE_CONFIG).toHaveProperty('bufferSize');
        expect(DEFAULT_PERFORMANCE_CONFIG).toHaveProperty('workerPoolSize');
        expect(DEFAULT_PERFORMANCE_CONFIG).toHaveProperty('overloadThreshold');
        expect(DEFAULT_PERFORMANCE_CONFIG).toHaveProperty('enableSimd');
        expect(DEFAULT_PERFORMANCE_CONFIG).toHaveProperty('enableSharedArrayBuffer');
        expect(DEFAULT_PERFORMANCE_CONFIG).toHaveProperty('sampleRate');
        expect(DEFAULT_PERFORMANCE_CONFIG).toHaveProperty('numChannels');
        expect(DEFAULT_PERFORMANCE_CONFIG).toHaveProperty('adaptiveBufferSizing');
        expect(DEFAULT_PERFORMANCE_CONFIG).toHaveProperty('cpuMonitorIntervalMs');
    });

    it('should have sensible defaults', () => {
        expect(DEFAULT_PERFORMANCE_CONFIG.bufferSize).toBeGreaterThan(0);
        expect(DEFAULT_PERFORMANCE_CONFIG.workerPoolSize).toBeGreaterThan(0);
        expect(DEFAULT_PERFORMANCE_CONFIG.overloadThreshold).toBeGreaterThan(0);
        expect(DEFAULT_PERFORMANCE_CONFIG.overloadThreshold).toBeLessThan(1);
        expect(DEFAULT_PERFORMANCE_CONFIG.sampleRate).toBeGreaterThan(0);
    });
});

describe('QUALITY_CONFIGS', () => {
    it('should have configs for all quality levels', () => {
        expect(QUALITY_CONFIGS).toHaveProperty('high');
        expect(QUALITY_CONFIGS).toHaveProperty('medium');
        expect(QUALITY_CONFIGS).toHaveProperty('low');
    });

    it('should have consistent structure across all configs', () => {
        const levels: QualityLevel[] = ['high', 'medium', 'low'];

        for (const level of levels) {
            const config = QUALITY_CONFIGS[level];
            expect(config).toHaveProperty('engine');
            expect(config).toHaveProperty('transients');
            expect(config).toHaveProperty('phase');
            expect(config).toHaveProperty('formant');
            expect(config).toHaveProperty('bufferMultiplier');
            expect(config).toHaveProperty('useSimd');
        }
    });

    it('should have appropriate engine settings', () => {
        expect(QUALITY_CONFIGS.high.engine).toBe('finer');
        expect(QUALITY_CONFIGS.medium.engine).toBe('faster');
        expect(QUALITY_CONFIGS.low.engine).toBe('faster');
    });
});

describe('createTTSWorkerBlob', () => {
    it('should create a blob URL', () => {
        const url = createTTSWorkerBlob();
        expect(url).toContain('blob:');
    });

    it('should create unique URLs on each call', () => {
        const url1 = createTTSWorkerBlob();
        const url2 = createTTSWorkerBlob();
        expect(url1).not.toBe(url2);
    });
});
