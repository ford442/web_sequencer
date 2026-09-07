import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioDSP } from '../engines/AudioDSP';

describe('AudioDSP OpenMP Module', () => {
    // Mock WASM module
    let mockMalloc: ReturnType<typeof vi.fn>;
    let mockFree: ReturnType<typeof vi.fn>;
    let mockModule: ReturnType<typeof vi.fn>;
    let heapBuffer: ArrayBuffer;
    let heapF32: Float32Array;
    let heap16: Int16Array;
    let dsp: AudioDSP;

    beforeEach(() => {
        // Reset mocks
        mockMalloc = vi.fn((_size: number) => 1024);
        mockFree = vi.fn();
        
        // Create mock heap arrays
        heapBuffer = new ArrayBuffer(1024 * 1024);
        heapF32 = new Float32Array(heapBuffer);
        heap16 = new Int16Array(heapBuffer);

        mockModule = {
            applyGain: vi.fn(),
            mixBuffers: vi.fn(),
            findPeak: vi.fn(() => 0.8),
            deinterleaveStereo: vi.fn(),
            interleaveStereo: vi.fn(),
            floatToInt16: vi.fn(),
            applyStereoWidth: vi.fn(),
            getNumThreads: vi.fn(() => 4),
            setNumThreads: vi.fn(),
        } as unknown as ReturnType<typeof vi.fn>;

        // Setup global WASM module mock
        globalThis.window = {
            AudioDSP: mockModule,
            Module: {
                HEAPF32: heapF32,
                HEAP16: heap16,
                _malloc: mockMalloc,
                _free: mockFree,
            },
        } as unknown as Window & typeof globalThis.window;
        
        // Create fresh instance
        dsp = new AudioDSP();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Thread Management', () => {
        it('should get number of available threads', () => {
            const threads = dsp.getNumThreads();
            expect(threads).toBe(4);
            expect((mockModule as unknown as Record<string, ReturnType<typeof vi.fn>>).getNumThreads).toHaveBeenCalled();
        });

        it('should set number of threads', () => {
            dsp.setNumThreads(2);
            expect((mockModule as unknown as Record<string, ReturnType<typeof vi.fn>>).setNumThreads).toHaveBeenCalledWith(2);
        });

        it('should clamp thread count to minimum of 1', () => {
            dsp.setNumThreads(0);
            expect((mockModule as unknown as Record<string, ReturnType<typeof vi.fn>>).setNumThreads).toHaveBeenCalledWith(1);
        });
    });

    describe('applyGain', () => {
        it('should apply gain to buffer via WASM when available', () => {
            const buffer = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            dsp.applyGain(buffer, 2, 2.0);
            
            expect(mockMalloc).toHaveBeenCalled();
            expect((mockModule as unknown as Record<string, ReturnType<typeof vi.fn>>).applyGain).toHaveBeenCalled();
            expect(mockFree).toHaveBeenCalled();
        });

        it('should fallback to JS implementation when WASM unavailable', () => {
            // Remove WASM module and create new instance
            (globalThis.window as { AudioDSP?: unknown; Module?: unknown }).AudioDSP = undefined;
            const jsDSP = new AudioDSP();
            
            const buffer = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            const original = new Float32Array(buffer);
            jsDSP.applyGain(buffer, 2, 2.0);
            
            // Check that gain was applied
            expect(buffer[0]).toBeCloseTo(original[0] * 2.0, 5);
            expect(buffer[1]).toBeCloseTo(original[1] * 2.0, 5);
        });
    });

    describe('findPeak', () => {
        it('should find peak amplitude via WASM', () => {
            const buffer = new Float32Array([0.1, -0.5, 0.3, -0.8]);
            const peak = dsp.findPeak(buffer, 2);
            
            expect((mockModule as unknown as Record<string, ReturnType<typeof vi.fn>>).findPeak).toHaveBeenCalled();
            expect(peak).toBeCloseTo(0.8, 5);
        });

        it('should fallback to JS implementation when WASM unavailable', () => {
            (globalThis.window as { AudioDSP?: unknown; Module?: unknown }).AudioDSP = undefined;
            
            const jsDSP = new AudioDSP();
            const buffer = new Float32Array([0.1, -0.5, 0.3, -0.8]);
            const peak = jsDSP.findPeak(buffer, 2);
            
            expect(peak).toBeCloseTo(0.8, 5);
        });
    });

    describe('deinterleaveStereo', () => {
        it('should deinterleave stereo buffer', () => {
            const interleaved = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
            dsp.deinterleaveStereo(interleaved);
            
            expect((mockModule as unknown as Record<string, ReturnType<typeof vi.fn>>).deinterleaveStereo).toHaveBeenCalled();
        });

        it('should fallback to JS when WASM unavailable', () => {
            (globalThis.window as { AudioDSP?: unknown; Module?: unknown }).AudioDSP = undefined;
            
            const jsDSP = new AudioDSP();
            const interleaved = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
            const result = jsDSP.deinterleaveStereo(interleaved);
            
            expect(result.left[0]).toBeCloseTo(0.1, 5);
            expect(result.left[1]).toBeCloseTo(0.3, 5);
            expect(result.left[2]).toBeCloseTo(0.5, 5);
            expect(result.left[3]).toBeCloseTo(0.7, 5);
            expect(result.right[0]).toBeCloseTo(0.2, 5);
            expect(result.right[1]).toBeCloseTo(0.4, 5);
            expect(result.right[2]).toBeCloseTo(0.6, 5);
            expect(result.right[3]).toBeCloseTo(0.8, 5);
        });
    });

    describe('floatToInt16', () => {
        it('should convert float32 to int16 with clipping', () => {
            const floatBuffer = new Float32Array([0.5, -0.5, 1.0, -1.0, 2.0, -2.0]);
            dsp.floatToInt16(floatBuffer);
            
            expect((mockModule as unknown as Record<string, ReturnType<typeof vi.fn>>).floatToInt16).toHaveBeenCalled();
        });

        it('should fallback to JS when WASM unavailable', () => {
            (globalThis.window as { AudioDSP?: unknown; Module?: unknown }).AudioDSP = undefined;
            
            const jsDSP = new AudioDSP();
            const floatBuffer = new Float32Array([0.5, -0.5, 1.0, -1.0]);
            const result = jsDSP.floatToInt16(floatBuffer);
            
            // Allow for rounding differences in float->int conversion
            expect([16383, 16384]).toContain(result[0]); // 0.5 * 32767
            expect([-16384, -16383]).toContain(result[1]); // -0.5 * 32767
            expect([32766, 32767]).toContain(result[2]); // clipped
            expect([-32768, -32767]).toContain(result[3]); // clipped
        });
    });

    describe('applyStereoWidth', () => {
        it('should throw error if channels have different lengths', () => {
            const left = new Float32Array([0.1, 0.2, 0.3]);
            const right = new Float32Array([0.1, 0.2]);
            
            expect(() => dsp.applyStereoWidth(left, right, 1.5)).toThrow();
        });

        it('should apply stereo width via WASM', () => {
            const left = new Float32Array([0.5, 0.5, 0.5, 0.5]);
            const right = new Float32Array([0.3, 0.3, 0.3, 0.3]);
            
            dsp.applyStereoWidth(left, right, 1.5);
            
            expect((mockModule as unknown as Record<string, ReturnType<typeof vi.fn>>).applyStereoWidth).toHaveBeenCalled();
        });
    });

    describe('mixBuffers', () => {
        it('should throw error for empty buffer array', () => {
            expect(() => dsp.mixBuffers([], [])).toThrow();
        });

        it('should throw error if buffer count mismatches gain count', () => {
            const buffers = [new Float32Array(4), new Float32Array(4)];
            const gains = [0.5];
            
            expect(() => dsp.mixBuffers(buffers, gains)).toThrow();
        });

        it('should throw error if buffers have different lengths', () => {
            const buffers = [new Float32Array(4), new Float32Array(8)];
            const gains = [0.5, 0.5];
            
            expect(() => dsp.mixBuffers(buffers, gains)).toThrow();
        });

        it('should mix buffers via WASM', () => {
            const buffers = [
                new Float32Array([0.1, 0.2, 0.3, 0.4]),
                new Float32Array([0.1, 0.2, 0.3, 0.4])
            ];
            const gains = [0.5, 0.5];
            
            dsp.mixBuffers(buffers, gains);
            
            expect((mockModule as unknown as Record<string, ReturnType<typeof vi.fn>>).mixBuffers).toHaveBeenCalled();
        });
    });
});

describe('AudioDSP Performance Characteristics', () => {
    it('should handle large buffers efficiently', () => {
        // Test with 1 second of 48kHz stereo audio
        const largeBuffer = new Float32Array(48000 * 2);
        for (let i = 0; i < largeBuffer.length; i++) {
            largeBuffer[i] = Math.sin(i * 0.01) * 0.5;
        }
        
        // Without WASM, this should still work
        (globalThis.window as { AudioDSP?: unknown; Module?: unknown }).AudioDSP = undefined;
        (globalThis.window as { AudioDSP?: unknown; Module?: unknown }).Module = undefined;
        
        const jsDSP = new AudioDSP();
        const start = performance.now();
        jsDSP.applyGain(largeBuffer, 2, 0.8);
        const duration = performance.now() - start;
        
        // Should complete in reasonable time even without WASM
        expect(duration).toBeLessThan(100);
    });
});
