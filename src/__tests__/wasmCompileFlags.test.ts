/**
 * Compile-time contracts that no runtime test can catch, because the artifacts
 * they describe are gitignored and often absent in CI:
 *
 *   1. -ffast-math stays out of the voice module; only the offline mix bus has it.
 *   2. The AssemblyScript modules stay inside the Safari feature intersection.
 *   3. One Emscripten pin, enforced by every em++ script and read by every CI job;
 *      the voice module links at -O3 + LTO with no embind / main() / OpenMP.
 *   4. index.html boots with no remote script and no `unsafe-eval`.
 *
 * See docs/wasm/BUILD_NOTES.md.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/**
 * Strip full-line `#` comments. These files document the very flags they must not
 * pass, so a naive substring assertion would fire on the explanation rather than
 * on a real regression.
 */
const withoutShellComments = (src: string) =>
    src.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

/** Same idea for the inline module scripts in index.html. */
const withoutJsLineComments = (src: string) =>
    src.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');

const buildSh = read('emscripten/build.sh');
const rubberbandSh = read('emscripten/build_rubberband.sh');
const mixBusSh = read('emscripten/build_mix_bus.sh');
const jc303Sh = read('tools/build_jc303_omp.sh');
const toolchainEnvSh = read('emscripten/toolchain_env.sh');
const indexHtml = read('index.html');
const bootstrapTs = read('src/pyodide/bootstrap.ts');
const toolchain = JSON.parse(read('emscripten/toolchain.json')) as {
    emscripten: { version: string };
    pyodide: { version: string; publicPath: string; files: string[]; packages: string[] };
};
const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

describe('-ffast-math audit', () => {
    // -ffast-math implies -ffinite-math-only / -fno-signed-zeros. Applied to the
    // recursive TB-303 and diode-ladder filter sections it lets a NaN latch instead
    // of settling, and reassociated accumulation drifts the committed 303
    // spectrogram baselines.
    const voiceSources = [
        'open303_wrapper.cpp',
        'jc303_wrapper.cpp',
        'highfid303_wrapper.cpp',
        'prophecy_wrapper.cpp',
        'drumkit_wrapper.cpp',
    ];

    it('is not a global compile flag', () => {
        expect(buildSh).not.toMatch(/OPT_FLAGS="[^"]*-ffast-math/);
        expect(buildSh).not.toMatch(/CXXFLAGS="[^"]*-ffast-math/);
    });

    it('is not passed anywhere in the voice module (#1341)', () => {
        // audio_dsp.cpp was its only fast-math TU; it left for build_mix_bus.sh.
        expect(withoutShellComments(buildSh)).not.toContain('-ffast-math');
        expect(buildSh).not.toContain('compile_cpp_fast');
    });

    it('compiles every voice wrapper IEEE-safe', () => {
        for (const src of voiceSources) {
            expect(buildSh, `${src} must use compile_cpp`).toContain(`compile_cpp "$SCRIPT_DIR/${src}"`);
            expect(buildSh, `${src} must not use compile_cpp_fast`)
                .not.toContain(`compile_cpp_fast "$SCRIPT_DIR/${src}"`);
        }
        // The rosic Open303 DSP is compiled by loop, also via compile_cpp.
        expect(buildSh).toMatch(/for f in \$REPO_ROOT\/jc303_wasm\/src\/dsp\/open303\/\*\.cpp; do\s*\n\s*compile_cpp "\$f"/);
    });

    it('is scoped to the release mix bus — one TU, no recursive state (#1341)', () => {
        const fastLines = withoutShellComments(mixBusSh)
            .split('\n')
            .filter((line) => line.includes('-ffast-math'));
        expect(fastLines).toHaveLength(1);
        expect(fastLines[0]).toMatch(/^\s*OPT_FLAGS="-O3 -ffast-math"$/);
        // One source file, and the debug profile stays IEEE.
        expect(mixBusSh.match(/em\+\+ "\$SCRIPT_DIR\/[^"]+"/g)).toEqual(['em++ "$SCRIPT_DIR/mix_bus.cpp"']);
        expect(mixBusSh).toMatch(/OPT_FLAGS="-O1 -g3"/);
    });

    it('does not reintroduce fast-math in the Rubber Band module', () => {
        // Phase-vocoder accumulators and the resampler are the same class of code.
        expect(withoutShellComments(rubberbandSh)).not.toContain('-ffast-math');
    });
});

