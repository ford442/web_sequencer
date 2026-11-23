/**
 * Offline render of the `rust-*` oscillator family (#1664): XM one-shots,
 * pattern bounces, anything `renderSynthToBuffer` makes.
 *
 * Not a port: the same public/rust_osc.wasm the rust-osc-processor worklet
 * runs (one compiled module, `loadRustOscModule`), instantiated privately on
 * the calling thread. Offline rendering is not the realtime path #1294 forbade
 * on the main thread — it renders faster than realtime into a buffer that is
 * then played once, exactly like the WebGPU and Pyodide pre-renders. The
 * realtime note path never comes here; `oscillatorEngineContract.test.ts`
 * allows the kernel's `rosc_render` in this file and the worklet only.
 *
 * The caller (renderSynthToBuffer) applies the voice's filter and envelope, as
 * `Voice` does live, so a bounced note matches the played one.
 */

import { RUST_OSC_SHAPE_ID, hasRustOscApi, type RustOscExports } from '../../audio-worklets/rustOsc';
import { loadRustOscModule } from '../../engines/RustOscillator';
import type { WaveShape } from '../../utils/waveformParser';

export interface OfflineRustOscRequest {
    shape: WaveShape;
    /** Constant pitch of the note, Hz. */
    hz: number;
    frames: number;
    sampleRate: number;
}

/**
 * Render `request` on an instance of `module`. Pure apart from the instance it
 * creates; exported for tests.
 */
export function renderRustOscOnModule(module: WebAssembly.Module, request: OfflineRustOscRequest): Float32Array | null {
    const exports = new WebAssembly.Instance(module, {}).exports;
    if (!hasRustOscApi(exports)) return null;
    const x: RustOscExports = exports;
    if (x.rosc_init(request.sampleRate) !== 1) return null;
    const max = x.rosc_max_frames();
    const freq = new Float32Array(x.memory.buffer, x.rosc_freq_ptr(), max);
    const out = new Float32Array(x.memory.buffer, x.rosc_out_ptr(), max);
    freq[0] = request.hz;
    const shape = RUST_OSC_SHAPE_ID[request.shape];
    const result = new Float32Array(Math.max(0, Math.floor(request.frames)));
    for (let at = 0; at < result.length; ) {
        const n = x.rosc_render(shape, Math.min(max, result.length - at), 0);
        if (n <= 0) return null;
        result.set(out.subarray(0, n), at);
        at += n;
    }
    return result;
}

/**
 * The note's samples, or null when the module is unavailable (the caller then
 * substitutes and reports it, as the live path does).
 */
export async function renderRustOscOffline(request: OfflineRustOscRequest): Promise<Float32Array | null> {
    const loaded = await loadRustOscModule();
    if (!loaded.module) return null;
    return renderRustOscOnModule(loaded.module, request);
}
