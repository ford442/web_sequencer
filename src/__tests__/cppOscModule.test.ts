/**
 * Contract for public/cpp_osc.wasm (#1665), hermetic: the places that name the
 * export surface, the ABI version, the shape ids and the fixed memory size are
 * held in step, and the release checker rejects the modules it exists to reject.
 *
 * The real binary is exercised by
 * src/audio-worklets/__tests__/cppOscVoice.realWasm.test.ts (integration tier).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    CPP_OSC_ABI_VERSION as CHECKER_ABI,
    CPP_OSC_BUDGET,
    CPP_OSC_REQUIRED_EXPORTS as CHECKER_EXPORTS,
    checkCppOscModule,
    usesV128,
} from '../../tools/check_cpp_osc_module.mjs';
import { exportedFunctions } from '../../tools/hyphon_native_exports.mjs';
import { CPP_OSC_EXPORTS } from '../shared/rt/cppOscExports';
import { CPP_OSC_ABI_VERSION, CPP_OSC_SHAPE_ID, hasCppOscApi } from '../audio-worklets/cppOsc';
import { RUST_OSC_SHAPE_ID } from '../audio-worklets/rustOsc';
import {
    CPP_FILTER_ABI_VERSION,
    CPP_FILTER_REQUIRED_EXPORTS,
    CPP_FILTER_TYPE_ID,
    hasCppFilterApi,
    instantiateCppFilter,
} from '../audio-worklets/cppFilter';
import { RUST_FILTER_TYPE_ID } from '../audio-worklets/rustFilter';
import { cppOscWasmFixture } from '../test/helpers/cppOscWasmFixture';

const REPO_ROOT = join(__dirname, '../..');
const source = readFileSync(join(REPO_ROOT, 'emscripten/cpp_osc.cpp'), 'utf8');
const buildScript = readFileSync(join(REPO_ROOT, 'emscripten/build_cpp_osc.sh'), 'utf8');
const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'emscripten/wasm_export_manifest.json'), 'utf8')) as {
    cppOsc: { required: string[]; runtime: string[] };
};

describe('cpp_osc export surface', () => {
    it('manifest, release checker, generated types and worklet name the same exports', () => {
        expect(CHECKER_EXPORTS).toEqual(manifest.cppOsc.required);
        expect([...CPP_OSC_EXPORTS]).toEqual(manifest.cppOsc.required);
    });

    it('the build exports exactly the manifest section', () => {
        expect(buildScript).toContain('tools/hyphon_native_exports.mjs" --module cppOsc');
        expect(exportedFunctions(manifest, 'release', 'cppOsc')).toEqual(manifest.cppOsc.required.map((n) => `_${n}`));
    });

    it('every export is an EMSCRIPTEN_KEEPALIVE function in cpp_osc.cpp, and nothing else is', () => {
        const defined = [...source.matchAll(/EMSCRIPTEN_KEEPALIVE\s+[\w\s*]+?\b(c(?:osc|flt)_\w+)\s*\(/g)].map((m) => m[1]);
        expect(defined.sort()).toEqual([...manifest.cppOsc.required].sort());
    });

    it('the ABI version agrees in cpp_osc.cpp, the checker and the worklet', () => {
        expect(source).toContain(`constexpr int kAbiVersion = ${CPP_OSC_ABI_VERSION};`);
        expect(CHECKER_ABI).toBe(CPP_OSC_ABI_VERSION);
    });

    it('shape ids agree with the kernel, and with the other kernels', () => {
        const name = { saw: 'Saw', sqr: 'Sqr', tri: 'Tri', sin: 'Sin' } as const;
        for (const [shape, id] of Object.entries(CPP_OSC_SHAPE_ID)) {
            expect(source, shape).toContain(`constexpr int kShape${name[shape as keyof typeof name]} = ${id};`);
        }
        expect(CPP_OSC_SHAPE_ID).toEqual(RUST_OSC_SHAPE_ID);
    });
});

describe('the C++ filter half of cpp_osc (#1673)', () => {
    it('lives in the same module: its exports are the cflt_* names of the cppOsc section', () => {
        expect([...CPP_FILTER_REQUIRED_EXPORTS]).toEqual(['cflt_buf_ptr', 'cflt_configure', 'cflt_reset', 'cflt_process']);
        expect([...CPP_FILTER_REQUIRED_EXPORTS]).toEqual(manifest.cppOsc.required.filter((n) => n.startsWith('cflt_')));
        // One artifact, one ABI: the oscillator and the filter bind the same version.
        expect(CPP_FILTER_ABI_VERSION).toBe(CPP_OSC_ABI_VERSION);
    });

    it('uses the filter type ids of every other kernel', () => {
        const name = { lp: 'Lp', bp: 'Bp', hp: 'Hp' } as const;
        for (const [type, id] of Object.entries(CPP_FILTER_TYPE_ID)) {
            expect(source, type).toContain(`constexpr int kFilter${name[type as keyof typeof name]} = ${id};`);
        }
        expect(CPP_FILTER_TYPE_ID).toEqual(RUST_FILTER_TYPE_ID);
    });

    it('the filter worklet accepts the fixture, and refuses one without the filter or with another ABI', () => {
        const ok = new WebAssembly.Instance(new WebAssembly.Module(cppOscWasmFixture('valid')), {});
        expect(hasCppFilterApi(ok.exports)).toBe(true);
        expect(instantiateCppFilter(new WebAssembly.Module(cppOscWasmFixture('valid'))).cflt_buf_ptr()).toBe(64);
        const broken = new WebAssembly.Instance(new WebAssembly.Module(cppOscWasmFixture('missing-filter')), {});
        expect(hasCppFilterApi(broken.exports)).toBe(false);
        expect(() => instantiateCppFilter(new WebAssembly.Module(cppOscWasmFixture('missing-filter')))).toThrow(/cflt_\* exports/);
        expect(() => instantiateCppFilter(new WebAssembly.Module(cppOscWasmFixture('wrong-abi')))).toThrow(/ABI 1, worklet expects 2/);
    });
});

describe('cpp_osc fixed memory and scalar build (BUILD_NOTES#cpp-osc)', () => {
    it('the build reads the budget, fixes the memory and never asks for SIMD', () => {
        expect(buildScript).toContain("require('$BUDGET_JSON').cppOsc.initialMemoryPages");
        expect(buildScript).toContain("require('$BUDGET_JSON').cppOsc.stackSizeBytes");
        expect(buildScript).toContain('-s ALLOW_MEMORY_GROWTH=0');
        expect(buildScript).toContain('-s STANDALONE_WASM=1');
        expect(buildScript).toContain('-fno-exceptions');
        // Comments may mention the flag; the em++ invocation must not pass it.
        const invocation = buildScript.slice(buildScript.indexOf('em++ "$SCRIPT_DIR/cpp_osc.cpp"'));
        expect(invocation).not.toMatch(/-msimd128/);
    });

    it('keeps the budget page-sized and the static data inside it', () => {
        expect(Number.isInteger(CPP_OSC_BUDGET.initialMemoryPages)).toBe(true);
        expect(CPP_OSC_BUDGET.initialMemoryPages).toBeGreaterThan(0);
        // freq + out + the C++ filter's buffer (3 x 1024 floats) + 2 residual tables (32 x 129 floats) + stack.
        const statics = 3 * 1024 * 4 + 2 * 32 * 129 * 4;
        expect(statics + CPP_OSC_BUDGET.stackSizeBytes).toBeLessThan(CPP_OSC_BUDGET.initialMemoryPages * 65536);
    });
});

describe('tools/check_cpp_osc_module.mjs', () => {
    it('accepts the valid fixture', () => {
        expect(checkCppOscModule(cppOscWasmFixture('valid'))).toEqual([]);
    });

    it.each([
        ['growable-memory', 'memory can grow'],
        ['simd', 'module uses v128'],
        ['wrong-abi', 'ABI version 1'],
        ['missing-filter', 'missing exports: cflt_process'],
        ['missing-render', 'missing exports: cosc_render'],
    ] as const)('rejects %s', (variant, message) => {
        expect(checkCppOscModule(cppOscWasmFixture(variant)).join('\n')).toContain(message);
    });

    it('detects v128 only where it is', () => {
        expect(usesV128(cppOscWasmFixture('valid'))).toBe(false);
        expect(usesV128(cppOscWasmFixture('simd'))).toBe(true);
    });

    it('the worklet accepts the export surface the checker accepts', () => {
        const instance = new WebAssembly.Instance(new WebAssembly.Module(cppOscWasmFixture('valid')), {});
        expect(hasCppOscApi(instance.exports)).toBe(true);
        const broken = new WebAssembly.Instance(new WebAssembly.Module(cppOscWasmFixture('missing-render')), {});
        expect(hasCppOscApi(broken.exports)).toBe(false);
    });
});
