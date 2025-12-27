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
    });

    it('should initialize correctly', async () => {
        // Mock a fake WASM module
        const mockMemory = new WebAssembly.Memory({ initial: 1 });
        const mockExports = {
            memory: mockMemory,
            generate: vi.fn(() => 100) // Returns 100 samples
        };

        // Spy on WebAssembly.instantiate
        vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
            instance: { exports: mockExports } as any,
            module: {} as any
        });

        // Spy on fetch
        global.fetch = vi.fn().mockResolvedValue({
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
        } as any);

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
});
