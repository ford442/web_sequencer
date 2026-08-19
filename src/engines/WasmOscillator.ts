// @mode: bridge
// @note-for-ai: This is the TypeScript bridge to the AssemblyScript WASM module.
// The heavy DSP logic is in assembly/oscillators.ts. This file handles:
// - WASM loading and initialization
// - Memory management (copying data out of WASM memory)
// - Error handling and fallback paths

import initOscillators from '../wasm/oscillators.wasm?init';
import { engineTelemetry, logEngineFallback } from '@/utils/engineTelemetry';

interface OscillatorWasmExports {
    memory: WebAssembly.Memory;
    generate: (
        offset: number,
        rate: number,
        freq: number,
        dur: number,
        type: number,
        cutoff: number,
        resonance: number,
    ) => number;
}

export class WasmOscillator {
    private instance: WebAssembly.Instance | null = null;
    private memory: WebAssembly.Memory | null = null;
    isReady: boolean = false;

    async init() {
        try {
            // Instantiate (Let WASM create its own memory)
            console.log("INIT FUN:", initOscillators); this.instance = await initOscillators({
                env: {
                    abort: () => {}
                }
            });

            // Grab the exported memory
            this.memory = this.instance.exports.memory as WebAssembly.Memory;

            this.isReady = true;
            try { engineTelemetry.registerResolution('wam', 'wasm', 'loaded'); } catch (_) {}
        } catch (e) {
            logEngineFallback('wam', 'wasm', 'AssemblyScript oscillators.wasm instantiation failed', e);
        }
    }

    generate(
        freq: number,
        dur: number,
        rate: number,
        type: 'saw' | 'sqr' | 'tri' | 'sin',
        cutoff: number,
        resonance: number
    ): Float32Array | null {
        if (!this.isReady || !this.instance || !this.memory) return null;

        const exports = this.instance.exports as unknown as OscillatorWasmExports;
        const typeMap = { saw: 0, sqr: 1, tri: 2, sin: 3 };

        // Constraints
        const safeCutoff = Math.max(20, Math.min(rate / 2.1, cutoff));
        const safeRes = Math.max(0.1, resonance);

        // Generate
        // We use offset 0 in the shared memory
        const numSamples = exports.generate(0, rate, freq, dur, typeMap[type], safeCutoff, safeRes);

        // Copy the data out safely using slice()
        // If we don't slice, the view changes when the next note is generated!
        return new Float32Array(this.memory.buffer).slice(0, numSamples);
    }
}
