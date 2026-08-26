/**
 * The hyphon_native.wasm memory budget lives in three places that must agree:
 *
 *   1. emscripten/wasm_memory_budget.json  — the source of truth
 *   2. emscripten/build.sh                 — reads (1) for -s INITIAL_MEMORY / MAXIMUM_MEMORY
 *   3. hyphonNativeImports.ts              — allocates the imported WebAssembly.Memory
 *   4. tools/build_jc303_omp.sh + tools/jc303_cmake/CMakeLists.txt — standalone JC-303
 *
 * If (3) drops below (1) the worklet cannot instantiate the module at all; if it
 * sits far above, mobile Safari and low-RAM Chromebooks fail the shared allocation.
 * These tests are the guard rail — see docs/wasm/BUILD_NOTES.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    HYPHON_NATIVE_MIN_MEMORY_PAGES,
    HYPHON_NATIVE_MAX_MEMORY_PAGES,
} from '../audio-worklets/hyphonNativeImports';

const REPO_ROOT = join(__dirname, '../..');
const WASM_PAGE_BYTES = 65536;

const budget = JSON.parse(
    readFileSync(join(REPO_ROOT, 'emscripten/wasm_memory_budget.json'), 'utf8'),
) as {
    pageSizeBytes: number;
    hyphonNative: {
        initialMemoryMb: number;
        maximumMemoryMb: number;
        stackSizeMb: number;
        pthreadPoolSize: number;
    };
    rubberband: {
        initialMemoryMb: number;
        maximumMemoryMb: number;
        stackSizeMb: number;
    };
    assemblyScript: Record<string, number | string[]>;
    standaloneJc303: {
        initialMemoryMb: number;
        maximumMemoryMb: number;
        stackSizeMbRelease: number;
        stackSizeMbDebug: number;
        pthreadPoolSize: number;
    };
};

const buildSh = readFileSync(join(REPO_ROOT, 'emscripten/build.sh'), 'utf8');
const rubberbandSh = readFileSync(join(REPO_ROOT, 'emscripten/build_rubberband.sh'), 'utf8');
const jc303BuildSh = readFileSync(join(REPO_ROOT, 'tools/build_jc303_omp.sh'), 'utf8');
const jc303Cmake = readFileSync(join(REPO_ROOT, 'tools/jc303_cmake/CMakeLists.txt'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
};

describe('hyphon_native memory budget', () => {
    it('page size in the budget matches the WebAssembly page size', () => {
        expect(budget.pageSizeBytes).toBe(WASM_PAGE_BYTES);
    });

    it('worklet initial memory matches the budget', () => {
        const expectedPages = (budget.hyphonNative.initialMemoryMb * 1024 * 1024) / WASM_PAGE_BYTES;
        expect(HYPHON_NATIVE_MIN_MEMORY_PAGES).toBe(expectedPages);
    });

    it('worklet maximum memory matches the budget', () => {
        const expectedPages = (budget.hyphonNative.maximumMemoryMb * 1024 * 1024) / WASM_PAGE_BYTES;
        expect(HYPHON_NATIVE_MAX_MEMORY_PAGES).toBe(expectedPages);
    });

    it('initial memory stays under the maximum', () => {
        expect(budget.hyphonNative.initialMemoryMb).toBeLessThan(budget.hyphonNative.maximumMemoryMb);
    });

    it('keeps the mobile-friendly ceiling on the initial reservation', () => {
        // A regression above 256 MB reintroduces the SharedArrayBuffer allocation
        // failures this budget exists to fix. Raise deliberately, with a measurement.
        expect(budget.hyphonNative.initialMemoryMb).toBeLessThanOrEqual(256);
    });

    it('build.sh derives its link flags from the budget file rather than literals', () => {
        expect(buildSh).toContain('wasm_memory_budget.json');
        expect(buildSh).toContain('-s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb');
        expect(buildSh).toContain('-s MAXIMUM_MEMORY=${MAXIMUM_MEMORY_MB}mb');
        // No hardcoded INITIAL_MEMORY left behind.
        expect(buildSh).not.toMatch(/INITIAL_MEMORY=\d+mb/);
    });

    it('build.sh supports debug and release profiles', () => {
        expect(buildSh).toContain('HYPHON_BUILD_PROFILE');
        expect(buildSh).toContain('-s ASSERTIONS=2');
        expect(buildSh).toContain('-s ASSERTIONS=0');
    });

    it('AssemblyScript --initialMemory values match the budget', () => {
        const expected: Record<string, number> = {
            'build:wasm:oscillators': budget.assemblyScript.oscillatorsPages as number,
            'build:wasm:fft': budget.assemblyScript.fftPages as number,
            'build:wasm:freezer': budget.assemblyScript.freezerPages as number,
            'build:wasm:audioexport': budget.assemblyScript.audioExportPages as number,
            'build:wasm:xmexport': budget.assemblyScript.xmExportPages as number,
        };

        for (const [script, pages] of Object.entries(expected)) {
            const cmd = packageJson.scripts[script];
            expect(cmd, `${script} missing from package.json`).toBeTruthy();
            const match = /--initialMemory (\d+)/.exec(cmd);
            expect(match, `${script} has no --initialMemory`).toBeTruthy();
            expect(Number(match![1]), `${script} --initialMemory`).toBe(pages);
        }
    });
});

describe('standalone JC-303 memory budget', () => {
    it('declares the shipped 16 / 256 / 4/2 contract', () => {
        expect(budget.standaloneJc303.initialMemoryMb).toBe(16);
        expect(budget.standaloneJc303.maximumMemoryMb).toBe(256);
        expect(budget.standaloneJc303.stackSizeMbRelease).toBe(4);
        expect(budget.standaloneJc303.stackSizeMbDebug).toBe(2);
        expect(budget.standaloneJc303.pthreadPoolSize).toBe(4);
    });

    it('build script reads the budget JSON and passes -DJC303_*', () => {
        expect(jc303BuildSh).toContain('wasm_memory_budget.json');
        expect(jc303BuildSh).toContain('standaloneJc303.initialMemoryMb');
        expect(jc303BuildSh).toContain('-DJC303_INITIAL_MEMORY=');
        expect(jc303BuildSh).toContain('-DJC303_MAXIMUM_MEMORY=');
        expect(jc303BuildSh).toContain('-DJC303_STACK_SIZE=');
        expect(jc303BuildSh).toContain('tools/jc303_cmake');
        expect(jc303BuildSh).not.toMatch(/Stack size: 32MB/);
        expect(jc303BuildSh).not.toMatch(/src\/wasm\/jc303-single\.wasm/);
    });

    it('Hyphon CMake overlay uses cache vars and has no memory byte literals', () => {
        expect(jc303Cmake).toContain('${JC303_INITIAL_MEMORY}');
        expect(jc303Cmake).toContain('${JC303_MAXIMUM_MEMORY}');
        expect(jc303Cmake).toContain('${JC303_STACK_SIZE}');
        expect(jc303Cmake).not.toMatch(/INITIAL_MEMORY=\d+/);
        expect(jc303Cmake).not.toMatch(/STACK_SIZE=\d+/);
        expect(jc303Cmake).not.toMatch(/16777216|4194304|2097152|67108864|33554432/);
    });
});

describe('Rubber Band module split', () => {
    // Rubber Band's finer-engine stereo stretch was the dominant transient in the
    // hyphon_native budget (~40 MB of a ~114 MB peak) while sharing a heap with the
    // live 303 voices — and nothing ever called it there: the worklets have always
    // gone through createRubberBandModule() against the standalone artifact.
    it('is not compiled into hyphon_native', () => {
        expect(buildSh).not.toMatch(/rubberband_wrapper\.cpp/);
        expect(buildSh).not.toMatch(/RUBBERBAND_SRC/);
        expect(buildSh).not.toMatch(/RubberBandStretcher\.cpp/);
        // Rubber Band was the only consumer of these in this module.
        expect(buildSh).not.toMatch(/-DUSE_KISSFFT/);
        expect(buildSh).not.toMatch(/-DUSE_SPEEX/);
    });

    it('has its own budget entry and build script that reads it', () => {
        expect(budget.rubberband.initialMemoryMb).toBeGreaterThan(0);
        expect(budget.rubberband.initialMemoryMb).toBeLessThan(budget.rubberband.maximumMemoryMb);
        expect(rubberbandSh).toContain('wasm_memory_budget.json');
        expect(rubberbandSh).toContain('rubberband.initialMemoryMb');
        expect(rubberbandSh).toContain('-s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb');
        expect(rubberbandSh).toContain('-s MAXIMUM_MEMORY=${MAXIMUM_MEMORY_MB}mb');
        expect(rubberbandSh).toContain('-s STACK_SIZE=${STACK_SIZE_MB}mb');
        expect(rubberbandSh).not.toMatch(/INITIAL_MEMORY=\d+/);
    });

    it('is a registered build world with a package script', () => {
        expect(packageJson.scripts['build:wasm:rubberband']).toContain('build_rubberband.sh');
    });

    it('patches a copy of the submodule, never the checkout', () => {
        // The two sed fixes are not idempotent against an already-patched tree.
        expect(rubberbandSh).toContain('temp_build_rubberband');
        expect(rubberbandSh).not.toMatch(/sed -i [^\n]*\$SOURCE_DIR/);
    });
});
