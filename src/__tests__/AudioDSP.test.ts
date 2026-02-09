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
        mockMalloc = vi.fn((size: number) => 1024);
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
        };

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
            expect(mockModule.getNumThreads).toHaveBeenCalled();
        });

        it('should set number of threads', () => {
            dsp.setNumThreads(2);
            expect(mockModule.setNumThreads).toHaveBeenCalledWith(2);
        });

        it('should clamp thread count to minimum of 1', () => {
            dsp.setNumThreads(0);
            expect(mockModule.setNumThreads).toHaveBeenCalledWith(1);
        });
    });

    describe('applyGain', () => {
        it('should apply gain to buffer via WASM when available', () => {
            const buffer = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            dsp.applyGain(buffer, 2, 2.0);
            
            expect(mockMalloc).toHaveBeenCalled();
            expect(mockModule.applyGain).toHaveBeenCalled();
            expect(mockFree).toHaveBeenCalled();
        });

        it('should fallback to JS implementation when WASM unavailable', () => {
            // Remove WASM module
            delete (globalThis.window as any).AudioDSP;
            
            const buffer = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            const original = new Float32Array(buffer);
            dsp.applyGain(buffer, 2, 2.0);
            
            // Check that gain was applied
            expect(buffer[0]).toBeCloseTo(original[0] * 2.0);
            expect(buffer[1]).toBeCloseTo(original[1] * 2.0);
        });
    });

    describe('findPeak', () => {
        it('should find peak amplitude via WASM', () => {
            const buffer = new Float32Array([0.1, -0.5, 0.3, -0.8]);
            const peak = dsp.findPeak(buffer, 2);
            
            expect(mockModule.findPeak).toHaveBeenCalled();
            expect(peak).toBe(0.8);
        });

        it('should fallback to JS implementation when WASM unavailable', () => {
            delete (globalThis.window as any).AudioDSP;
            
            const buffer = new Float32Array([0.1, -0.5, 0.3, -0.8]);
            const peak = dsp.findPeak(buffer, 2);
            
            expect(peak).toBe(0.8);
        });
    });

    describe('deinterleaveStereo', () => {
        it('should deinterleave stereo buffer', () => {
            const interleaved = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
            const result = dsp.deinterleaveStereo(interleaved);
            
            expect(mockModule.deinterleaveStereo).toHaveBeenCalled();
        });

        it('should fallback to JS when WASM unavailable', () => {
            delete (globalThis.window as any).AudioDSP;
            
            const interleaved = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
            const result = dsp.deinterleaveStereo(interleaved);
            
            expect(result.left).toEqual(new Float32Array([0.1, 0.3, 0.5, 0.7]));
            expect(result.right).toEqual(new Float32Array([0.2, 0.4, 0.6, 0.8]));
        });
    });

    describe('floatToInt16', () => {
        it('should convert float32 to int16 with clipping', () => {
            const floatBuffer = new Float32Array([0.5, -0.5, 1.0, -1.0, 2.0, -2.0]);
            const result = dsp.floatToInt16(floatBuffer);
            
            expect(mockModule.floatToInt16).toHaveBeenCalled();
        });

        it('should fallback to JS when WASM unavailable', () => {
            delete (globalThis.window as any).AudioDSP;
            
            const floatBuffer = new Float32Array([0.5, -0.5, 1.0, -1.0]);
            const result = dsp.floatToInt16(floatBuffer);
            
            expect(result[0]).toBeCloseTo(16384, 0); // 0.5 * 32767
            expect(result[1]).toBeCloseTo(-16384, 0); // -0.5 * 32767
            expect(result[2]).toBe(32767); // clipped
            expect(result[3]).toBe(-32768); // clipped
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
            
            expect(mockModule.applyStereoWidth).toHaveBeenCalled();
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
            
            expect(mockModule.mixBuffers).toHaveBeenCalled();
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
        delete (globalThis.window as any).AudioDSP;
        delete (globalThis.window as any).Module;
        
        const dsp = new AudioDSP();
        const start = performance.now();
        dsp.applyGain(largeBuffer, 2, 0.8);
        const duration = performance.now() - start;
        
        // Should complete in reasonable time even without WASM
        expect(duration).toBeLessThan(100);
    });
});