describe('AssemblyScript browser matrix', () => {
    const asScripts = [
        'build:wasm:oscillators',
        'build:wasm:freezer',
        'build:wasm:fft',
        'build:wasm:audioexport',
        'build:wasm:xmexport',
    ];

    it('ships no WasmGC module', () => {
        // WasmGC trails every other feature in Safari, and nothing in assembly/ needs
        // GC semantics — these are numeric kernels over linear memory. An unsupported
        // target is a CompileError for the whole module, not a degraded feature.
        for (const name of asScripts) {
            const cmd = packageJson.scripts[name];
            expect(cmd, `${name} missing`).toBeTruthy();
            expect(cmd, `${name} must not target wasm-gc`).not.toContain('--target wasm-gc');
            expect(cmd, `${name} must not enable gc`).not.toMatch(/--enable gc\b/);
        }
    });

    it('keeps every module inside the Safari intersection', () => {
        for (const name of asScripts) {
            const cmd = packageJson.scripts[name];
            expect(cmd).toContain('--enable simd');
            expect(cmd).toContain('--enable bulk-memory');
            // Relaxed SIMD is the second-narrowest feature after WasmGC, and
            // assembly/ contains no SIMD intrinsics for it to apply to — enabling it
            // produced a byte-identical module. See BUILD_NOTES#assemblyscript-browser-matrix.
            expect(cmd, `${name} must not enable relaxed-simd`).not.toContain('--enable relaxed-simd');
        }
    });

    it('keeps threads on the oscillators module only', () => {
        expect(packageJson.scripts['build:wasm:oscillators']).toContain('--enable threads');
        for (const name of asScripts.filter((n) => n !== 'build:wasm:oscillators')) {
            expect(packageJson.scripts[name], name).not.toContain('--enable threads');
        }
    });

    it('keeps the capability probe available for a future relaxed kernel', () => {
        // The probe is what makes adding a relaxed sibling a load-time decision
        // instead of a hard CompileError; it must not be deleted as "unused".
        const loader = read('src/engines/WasmOscillator.ts');
        expect(loader).toContain('supportsRelaxedSimd');
        expect(loader).toContain('relaxed_swizzle');
    });
});

describe('Emscripten pin (#toolchain-pin)', () => {
    const emccScripts = {
        'emscripten/build.sh': buildSh,
        'emscripten/build_rubberband.sh': rubberbandSh,
        'emscripten/build_mix_bus.sh': mixBusSh,
        'tools/build_jc303_omp.sh': jc303Sh,
    };
    const workflowsWithEmsdk = readdirSync(join(REPO_ROOT, '.github/workflows'))
        .filter((f) => f.endsWith('.yml'))
        .map((f) => [f, read(`.github/workflows/${f}`)] as const)
        .filter(([, yml]) => yml.includes('setup-emsdk'));

    it('is a 6.x release, recorded once', () => {
        expect(toolchain.emscripten.version).toMatch(/^6\.\d+\.\d+$/);
    });

    it('every em++ build script sources the version check instead of a bare emsdk_env.sh', () => {
        for (const [name, src] of Object.entries(emccScripts)) {
            expect(src, name).toMatch(/source "\$(?:SCRIPT_DIR|REPO_ROOT\/emscripten)\/toolchain_env\.sh"/);
            expect(withoutShellComments(src), name).not.toContain('emsdk_env.sh');
        }
    });

    it('toolchain_env.sh fails on any emcc other than the pin', () => {
        expect(toolchainEnvSh).toContain("require('$_HYPHON_TOOLCHAIN_DIR/toolchain.json').emscripten.version");
        expect(toolchainEnvSh).toContain('emcc -dumpversion');
        expect(toolchainEnvSh).toMatch(/exit 1/);
    });

    it('every CI job that installs emsdk reads the pin from toolchain.json', () => {
        expect(workflowsWithEmsdk.length).toBeGreaterThan(0);
        for (const [file, yml] of workflowsWithEmsdk) {
            expect(yml, file).toContain('emscripten/toolchain.json');
            expect(yml, file).not.toMatch(/version:\s*['"]?\d+\.\d+\.\d+/);
            expect(yml, file).not.toMatch(/emcc\d+\.\d+\.\d+/);
        }
    });
});

describe('voice module link (hyphon_native)', () => {
    const code = withoutShellComments(buildSh);

    it('links release at -O3 with LTO, in-band (no out-of-band optimizer)', () => {
        expect(buildSh).toContain('OPT_FLAGS="-O3 -funroll-loops -flto"');
        expect(buildSh).toContain('LINK_PROFILE_FLAGS="-O3 -flto -s ASSERTIONS=0"');
        expect(existsSync(join(REPO_ROOT, 'tools/optimize.sh'))).toBe(false);
        expect(packageJson.scripts.optimize).toBeUndefined();
    });

    it('keeps wasm import/export names unminified for the hand-instantiating worklets', () => {
        expect(code).toMatch(/BASE_LINK_FLAGS="[^"]*-lexports\.js/);
    });

    it('uses the -pthread spelling, no legacy USE_PTHREADS / WASM_BIGINT settings', () => {
        expect(code).not.toContain('USE_PTHREADS');
        expect(code).not.toContain('WASM_BIGINT');
        expect(code).toMatch(/PTHREAD_LINK_FLAGS="[^"]*-pthread/);
    });

    it('has no embind, RTTI, exceptions, main() or OpenMP', () => {
        expect(code).not.toContain('--bind');
        expect(code).not.toContain('-frtti');
        expect(code).toContain('-fno-exceptions');
        expect(code).not.toMatch(/main\.cpp|pyodide_bootstrap|--post-js|libomp|-fopenmp/);
        for (const f of ['main.cpp', 'pyodide_bootstrap.js', 'libomp.a', 'omp.h', 'openmp_patches.sh']) {
            expect(existsSync(join(REPO_ROOT, 'emscripten', f)), f).toBe(false);
        }
        for (const w of ['open303', 'jc303', 'highfid303', 'prophecy', 'drumkit']) {
            const src = read(`emscripten/${w}_wrapper.cpp`);
            expect(src, w).not.toContain('EMSCRIPTEN_BINDINGS');
            expect(src, w).not.toContain('emscripten/bind.h');
        }
    });

    it('builds both threading profiles --no-entry, differing only in threads and memory', () => {
        const link = /BASE_LINK_FLAGS="([^"]*)"/.exec(buildSh)?.[1] ?? '';
        expect(link).toContain('--no-entry');
        expect(buildSh).toContain('PTHREAD_EXPORTS="$VOICE_EXPORTS"');
        expect(buildSh).toContain('ST_EXPORTS="$VOICE_EXPORTS"');
    });

    it('fails the build if libomp / embind / emscripten_run_script reach either wasm', () => {
        expect(code).toContain('check_hyphon_st_module.mjs" "${OUTPUT_ST_JS%.js}.wasm"');
        expect(code).toContain('check_hyphon_st_module.mjs" --symbols-only "${OUTPUT_JS%.js}.wasm"');
    });

    it('emits no pthread *.worker.js shim (the pinned emcc inlines workers)', () => {
        expect(existsSync(join(REPO_ROOT, 'scripts/ensure-pthread-worker-stamp.mjs'))).toBe(false);
        expect(code).not.toContain('worker.js');
        expect(withoutShellComments(jc303Sh)).not.toMatch(/worker\.js|libomp|-fopenmp/);
    });

    it('release and emcc builds re-check the linked wasm, not only glue', () => {
        expect(packageJson.scripts['build:release']).toContain('--wasm public/hyphon_native.wasm');
        expect(packageJson.scripts['build:release:changed']).toContain('--wasm public/hyphon_native.wasm');
        expect(code).toContain('--wasm');
    });
});

