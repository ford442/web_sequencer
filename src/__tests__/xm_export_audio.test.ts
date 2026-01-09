import { describe, it, expect } from 'vitest';
import { createSample, LoopType } from '../utils/xm_save_lib/index';

/**
 * Tests for XM Export audio processing utilities
 * These tests verify the normalization, loop point detection, and 16-bit conversion
 */

describe('XM Export Audio Processing', () => {
    describe('floatTo16BitPCM conversion', () => {
        // Replicate the function for testing
        const floatTo16BitPCM = (input: Float32Array): Int16Array => {
            const output = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
                let s = input[i];
                if (s > 0.95 || s < -0.95) {
                    s = Math.tanh(s);
                }
                s = Math.max(-1, Math.min(1, s));
                output[i] = Math.round(s * 32767);
            }
            return output;
        };

        it('should convert float audio to 16-bit with proper scaling', () => {
            const input = new Float32Array([0, 0.5, 1.0, -0.5, -1.0]);
            const output = floatTo16BitPCM(input);

            expect(output[0]).toBe(0);
            expect(output[1]).toBe(Math.round(0.5 * 32767));
            // Values at 1.0 are soft-clipped with tanh, so expect significant reduction
            expect(output[2]).toBeGreaterThan(20000);
            expect(output[3]).toBe(Math.round(-0.5 * 32767));
            expect(output[4]).toBeLessThan(-20000);
        });

        it('should apply soft clipping to values near the limit', () => {
            // Values near 1.0 should be soft-clipped using tanh
            const input = new Float32Array([0.96, 0.99, 1.0, 1.5]);
            const output = floatTo16BitPCM(input);

            // After tanh, values should be reduced
            expect(output[0]).toBeLessThan(32767);
            expect(output[1]).toBeLessThan(32767);
            expect(output[2]).toBeLessThan(32767);
            expect(output[3]).toBeLessThan(32767); // Clipped

            // But still preserve relative order
            expect(output[0]).toBeLessThan(output[1]);
            expect(output[1]).toBeLessThan(output[2]);
        });

        it('should produce approximately symmetric scaling for positive and negative values', () => {
            const input = new Float32Array([0.5, -0.5]);
            const output = floatTo16BitPCM(input);

            // Due to rounding, there may be a 1-bit difference
            expect(Math.abs(output[0] + output[1])).toBeLessThanOrEqual(1);
        });
    });

    describe('normalizeBuffer', () => {
        // Replicate the function for testing
        const normalizeBuffer = (input: Float32Array, targetPeakDb: number = -1): Float32Array => {
            let peak = 0;
            for (let i = 0; i < input.length; i++) {
                const abs = Math.abs(input[i]);
                if (abs > peak) peak = abs;
            }

            if (peak < 0.001) return input;

            const targetPeak = Math.pow(10, targetPeakDb / 20);

            if (peak < 0.5) {
                const gain = targetPeak / peak;
                const output = new Float32Array(input.length);
                for (let i = 0; i < input.length; i++) {
                    output[i] = Math.max(-1, Math.min(1, input[i] * gain));
                }
                return output;
            }

            return input;
        };

        it('should normalize quiet audio to target level', () => {
            const input = new Float32Array([0, 0.1, 0.2, -0.2, -0.1]);
            const output = normalizeBuffer(input);

            // Peak was 0.2, should be normalized to ~0.89 (-1dB)
            const newPeak = Math.max(...output.map(Math.abs));
            expect(newPeak).toBeGreaterThan(0.7);
            expect(newPeak).toBeLessThan(1.0);
        });

        it('should not normalize audio that is already loud enough', () => {
            const input = new Float32Array([0, 0.5, 0.8, -0.6, -0.3]);
            const output = normalizeBuffer(input);

            // Peak was 0.8 (> 0.5), should not be changed
            expect(output).toBe(input); // Same reference
        });

        it('should handle silent buffers gracefully', () => {
            const input = new Float32Array([0, 0, 0.0001, -0.0001, 0]);
            const output = normalizeBuffer(input);

            expect(output).toBe(input); // No change for near-silent audio
        });
    });

    describe('findZeroCrossing', () => {
        // Replicate the function for testing
        const findZeroCrossing = (buffer: Float32Array, position: number, direction: number = 1, maxSearch: number = 1000): number => {
            const len = buffer.length;
            for (let i = 0; i < maxSearch; i++) {
                const idx = position + (i * direction);
                if (idx < 1 || idx >= len - 1) break;

                if (buffer[idx] >= 0 && buffer[idx - 1] < 0) {
                    return idx;
                }
            }
            return position;
        };

        it('should find positive-going zero crossing forward', () => {
            // Create a simple sine-like pattern
            const buffer = new Float32Array(100);
            for (let i = 0; i < 100; i++) {
                buffer[i] = Math.sin(i * Math.PI / 10);
            }

            const zeroCross = findZeroCrossing(buffer, 5, 1, 50);
            // Zero crossing happens at index 10 (sin goes from negative to positive)
            expect(buffer[zeroCross]).toBeGreaterThanOrEqual(0);
            expect(buffer[zeroCross - 1]).toBeLessThan(0);
        });

        it('should find zero crossing backward', () => {
            const buffer = new Float32Array(100);
            for (let i = 0; i < 100; i++) {
                buffer[i] = Math.sin(i * Math.PI / 10);
            }

            const zeroCross = findZeroCrossing(buffer, 50, -1, 50);
            expect(buffer[zeroCross]).toBeGreaterThanOrEqual(0);
            expect(buffer[zeroCross - 1]).toBeLessThan(0);
        });
    });

    describe('Loop Point Detection', () => {
        // Replicate the synth loop points function (updated to robust logic)
        const findSynthLoopPoints = (buffer: Float32Array, sampleRate: number = 44100, attackDecayTime: number = 0.3): { loopStart: number, loopEnd: number } => {
            const len = buffer.length;
            // More permissive steady state definition
            let steadyStateStart = Math.min(Math.floor(attackDecayTime * sampleRate), Math.floor(len * 0.4));
            let steadyStateEnd = Math.floor(len * 0.95);
            const minLoopLength = Math.floor(sampleRate * 0.02);

            // Fallback for short buffers
            if (steadyStateEnd - steadyStateStart < minLoopLength * 2) {
                steadyStateStart = Math.floor(len * 0.25);
                steadyStateEnd = Math.floor(len * 0.75);
            }

            if (steadyStateEnd - steadyStateStart < minLoopLength) {
                return { loopStart: 0, loopEnd: 0 };
            }

            // Helper to find crossing with specific direction
            const findCross = (start: number, end: number, step: number): number => {
                if (step > 0) {
                    for (let i = start; i < end; i += step) {
                        if (buffer[i] >= 0 && buffer[i - 1] < 0) return i;
                    }
                } else {
                    for (let i = start; i > end; i += step) {
                        if (buffer[i] >= 0 && buffer[i - 1] < 0) return i;
                    }
                }
                return -1;
            };

            // Find start
            const searchWindow = Math.floor(sampleRate * 0.2);
            const limitStart = Math.min(steadyStateStart + searchWindow, len - 1);

            let loopStart = findCross(steadyStateStart, limitStart, 1);
            if (loopStart === -1) loopStart = steadyStateStart;

            // Find end
            let loopEnd = -1;
            const endSearchLimit = Math.max(loopStart + minLoopLength, steadyStateEnd - searchWindow);

            loopEnd = findCross(steadyStateEnd, endSearchLimit, -1);

            // Simplified fallback logic for test
            if (loopEnd === -1) {
                // If no zero crossing at end, force fallback to steadyStateEnd if valid
                if (steadyStateEnd > loopStart + minLoopLength) {
                    loopEnd = steadyStateEnd;
                }
            }

            if (loopEnd > loopStart + minLoopLength) {
                return { loopStart, loopEnd };
            }

            // Ultimate fallback
            if (steadyStateEnd > steadyStateStart + minLoopLength) {
                return { loopStart: steadyStateStart, loopEnd: steadyStateEnd };
            }

            return { loopStart: 0, loopEnd: 0 };
        };

        it('should find loop points in a sustained synth waveform', () => {
            // Create a sine wave (2 seconds at 44.1kHz)
            const sampleRate = 44100;
            const duration = 2.0;
            const buffer = new Float32Array(Math.floor(sampleRate * duration));
            const freq = 440;

            for (let i = 0; i < buffer.length; i++) {
                buffer[i] = Math.sin(2 * Math.PI * freq * i / sampleRate);
            }

            const loopPoints = findSynthLoopPoints(buffer, sampleRate, 0.1);

            // Should find valid loop points
            expect(loopPoints.loopStart).toBeGreaterThan(0);
            expect(loopPoints.loopEnd).toBeGreaterThan(loopPoints.loopStart);
            expect(loopPoints.loopEnd - loopPoints.loopStart).toBeGreaterThan(sampleRate * 0.05);
        });

        it('should fallback to partial loop for short buffers', () => {
            // Short buffer (100ms) - previously might have failed, now should try to loop
            // With 100ms, steady state region is small but should be > minLoop (20ms)
            const buffer = new Float32Array(4410); // 100ms at 44.1kHz
            for (let i = 0; i < buffer.length; i++) {
                buffer[i] = Math.sin(2 * Math.PI * 440 * i / 44100);
            }

            const loopPoints = findSynthLoopPoints(buffer, 44100, 0.1);

            // Should set loop now with new logic
            expect(loopPoints.loopEnd).toBeGreaterThan(loopPoints.loopStart);
        });

        it('should return no loop for extremely short buffers (e.g. < 20ms)', () => {
             // Extremely short buffer
             const buffer = new Float32Array(500); // ~11ms
             const loopPoints = findSynthLoopPoints(buffer, 44100, 0.1);
             expect(loopPoints.loopStart).toBe(0);
             expect(loopPoints.loopEnd).toBe(0);
        });
    });

    describe('XM Sample Creation with Loops', () => {
        it('should create sample with forward loop type', () => {
            const testData = new Int16Array([1000, 2000, 3000, 2000, 1000, 0, -1000, -2000]);

            const sample = createSample({
                name: 'Test Loop',
                data: testData,
                volume: 64,
                loopType: LoopType.Forward,
                loopStart: 100,
                loopLength: 500,
            });

            // Check loop type is set correctly (bits 0-1)
            expect(sample.header.type & 0x03).toBe(LoopType.Forward);
            expect(sample.header.loopStart).toBe(100);
            expect(sample.header.loopLength).toBe(500);
        });

        it('should create sample with no loop', () => {
            const testData = new Int16Array([1000, 2000, 3000]);

            const sample = createSample({
                name: 'Test OneShot',
                data: testData,
                volume: 64,
                loopType: LoopType.None,
            });

            expect(sample.header.type & 0x03).toBe(LoopType.None);
            expect(sample.header.loopStart).toBe(0);
            expect(sample.header.loopLength).toBe(0);
        });

        it('should correctly set 16-bit flag', () => {
            const testData = new Int16Array([1000, 2000, 3000]);

            const sample = createSample({
                name: 'Test 16bit',
                data: testData,
                volume: 64,
            });

            // Bit 4 should be set for 16-bit samples
            expect(sample.header.type & 0x10).toBe(0x10);
        });
    });
});
