// src/__tests__/WasmOscillator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WasmOscillator } from '../engines/WasmOscillator';

// Mock fetch for WASM (Since we can't easily load actual binaries in unit tests without setup)
// In a real scenario, you might use a valid minimal WASM buffer here.
// For now, we will test the Class Logic and API structure.

describe('WasmOscillator', () => {
    let oscillator: WasmOscillator;

    beforeEach(() => {
        oscillator = new WasmOscillator();
        vi.restoreAllMocks();
    });

    it('should initialize correctly', async () => {
        const mockExports = {
            memory: new WebAssembly.Memory({ initial: 1 }),
            generate: vi.fn(() => 100) // Returns 100 samples
        };

        const wasmResult = {
            instance: { exports: mockExports } as any,
            module: {} as any
        };

        // Spy on WebAssembly.instantiate and instantiateStreaming
        // We mock both to ensure whichever path vite-plugin-wasm takes is covered
        // and to avoid Node.js strict Response checks in instantiateStreaming.
        vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue(wasmResult as any);
        vi.spyOn(WebAssembly, 'instantiateStreaming').mockResolvedValue(wasmResult as any);

        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/wasm' },
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        } as unknown as Response);

        await oscillator.init();
        expect(oscillator.isReady).toBe(true);
    });

    it('should call generate on the WASM instance', async () => {
        // Setup fully mocked instance
        const mockGenerate = vi.fn(() => 128);
        const mockMemory = new WebAssembly.Memory({ initial: 1 });

        // Manually inject state (since we are testing the generate logic specifically)
        (oscillator as any).instance = {
            exports: {
                memory: mockMemory,
                generate: mockGenerate
            }
        };
        (oscillator as any).memory = mockMemory;
        oscillator.isReady = true;

        const result = oscillator.generate(440, 1.0, 44100, 'sin', 2000, 1);

        expect(mockGenerate).toHaveBeenCalled();
        expect(result).toBeInstanceOf(Float32Array);
        expect(result?.length).toBe(128);
    });

    describe('loop tables', () => {
        function withKernel(exports: Record<string, unknown>, pages = 1) {
            const memory = new WebAssembly.Memory({ initial: pages });
            const instance = { exports: { memory, ...exports } };
            (oscillator as any).instance = instance;
            (oscillator as any).memory = memory;
            oscillator.isReady = true;
            return memory;
        }

        it('asks the kernel for a seamless table only when told to', () => {
            const generate = vi.fn(() => 64);
            const generateLoop = vi.fn(() => 32);
            withKernel({ generate, generateLoop });

            expect(oscillator.generate(261.63, 2, 48000, 'saw', 2000, 1)?.length).toBe(64);
            expect(oscillator.generate(261.63, 2, 48000, 'saw', 2000, 1, true)?.length).toBe(32);
            expect(generate).toHaveBeenCalledTimes(1);
            expect(generateLoop).toHaveBeenCalledTimes(1);
        });

        it('passes the same arguments to generateLoop as to generate', () => {
            const generateLoop = vi.fn(() => 8);
            withKernel({ generate: vi.fn(() => 8), generateLoop });
            oscillator.generate(261.63, 2, 48000, 'tri', 99999, 0.01, true);
            // offset, rate, freq, dur, type, cutoff (clamped below Nyquist), resonance (clamped up)
            expect(generateLoop).toHaveBeenCalledWith(0, 48000, 261.63, 2, 2, 48000 / 2.1, 0.1, 0);
        });

        it.each([['lp', 0], ['bp', 1], ['hp', 2]] as const)(
            'passes filter type %s to the kernel as id %i, in both entry points (#1663)',
            (filterType, id) => {
                const generate = vi.fn(() => 8);
                const generateLoop = vi.fn(() => 8);
                withKernel({ generate, generateLoop });
                oscillator.generate(440, 1, 48000, 'saw', 1000, 2, false, filterType);
                oscillator.generate(440, 1, 48000, 'saw', 1000, 2, true, filterType);
                expect(generate).toHaveBeenCalledWith(0, 48000, 440, 1, 0, 1000, 2, id);
                expect(generateLoop).toHaveBeenCalledWith(0, 48000, 440, 1, 0, 1000, 2, id);
            },
        );

        it('defaults to a lowpass when no filter type is given (every caller that predates #1663)', () => {
            const generate = vi.fn(() => 8);
            withKernel({ generate });
            oscillator.generate(440, 1, 48000, 'saw', 1000, 2);
            expect(generate).toHaveBeenCalledWith(0, 48000, 440, 1, 0, 1000, 2, 0);
        });

        it('falls back to generate on a build without generateLoop', () => {
            const generate = vi.fn(() => 16);
            withKernel({ generate });
            expect(oscillator.generate(440, 1, 44100, 'sqr', 2000, 1, true)?.length).toBe(16);
            expect(generate).toHaveBeenCalledTimes(1);
        });
    });

    describe('memory', () => {
        it('grows to fit a render longer than the module reserves, before calling the kernel', () => {
            const memory = new WebAssembly.Memory({ initial: 1 });
            let pagesAtCall = 0;
            const generate = vi.fn(() => {
                pagesAtCall = memory.buffer.byteLength / 65536;
                return 100;
            });
            (oscillator as any).instance = { exports: { memory, generate } };
            (oscillator as any).memory = memory;
            oscillator.isReady = true;

            // 10 s at 48 kHz = 480k frames = 1.92 MB, against one 64 KiB page.
            const out = oscillator.generate(440, 10, 48000, 'saw', 2000, 1);
            expect(pagesAtCall).toBeGreaterThanOrEqual(Math.ceil((480000 * 4) / 65536));
            expect(out).toBeInstanceOf(Float32Array);
            expect(out?.length).toBe(100);
        });

        it('does not grow for a table that already fits', () => {
            const memory = new WebAssembly.Memory({ initial: 8 });
            (oscillator as any).instance = { exports: { memory, generate: vi.fn(() => 10) } };
            (oscillator as any).memory = memory;
            oscillator.isReady = true;
            const before = memory.buffer.byteLength;
            oscillator.generate(440, 0.5, 48000, 'sin', 2000, 1);
            expect(memory.buffer.byteLength).toBe(before);
        });

        it('survives a degenerate duration without sizing memory from NaN', () => {
            const memory = new WebAssembly.Memory({ initial: 1 });
            (oscillator as any).instance = { exports: { memory, generate: vi.fn(() => 0) } };
            (oscillator as any).memory = memory;
            oscillator.isReady = true;
            const before = memory.buffer.byteLength;
            expect(oscillator.generate(440, NaN, 48000, 'saw', 2000, 1)?.length).toBe(0);
            expect(oscillator.generate(NaN, 1, 48000, 'saw', 2000, 1, true)?.length).toBe(0);
            expect(memory.buffer.byteLength).toBe(before);
        });
    });
});
