// The wasm-bindgen generated JS lives in /public/rust-wasm/ and is only
// available at runtime (not a bundled module). We use a dynamic import inside
// init() so Vite's static import-analysis never touches the public-asset path.
import { engineTelemetry, logEngineFallback, resolvePublicAsset } from '../utils/engineTelemetry';

type RustGenerateFn = (rate: number, freq: number, dur: number, typeId: number, cutoff: number, resonance: number) => Float32Array;

export class RustOscillator {
    isReady: boolean = false;
    private generateFn: RustGenerateFn | null = null;

    async init() {
        const rustJs = resolvePublicAsset('rust-wasm/rust_audio.js');
        const rustWasm = resolvePublicAsset('rust-wasm/rust_audio_bg.wasm');
        try {
            const mod = await import(/* @vite-ignore */ rustJs) as {
                default: (wasmUrl?: string | URL) => Promise<void>;
                generate_rust_wave: RustGenerateFn;
            };
            await mod.default(rustWasm);
            this.generateFn = mod.generate_rust_wave;
            this.isReady = true;
            try { engineTelemetry.registerResolution('rust', 'wasm', 'loaded'); } catch (_) {}
            console.log('[RustOscillator] Engine ready');
        } catch (e) {
            logEngineFallback('rust', 'wasm', `dynamic import failed (${rustJs})`, e);
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
            logEngineFallback('rust', 'wasm', 'RustOscillator.generate() runtime error', e);
            return null;
        }
    }
}
