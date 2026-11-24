/**
 * The hyphon_native.wasm memory budget lives in three places that must agree:
 *
 *   1. emscripten/wasm_memory_budget.json  — the source of truth
 *   2. emscripten/build.sh                 — reads (1) for -s INITIAL_MEMORY / MAXIMUM_MEMORY
 *   3. hyphonNativeImports.ts              — allocates the imported WebAssembly.Memory
 *
 * If (3) drops below (1) the worklet cannot instantiate the module at all; if it
 * sits far above, mobile Safari and low-RAM Chromebooks fail the shared allocation.
 * These tests are the guard rail — see docs/wasm/BUILD_NOTES.md.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    HYPHON_NATIVE_ARTIFACTS,
    HYPHON_NATIVE_MIN_MEMORY_PAGES,
    HYPHON_NATIVE_MAX_MEMORY_PAGES,
    HYPHON_NATIVE_ST_MIN_MEMORY_PAGES,
    HYPHON_NATIVE_ST_MAX_MEMORY_PAGES,
} from '../audio-worklets/hyphonNativeImports';

const REPO_ROOT = join(__dirname, '../..');
const WASM_PAGE_BYTES = 65536;

const budget = JSON.parse(
    readFileSync(join(REPO_ROOT, 'emscripten/wasm_memory_budget.json'), 'utf8'),
) as {
    pageSizeBytes: number;
    hyphonNative: {
        initialMemoryMb: number;
        maximumMemoryMb?: number;
        stackSizeMb: number;
        pthreadPoolSize: number;
    };
    hyphonNativeSt: {
        initialMemoryMb: number;
        maximumMemoryMb?: number;
        stackSizeMb: number;
    };
    rubberband: {
        initialMemoryMb: number;
        maximumMemoryMb?: number;
        stackSizeMb: number;
    };
    mixBus: {
        initialMemoryMb: number;
        stackSizeMb: number;
    };
    assemblyScript: Record<string, number | string[]>;
};

const buildSh = readFileSync(join(REPO_ROOT, 'emscripten/build.sh'), 'utf8');
const rubberbandSh = readFileSync(join(REPO_ROOT, 'emscripten/build_rubberband.sh'), 'utf8');
const mixBusSh = readFileSync(join(REPO_ROOT, 'emscripten/build_mix_bus.sh'), 'utf8');
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

    it('is fixed-size: no maximum in the budget, and the worklet maximum is the initial size', () => {
        // ALLOW_MEMORY_GROWTH=0 (BUILD_NOTES#fixed-voice-memory): the module declares
        // maximum == initial, so a larger imported maximum is a LinkError.
        expect(budget.hyphonNative).not.toHaveProperty('maximumMemoryMb');
        expect(HYPHON_NATIVE_MAX_MEMORY_PAGES).toBe(HYPHON_NATIVE_MIN_MEMORY_PAGES);
    });

    it('has no pthread pool: nothing in the voice module creates a thread', () => {
        expect(budget.hyphonNative.pthreadPoolSize).toBe(0);
        expect(buildSh).toContain('-s PTHREAD_POOL_SIZE=$PTHREAD_POOL_SIZE');
    });

    it('sizes the stack from the measured high-water mark, not the old 8 MB', () => {
        // tools/render_hyphon_native_parity.mjs stack (debug build): < 1 KB used.
        for (const key of ['hyphonNative', 'hyphonNativeSt'] as const) {
            expect(budget[key].stackSizeMb, key).toBeLessThanOrEqual(0.25);
            expect(budget[key].stackSizeMb * 1048576 % 16, `${key} stack must be 16-byte aligned`).toBe(0);
        }
    });

    it('keeps the mobile-friendly ceiling on the initial reservation', () => {
        // A regression above 256 MB reintroduces the SharedArrayBuffer allocation
        // failures this budget exists to fix. Raise deliberately, with a measurement.
        expect(budget.hyphonNative.initialMemoryMb).toBeLessThanOrEqual(256);
    });

    it('build.sh derives its link flags from the budget file rather than literals', () => {
        expect(buildSh).toContain('wasm_memory_budget.json');
        expect(buildSh).toContain('-s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb');
        expect(buildSh).toContain('-s STACK_SIZE=${STACK_SIZE_BYTES}');
        // Fixed memory: no MAXIMUM_MEMORY, and no hardcoded INITIAL_MEMORY left behind.
        expect(buildSh).not.toContain('MAXIMUM_MEMORY');
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
            'build:wasm:wamfilter': budget.assemblyScript.wamFilterPages as number,
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

describe('the WASM OSC filter module (#1663)', () => {
    const cmd = packageJson.scripts['build:wasm:wamfilter'];

    it('is fixed memory: maximum = initial = the budget, so a worklet instance can never grow', () => {
        expect(Number(/--maximumMemory (\d+)/.exec(cmd)?.[1])).toBe(budget.assemblyScript.wamFilterPages);
        expect(Number(/--initialMemory (\d+)/.exec(cmd)?.[1])).toBe(budget.assemblyScript.wamFilterPages);
    });

    it('has no heap runtime and no abort import (worklet-loaded wasm may not throw)', () => {
        expect(cmd).toContain('--runtime stub');
        expect(cmd).toContain('--use abort=');
    });
});

describe('hyphon_native single-threaded (st) memory budget', () => {
    const mbToPages = (mb: number) => (mb * 1024 * 1024) / WASM_PAGE_BYTES;

    it('worklet ST page constants match the budget (fixed size)', () => {
        expect(HYPHON_NATIVE_ST_MIN_MEMORY_PAGES).toBe(mbToPages(budget.hyphonNativeSt.initialMemoryMb));
        expect(budget.hyphonNativeSt).not.toHaveProperty('maximumMemoryMb');
        expect(HYPHON_NATIVE_ST_MAX_MEMORY_PAGES).toBe(HYPHON_NATIVE_ST_MIN_MEMORY_PAGES);
    });

    it('artifact table routes each profile to its own budget', () => {
        expect(HYPHON_NATIVE_ARTIFACTS.pthread).toMatchObject({
            wasm: 'hyphon_native.wasm',
            sharedMemory: true,
            minMemoryPages: HYPHON_NATIVE_MIN_MEMORY_PAGES,
        });
        expect(HYPHON_NATIVE_ARTIFACTS.st).toMatchObject({
            wasm: 'hyphon_native.st.wasm',
            exportMap: 'hyphon_wasm_export_map.st.json',
            sharedMemory: false,
            minMemoryPages: HYPHON_NATIVE_ST_MIN_MEMORY_PAGES,
        });
    });

    it('is smaller than the pthread reservation', () => {
        expect(budget.hyphonNativeSt.initialMemoryMb).toBeLessThan(budget.hyphonNative.initialMemoryMb);
    });

    it('build.sh links the ST profile from the budget, without pthreads', () => {
        expect(buildSh).toContain('hyphonNativeSt.initialMemoryMb');
        expect(buildSh).toContain('-s INITIAL_MEMORY=${ST_INITIAL_MEMORY_MB}mb');
        expect(buildSh).toContain('-s STACK_SIZE=${ST_STACK_SIZE_BYTES}');
        const stLink = /ST_LINK_FLAGS="([^"]*)"/.exec(buildSh)?.[1] ?? '';
        expect(stLink).toContain('-s IMPORTED_MEMORY=1');
        expect(stLink).not.toMatch(/-pthread\b|USE_PTHREADS|PTHREAD_POOL_SIZE|pyodide_bootstrap/);
        expect(buildSh).toContain('hyphon_native.st.js');
        expect(buildSh).toContain('hyphon_wasm_export_map.st.json');
    });
});

describe('hyphon_native drumkit compilation', () => {
    it('compiles analog drums into hyphon_native (same module, new handles)', () => {
        expect(buildSh).toContain('drumkit_wrapper.cpp');
        expect(buildSh).toContain('prophecy_wrapper.cpp');
        // build.sh exports what the manifest declares (#1344).
        const manifest = JSON.parse(
            readFileSync(join(REPO_ROOT, 'emscripten/wasm_export_manifest.json'), 'utf8'),
        ) as { required: string[] };
        expect(manifest.required).toEqual(
            expect.arrayContaining(['drumkit_create', 'drumkit_push_event', 'drumkit_render']),
        );
    });
});

describe('Rubber Band module split', () => {
    // Rubber Band's finer-engine stereo stretch was the dominant transient in the
    // hyphon_native budget (~40 MB of a ~114 MB peak) while sharing a heap with the
    // live 303 voices — and nothing ever called it there: the worklets have always
    // instantiated the standalone artifact (now by hand: rubberband/instantiate.ts).
    it('is not compiled into hyphon_native', () => {
        expect(buildSh).not.toMatch(/rubberband_wrapper\.cpp/);
        expect(buildSh).not.toMatch(/RUBBERBAND_SRC/);
        expect(buildSh).not.toMatch(/RubberBandStretcher\.cpp/);
        // Rubber Band was the only consumer of these in this module.
        expect(buildSh).not.toMatch(/-DUSE_KISSFFT/);
        expect(buildSh).not.toMatch(/-DUSE_SPEEX/);
    });

    it('has its own fixed budget entry and a build script that reads it', () => {
        expect(budget.rubberband.initialMemoryMb).toBeGreaterThan(0);
        // Fixed (ALLOW_MEMORY_GROWTH=0, BUILD_NOTES#rubberband-fixed-memory).
        expect(budget.rubberband).not.toHaveProperty('maximumMemoryMb');
        expect(rubberbandSh).toContain('wasm_memory_budget.json');
        expect(rubberbandSh).toContain('rubberband.initialMemoryMb');
        expect(rubberbandSh).toContain('-s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb');
        expect(rubberbandSh).not.toContain('MAXIMUM_MEMORY');
        expect(rubberbandSh).toContain('-s STACK_SIZE=${STACK_SIZE_MB}mb');
        expect(rubberbandSh).not.toMatch(/INITIAL_MEMORY=\d+/);
        // The linked module is checked against the same number.
        expect(rubberbandSh).toContain('check_rubberband_module.mjs" "$REPO_ROOT/public/rubberband.wasm" "$INITIAL_MEMORY_MB"');
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

describe('offline mix bus memory (#1341)', () => {
    it('build_mix_bus.sh reads the mixBus budget instead of literals', () => {
        expect(mixBusSh).toContain('wasm_memory_budget.json');
        expect(mixBusSh).toContain('mixBus.initialMemoryMb');
        expect(mixBusSh).toContain('mixBus.stackSizeMb');
        expect(mixBusSh).toContain('-s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb');
        expect(mixBusSh).toContain('-s STACK_SIZE=${STACK_SIZE_MB}mb');
        expect(mixBusSh).not.toMatch(/INITIAL_MEMORY=\d+/);
    });

    it('cannot grow, share, or thread — an offline mix never touches a SAB', () => {
        expect(mixBusSh).toContain('-s ALLOW_MEMORY_GROWTH=0');
        expect(mixBusSh).not.toMatch(/ALLOW_MEMORY_GROWTH=1/);
        const flags = mixBusSh.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
        expect(flags).not.toMatch(/-pthread|USE_PTHREADS|SHARED_MEMORY|-fopenmp|libomp/);
        expect(mixBusSh).toContain('-s STANDALONE_WASM=1');
    });

    it('fits the two scratch blocks and the stack in the fixed heap', () => {
        const scratchMb = (2 * 65536 * 4) / (1024 * 1024);
        expect(budget.mixBus.stackSizeMb + scratchMb).toBeLessThan(budget.mixBus.initialMemoryMb);
        expect(budget.mixBus).not.toHaveProperty('maximumMemoryMb');
    });

    it('is not linked into either voice profile', () => {
        expect(buildSh).not.toMatch(/(?:mix_bus|audio_dsp)\.cpp"/);
        expect(buildSh).not.toMatch(/^[^#]*libomp\.a/m);
        expect(existsSync(join(REPO_ROOT, 'emscripten/audio_dsp.cpp'))).toBe(false);
    });
});
