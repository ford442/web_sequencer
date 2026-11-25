// Which build of emscripten/cpp_osc.cpp the page loads (#1667): the SIMD
// public/cpp_osc.wasm where WASM SIMD validates, its bit-identical scalar twin
// public/cpp_osc_scalar.wasm elsewhere — chosen once, said out loud, and shared
// by the oscillator, the C++ filter and the offline renderer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CPP_OSC_SCALAR_WASM,
    CPP_OSC_WASM,
    cppOscBuildFor,
    loadCppOscModule,
    resetCppOscModuleForTests,
    type CppOscillator,
} from '../CppOscillator';
import { CppWorkletBackend } from '../backends/adapters';
import { CPP_OSC_VARIANT_FILES } from '../../../tools/check_cpp_osc_module.mjs';

/** `\0asm` + version 1: compiles, and is not the 31-byte SIMD probe. */
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const realValidate = WebAssembly.validate.bind(WebAssembly);

/** Make this engine (not) validate SIMD: only the probe is affected. */
function simdHere(supported: boolean) {
    vi.spyOn(WebAssembly, 'validate').mockImplementation((bytes) => {
        const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
        const isProbe = view.byteLength > 8 && view.includes(0x7b);
        return isProbe ? supported : realValidate(bytes);
    });
}

beforeEach(() => {
    resetCppOscModuleForTests();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(EMPTY_WASM.buffer.slice(0)),
    })));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetCppOscModuleForTests();
});

describe('cpp_osc build selection', () => {
    it('names the same two files as the build script and the release gate', () => {
        expect(CPP_OSC_WASM).toBe(CPP_OSC_VARIANT_FILES.simd);
        expect(CPP_OSC_SCALAR_WASM).toBe(CPP_OSC_VARIANT_FILES.scalar);
        expect(cppOscBuildFor(true)).toEqual({ build: 'simd', file: CPP_OSC_WASM });
        expect(cppOscBuildFor(false)).toEqual({ build: 'scalar', file: CPP_OSC_SCALAR_WASM });
    });

    it('loads the SIMD build where WASM SIMD validates, without a word', async () => {
        simdHere(true);
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const loaded = await loadCppOscModule();
        expect(loaded.module).not.toBeNull();
        expect(loaded.build).toBe('simd');
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/\/cpp_osc\.wasm$/);
        expect(info).not.toHaveBeenCalled();
    });

    it('loads the scalar twin where it does not, and says so', async () => {
        simdHere(false);
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const loaded = await loadCppOscModule();
        expect(loaded.module).not.toBeNull();
        expect(loaded.build).toBe('scalar');
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/\/cpp_osc_scalar\.wasm$/);
        expect(info).toHaveBeenCalledWith(expect.stringContaining(`no WASM SIMD here: loading the scalar build ${CPP_OSC_SCALAR_WASM}`));
    });

    it('names the file it tried in a failure', async () => {
        simdHere(false);
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
        const loaded = await loadCppOscModule();
        expect(loaded.module).toBeNull();
        expect(loaded.build).toBe('scalar');
        expect(loaded.unsupported).toBe(false);
        expect(loaded.reason).toContain(`${CPP_OSC_SCALAR_WASM} fetch HTTP 404`);
    });

    it('the backend reports simd as the build its voices run, and what it would load before init', () => {
        const engine = { build: null } as unknown as CppOscillator;
        const backend = new CppWorkletBackend(engine);
        simdHere(true);
        expect(backend.capabilities.simd).toBe(true);
        vi.restoreAllMocks();
        simdHere(false);
        expect(backend.capabilities.simd).toBe(false);
        (engine as { build: string | null }).build = 'simd';
        expect(backend.capabilities.simd).toBe(true);
        (engine as { build: string | null }).build = 'scalar';
        expect(backend.capabilities.simd).toBe(false);
    });
});
