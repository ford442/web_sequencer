import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Import the module
import { findLoopPoints, audioBufferToMono, setWasmInstance } from '../utils/trackFreezer';

describe('trackFreezer', () => {

    // Setup WASM for tests
    beforeAll(async () => {
        const wasmPath = path.resolve(__dirname, '../../public/trackFreezer.wasm');
        if (fs.existsSync(wasmPath)) {
            const buffer = fs.readFileSync(wasmPath);
            const { instance } = await WebAssembly.instantiate(buffer, {
                env: {
                    abort: () => console.error("WASM Abort")
                }
            });
            // Inject the WASM instance directly to test the bridge
            setWasmInstance(instance.exports);
            console.log("WASM loaded for tests");
        } else {
            console.warn("WASM file not found, tests will run on JS fallback only");
        }
    });

    describe('findLoopPoints', () => {
        it('should find optimal loop points using zero-crossing detection', () => {
            const buffer = new Float32Array(10000);

            // Create a signal with known zero crossings
            // We want positive slope zero crossings (negative to positive)

            // At index 500: -0.5 -> 0.5 (Start candidate)
            buffer[499] = -0.5;
            buffer[500] = 0.5;

            // At index 9000: -0.5 -> 0.5 (End candidate)
            buffer[9000] = 0.5;
            buffer[8999] = -0.5;

            const result = findLoopPoints(buffer);

            expect(result.start).toBe(500);
            expect(result.end).toBe(9000);
        });

        it('should respect minimum loop length', () => {
            const buffer = new Float32Array(10000);
            const minLoop = 5000;

            // Start point
            buffer[499] = -0.1;
            buffer[500] = 0.1;

            // Potential end point too close (index 2000) - should be skipped
            buffer[1999] = -0.1;
            buffer[2000] = 0.1;

            // Valid end point (index 6000) > 500 + 5000
            buffer[5999] = -0.1;
            buffer[6000] = 0.1;

            const result = findLoopPoints(buffer, minLoop);

            expect(result.start).toBe(500);
            expect(result.end).toBe(6000);
        });
    });

    describe('audioBufferToMono', () => {
        it('should return channel 0 if buffer is already mono', () => {
            const monoData = new Float32Array([0.1, 0.2, 0.3]);
            const buffer = {
                numberOfChannels: 1,
                length: 3,
                getChannelData: vi.fn().mockReturnValue(monoData)
            } as any as AudioBuffer;

            const result = audioBufferToMono(buffer);
            expect(result).toBe(monoData);
        });

        it('should mix down stereo to mono (WASM Path)', () => {
            const left = new Float32Array([0.2, 0.4, 0.6]);
            const right = new Float32Array([0.4, 0.6, 0.8]);

            // Expected: (L + R) / 2
            // 0: (0.2+0.4)/2 = 0.3
            // 1: (0.4+0.6)/2 = 0.5
            // 2: (0.6+0.8)/2 = 0.7

            const buffer = {
                numberOfChannels: 2,
                length: 3,
                getChannelData: vi.fn().mockImplementation((ch) => ch === 0 ? left : right)
            } as any as AudioBuffer;

            const result = audioBufferToMono(buffer);

            expect(result[0]).toBeCloseTo(0.3);
            expect(result[1]).toBeCloseTo(0.5);
            expect(result[2]).toBeCloseTo(0.7);
        });

        it('should mix down 4 channels to mono (JS Fallback Path)', () => {
            // Verify fallback for > 2 channels
            const ch0 = new Float32Array([1.0, 1.0]);
            const ch1 = new Float32Array([1.0, 1.0]);
            const ch2 = new Float32Array([1.0, 1.0]);
            const ch3 = new Float32Array([1.0, 1.0]);

            const buffer = {
                numberOfChannels: 4,
                length: 2,
                getChannelData: vi.fn().mockImplementation((ch) => {
                    if (ch === 0) return ch0;
                    if (ch === 1) return ch1;
                    if (ch === 2) return ch2;
                    return ch3;
                })
            } as any as AudioBuffer;

            audioBufferToMono(buffer);

            // Average of 4 channels with value 1.0 should be 1.0
            // If WASM ran (and only took first 2 and div by 2), it would also be 1.0 actually...
            // Let's use different values to distinguish.
            // WASM (stereo): (C0 + C1) * 0.5
            // JS (quad): (C0 + C1 + C2 + C3) / 4

            // Case 1: C0=1, C1=1, C2=0, C3=0
            // WASM: (1+1)*0.5 = 1.0
            // JS: (1+1+0+0)/4 = 0.5

            // Re-setup with distinct values
            const c0 = new Float32Array([1.0]);
            const c1 = new Float32Array([1.0]);
            const c2 = new Float32Array([0.0]);
            const c3 = new Float32Array([0.0]);

            const bufMixed = {
                numberOfChannels: 4,
                length: 1,
                getChannelData: vi.fn().mockImplementation((ch) => {
                    if (ch === 0) return c0;
                    if (ch === 1) return c1;
                    if (ch === 2) return c2;
                    return c3;
                })
            } as any as AudioBuffer;

            const res = audioBufferToMono(bufMixed);
            expect(res[0]).toBeCloseTo(0.5); // Proves it used the 4-channel divisor logic
        });
    });
});
