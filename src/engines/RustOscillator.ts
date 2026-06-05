// The wasm-bindgen generated JS lives in /public/rust-wasm/ and is only
// available at runtime (not a bundled module). We use a dynamic import inside
// init() so Vite's static import-analysis never touches the public-asset path.
import { engineTelemetry } from '../utils/engineTelemetry';

type RustGenerateFn = (rate: number, freq: number, dur: number, typeId: number, cutoff: number, resonance: number) => Float32Array;

export class RustOscillator {
    isReady: boolean = false;
    private generateFn: RustGenerateFn | null = null;

    async init() {
        try {
            // Dynamic import keeps the public-asset path out of Vite's static
            // analysis (and therefore out of test compilation paths).
            // Using a variable (not a string literal) keeps Vite's static import-analysis
            // from checking the public-directory path at compile/test time.
            // @ts-expect-error — wasm-bindgen output in public/, TS can't resolve it
            const rustPath = '/rust-wasm/rust_audio.js';
            const mod = await import(/* @vite-ignore */ rustPath) as { default: () => Promise<void>; generate_rust_wave: RustGenerateFn };
            await mod.default();
            this.generateFn = mod.generate_rust_wave;
            this.isReady = true;
            try { engineTelemetry.registerResolution('rust', 'wasm', 'loaded'); } catch (_) {}
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
        if (!this.isReady || !this.generateFn) return null;

        const typeId = type === 'saw' ? 0 : 1;

        try {
            const t0 = performance.now();
            const res = this.generateFn(rate, freq, dur, typeId, cutoff, resonance);
            const t1 = performance.now();
            try { engineTelemetry.recordLatency('rust', t1 - t0); } catch (_) {}
            return res;
        } catch (e) {
            try { engineTelemetry.recordError('rust', e); } catch (_) {}
            console.error("Rust Render Error", e);
            return null;
        }
    }
}
