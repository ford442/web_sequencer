/**
 * Offline render of the `dwgs-*` oscillator family (#1666): XM one-shots,
 * pattern bounces, anything `renderSynthToBuffer` makes.
 *
 * Not a port: the same public/dwgs_osc.wasm the dwgs-osc-processor worklet runs
 * (one compiled module, `loadDwgsOscModule`), instantiated privately on the
 * calling thread through the same `instantiateDwgsOsc`. Offline rendering is not
 * the realtime path #1294 forbade on the main thread — it renders faster than
 * realtime into a buffer that is then played once, exactly like the Rust and
 * C++ OSCs. The realtime note path never comes here;
 * `oscillatorEngineContract.test.ts` allows the kernel's `dwgs_render` in this
 * file and the worklet only.
 *
 * The note starts the way a live gate-open does (`dwgs_reset(0)`), so a bounced
 * note is sample-identical to the played one, noise included (the stream
 * restarts from the same seed). The caller (renderSynthToBuffer) applies the
 * voice's filter and envelope, as `Voice` does live.
 */

import { instantiateDwgsOsc } from '../../audio-worklets/dwgsOsc';
import { loadDwgsOscModule } from '../../engines/DwgsOscillator';

export interface OfflineDwgsOscRequest {
    /** Kernel wave id (index into DWGS_WAVES). */
    wave: number;
    /** Constant pitch of the note, Hz. */
    hz: number;
    frames: number;
    sampleRate: number;
}

/**
 * Render `request` on an instance of `module`. Pure apart from the instance it
 * creates; exported for tests. Null when the module refuses the request.
 */
export function renderDwgsOscOnModule(module: WebAssembly.Module, request: OfflineDwgsOscRequest): Float32Array | null {
    let x;
    try {
        x = instantiateDwgsOsc(module, request.sampleRate);
    } catch {
        return null;
    }
    const max = x.dwgs_max_frames();
    const freq = new Float32Array(x.memory.buffer, x.dwgs_freq_ptr(), max);
    const out = new Float32Array(x.memory.buffer, x.dwgs_out_ptr(), max);
    freq[0] = request.hz;
    x.dwgs_reset(0);
    const result = new Float32Array(Math.max(0, Math.floor(request.frames)));
    for (let at = 0; at < result.length; ) {
        const n = x.dwgs_render(request.wave, Math.min(max, result.length - at), 0);
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
export async function renderDwgsOscOffline(request: OfflineDwgsOscRequest): Promise<Float32Array | null> {
    const loaded = await loadDwgsOscModule();
    if (!loaded.module) return null;
    return renderDwgsOscOnModule(loaded.module, request);
}
