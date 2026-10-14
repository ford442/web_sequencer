/**
 * The two operations an offline stem mix needs — `dst += src * gain` and a
 * sample peak — behind one interface with two implementations:
 *
 * - `createNativeMixKernel` binds public/mix_bus.wasm (emscripten/mix_bus.cpp,
 *   SIMD, fixed memory). It streams through the module's two scratch blocks,
 *   so the wasm heap never grows with song length.
 * - `jsMixKernel` is the reference and the fallback. With `gain === 1` the
 *   native kernel is bit-identical to it.
 *
 * Pure: no DOM, no Worker. The worker (src/workers/mixBus.worker.ts) and the
 * Node integration test both instantiate the module through this file.
 */

/** Keep in step with emscripten/build_mix_bus.sh and tools/check_mix_bus_module.mjs. */
export const MIX_BUS_REQUIRED_EXPORTS = [
    'mix_bus_abi_version',
    'mix_bus_block_frames',
    'mix_bus_in_ptr',
    'mix_bus_acc_ptr',
    'mix_bus_accumulate',
    'mix_bus_peak',
] as const;

export const MIX_BUS_ABI_VERSION = 1;

export interface MixKernel {
    /** `'native'` for the wasm kernel, `'js'` for the reference loop. */
    readonly kind: 'native' | 'js';
    /** dst[i] += src[i] * gain over the frames both arrays cover. */
    accumulate(dst: Float32Array, src: Float32Array, gain: number): void;
    /** max |buf[i]|. */
    peak(buf: Float32Array): number;
}

export const jsMixKernel: MixKernel = {
    kind: 'js',
    accumulate(dst, src, gain) {
        const n = Math.min(dst.length, src.length);
        if (gain === 1) {
            // Same expression the pre-#1341 stemExport loop used, so the
            // fallback master is unchanged byte-for-byte.
            for (let i = 0; i < n; i++) dst[i] += src[i];
            return;
        }
        for (let i = 0; i < n; i++) dst[i] += src[i] * gain;
    },
    peak(buf) {
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
            const a = Math.abs(buf[i]);
            if (a > peak) peak = a;
        }
        return peak;
    },
};

interface MixBusWasmExports {
    memory: WebAssembly.Memory;
    _initialize?: () => void;
    mix_bus_abi_version(): number;
    mix_bus_block_frames(): number;
    mix_bus_in_ptr(): number;
    mix_bus_acc_ptr(): number;
    mix_bus_accumulate(frames: number, gain: number): void;
    mix_bus_peak(frames: number): number;
}

/** Why a compiled module cannot be used, or null when it can. */
export function describeMixBusModuleProblem(module: WebAssembly.Module): string | null {
    const imports = WebAssembly.Module.imports(module);
    if (imports.length) {
        return `mix_bus.wasm has ${imports.length} import(s) (expected none — wrong build?)`;
    }
    const names = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
    const missing = ['memory', ...MIX_BUS_REQUIRED_EXPORTS].filter((name) => !names.has(name));
    if (missing.length) {
        return `mix_bus.wasm is missing exports: ${missing.join(', ')} (stale build; run pnpm run build:wasm:mixbus)`;
    }
    return null;
}

/**
 * Instantiate public/mix_bus.wasm from its bytes. Throws with a reason the
 * export report can show when the binary is the wrong build.
 */
export async function createNativeMixKernel(bytes: BufferSource): Promise<MixKernel> {
    const module = await WebAssembly.compile(bytes);
    const problem = describeMixBusModuleProblem(module);
    if (problem) throw new Error(problem);

    const instance = await WebAssembly.instantiate(module, {});
    const wasm = instance.exports as unknown as MixBusWasmExports;
    wasm._initialize?.();

    const abi = wasm.mix_bus_abi_version();
    if (abi !== MIX_BUS_ABI_VERSION) {
        throw new Error(`mix_bus.wasm ABI ${abi}, expected ${MIX_BUS_ABI_VERSION}`);
    }

    const block = wasm.mix_bus_block_frames();
    // Memory never grows (fixed by the build), so these views stay valid.
    const inView = new Float32Array(wasm.memory.buffer, wasm.mix_bus_in_ptr(), block);
    const accView = new Float32Array(wasm.memory.buffer, wasm.mix_bus_acc_ptr(), block);

    return {
        kind: 'native',
        accumulate(dst, src, gain) {
            const total = Math.min(dst.length, src.length);
            for (let offset = 0; offset < total; offset += block) {
                const n = Math.min(block, total - offset);
                accView.set(dst.subarray(offset, offset + n));
                inView.set(src.subarray(offset, offset + n));
                wasm.mix_bus_accumulate(n, gain);
                dst.set(accView.subarray(0, n), offset);
            }
        },
        peak(buf) {
            let peak = 0;
            for (let offset = 0; offset < buf.length; offset += block) {
                const n = Math.min(block, buf.length - offset);
                accView.set(buf.subarray(offset, offset + n));
                peak = Math.max(peak, wasm.mix_bus_peak(n));
            }
            return peak;
        },
    };
}
