// @ts-expect-error - The wasm-bindgen generated JS file is in public/ and resolved at runtime, but TS doesn't see it.
import init, { generate_rust_wave } from '/rust-wasm/rust_audio.js';
import { engineTelemetry } from '../utils/engineTelemetry';

export class RustOscillator {
    isReady: boolean = false;

    async init() {
        try {
            // Initialize the WASM module
            await init();
            this.isReady = true;
            try { engineTelemetry.registerResolution('rust', 'wasm', 'loaded'); } catch (err) {}
            console.log("Rust Engine Ready");
        } catch (e) {
            try { engineTelemetry.registerResolution('rust', 'fallback', 'init-failed'); engineTelemetry.recordError('rust', e); } catch (_) {}
            console.error("Rust Init Failed", e);
        }
    }

    generate(
        freq: number,
        dur: number,
        rate: number,
        type: 'saw' | 'sqr',
        cutoff: number,
        resonance: number
    ): Float32Array | null {
        if (!this.isReady) return null;

        // Map type string to integer for Rust
        const typeId = type === 'saw' ? 0 : 1;

        try {
            // Call the exported Rust function
            const t0 = performance.now();
            const res = generate_rust_wave(rate, freq, dur, typeId, cutoff, resonance);
            const t1 = performance.now();
            try { engineTelemetry.recordLatency('rust', t1 - t0); } catch (err) {}
            return res;
        } catch (e) {
            try { engineTelemetry.recordError('rust', e); } catch (err) {}
            console.error("Rust Render Error", e);
            return null;
        }
    }
}