describe('CSP-legal boot path', () => {
    it('loads no script from a remote origin', () => {
        const scriptSrcs = [...indexHtml.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)]
            .map((m) => m[1]);
        expect(scriptSrcs.filter((src) => /^(https?:)?\/\//i.test(src))).toEqual([]);
        expect(indexHtml).not.toContain('cdn.jsdelivr.net');
    });

    it('has no eval-family importer', () => {
        // ADR 0001: no `unsafe-eval`. `new Function` is eval for CSP purposes.
        const mainTsx = read('src/main.tsx');
        expect(withoutJsLineComments(indexHtml)).not.toMatch(/new\s+Function\s*\(/);
        expect(withoutJsLineComments(mainTsx)).not.toMatch(/new\s+Function\s*\(/);
        expect(withoutJsLineComments(bootstrapTs)).not.toMatch(/new\s+Function\s*\(|\beval\s*\(/);
    });

    it('points Pyodide at the vendored same-origin copy', () => {
        expect(bootstrapTs).not.toContain('cdn.jsdelivr.net');
        // Base-path aware: the deploy base, not a hard-coded '/pyodide/'.
        expect(bootstrapTs).toContain('`${import.meta.env.BASE_URL}pyodide/`');
        // indexURL matters as much as the script tag: without it Pyodide derives its
        // own asset base and can still leave the origin.
        expect(bootstrapTs).toContain('indexURL: base');
    });

    it('never instantiates the voice glue on the main thread', () => {
        // main.tsx used to import() hyphon_native.js only to run main() → Pyodide.
        // An index.html top-level-await of it also blocked first paint (#1229 era).
        const mainTsx = read('src/main.tsx');
        expect(withoutJsLineComments(mainTsx)).not.toMatch(/import\([^)]*hyphon_native/);
        expect(withoutJsLineComments(mainTsx)).not.toContain("'hyphon_native.js'");
        expect(indexHtml).not.toMatch(/await import\(/);
    });

    it('can vendor Pyodide reproducibly from the pin', () => {
        expect(packageJson.scripts['vendor:pyodide']).toContain('fetch-pyodide.mjs');
        expect(toolchain.pyodide.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(toolchain.pyodide.files).toContain('pyodide.js');
        expect(toolchain.pyodide.files).toContain('pyodide-lock.json');
        // The bootstrap loads these; without the wheels, same-origin resolution 404s.
        expect(toolchain.pyodide.packages).toEqual(['numpy', 'scipy']);
        expect(bootstrapTs).toContain("loadPackage(['numpy', 'scipy'])");
    });

    it('keeps the vendored runtime out of git', () => {
        expect(read('.gitignore')).toContain('public/pyodide/');
    });
});
