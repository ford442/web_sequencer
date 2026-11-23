/**
 * Offline render of the `cpp-*` oscillator family (#1665): XM one-shots,
 * pattern bounces, anything `renderSynthToBuffer` makes.
 *
 * Not a port: the same public/cpp_osc.wasm the cpp-osc-processor worklet runs
 * (one compiled module, `loadCppOscModule`), instantiated privately on the
 * calling thread through the same `instantiateCppOsc`. Offline rendering is not
 * the realtime path #1294 forbade on the main thread — it renders faster than
 * realtime into a buffer that is then played once, exactly like the Rust OSC,
 * WebGPU and Pyodide pre-renders. The realtime note path never comes here;
 * `oscillatorEngineContract.test.ts` allows the kernel's `cosc_render` in this
 * file and the worklet only.
 *
 * The note starts the way a live gate-open does (`cosc_reset(0)`), so a bounced
 * note is sample-identical to the played one, including the kernel's fixed
 * `cosc_latency()` delay. The caller (renderSynthToBuffer) applies the voice's
 * filter and envelope, as `Voice` does live.
 */

import { CPP_OSC_SHAPE_ID, instantiateCppOsc } from '../../audio-worklets/cppOsc';
import { loadCppOscModule } from '../../engines/CppOscillator';
import type { WaveShape } from '../../utils/waveformParser';

export interface OfflineCppOscRequest {
    shape: WaveShape;
    /** Constant pitch of the note, Hz. */
    hz: number;
    frames: number;
    sampleRate: number;
}

/**
 * Render `request` on an instance of `module`. Pure apart from the instance it
 * creates; exported for tests. Null when the module refuses the request.
 */
export function renderCppOscOnModule(module: WebAssembly.Module, request: OfflineCppOscRequest): Float32Array | null {
    let x;
    try {
        x = instantiateCppOsc(module, request.sampleRate);
    } catch {
        return null;
    }
    const max = x.cosc_max_frames();
    const freq = new Float32Array(x.memory.buffer, x.cosc_freq_ptr(), max);
    const out = new Float32Array(x.memory.buffer, x.cosc_out_ptr(), max);
    freq[0] = request.hz;
    x.cosc_reset(0);
    const shape = CPP_OSC_SHAPE_ID[request.shape];
    const result = new Float32Array(Math.max(0, Math.floor(request.frames)));
    for (let at = 0; at < result.length; ) {
        const n = x.cosc_render(shape, Math.min(max, result.length - at), 0);
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
export async function renderCppOscOffline(request: OfflineCppOscRequest): Promise<Float32Array | null> {
    const loaded = await loadCppOscModule();
    if (!loaded.module) return null;
    return renderCppOscOnModule(loaded.module, request);
}
