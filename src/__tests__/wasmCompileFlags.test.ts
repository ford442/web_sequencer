/**
 * Compile-time contracts that no runtime test can catch, because the artifacts
 * they describe are gitignored and often absent in CI:
 *
 *   1. -ffast-math is opt-in per translation unit, not global.
 *   2. The AssemblyScript modules stay inside the Safari feature intersection.
 *   3. The out-of-band wasm-opt is pinned, and never emsdk's bundled one.
 *   4. index.html boots with no remote script and no `unsafe-eval`.
 *
 * See docs/wasm/BUILD_NOTES.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
const optimizeSh = read('tools/optimize.sh');
const indexHtml = read('index.html');
const bootstrapJs = read('emscripten/pyodide_bootstrap.js');
const toolchain = JSON.parse(read('emscripten/toolchain.json')) as {
    emscripten: { version: string };
    binaryen: { version: number; npmPackage: string; features: Record<string, string[]> };
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
    ];

    it('is not a global compile flag', () => {
        expect(buildSh).not.toMatch(/OPT_FLAGS="[^"]*-ffast-math/);
        expect(buildSh).not.toMatch(/CXXFLAGS="[^"]*-ffast-math/);
    });

    it('reaches only the opt-in helper', () => {
        const fastMathLines = buildSh
            .split('\n')
            .filter((line) => line.includes('-ffast-math') && !line.trim().startsWith('#'));
        expect(fastMathLines).toHaveLength(1);
        expect(fastMathLines[0]).toContain('CXXFLAGS_FAST');
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

    it('keeps audio_dsp.cpp as the single fast-math consumer', () => {
        const fastCalls = buildSh
            .split('\n')
            .filter((line) => line.trim().startsWith('compile_cpp_fast "'));
        expect(fastCalls).toHaveLength(1);
        expect(fastCalls[0]).toContain('audio_dsp.cpp');
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

describe('pinned wasm-opt', () => {
    it('records the binaryen pin next to the Emscripten pin', () => {
        expect(toolchain.emscripten.version).toBe('3.1.51');
        expect(toolchain.binaryen.version).toBeGreaterThan(0);
        expect(toolchain.binaryen.npmPackage).toContain(String(toolchain.binaryen.version));
    });

    it('never uses emsdk’s bundled wasm-opt', () => {
        // That binary at -O2+ is exactly what fails this pthreads+SIMD+bigint link,
        // which is why emscripten/build.sh pins the link at -O1.
        expect(withoutShellComments(optimizeSh)).not.toContain('EMSDK/upstream/bin/wasm-opt');
        expect(buildSh).toContain('LINK_PROFILE_FLAGS="-O1');
    });

    it('refuses a version that does not match the pin', () => {
        expect(optimizeSh).toContain('wasm-opt version mismatch');
        expect(optimizeSh).toContain('PINNED_VERSION');
    });

    it('does not enable a feature no module was built with', () => {
        // Passing a feature the module lacks is not free: later passes may then emit
        // instructions the target engine rejects.
        for (const flags of Object.values(toolchain.binaryen.features)) {
            expect(flags).not.toContain('--enable-relaxed-simd');
        }
        expect(toolchain.binaryen.features.hyphonNative).toEqual(
            expect.arrayContaining(['--enable-simd', '--enable-threads', '--enable-bulk-memory']),
        );
    });

    it('re-checks the export contract against the rewritten binary', () => {
        // The glue is untouched by an out-of-band pass, so --glue alone would still
        // pass even if exports had been renamed.
        expect(optimizeSh).toContain('check_wasm_export_map.mjs');
        expect(optimizeSh).toContain('--wasm public/hyphon_native.wasm');
        expect(read('tools/check_wasm_export_map.mjs')).toContain("'--wasm'");
    });

    it('is opt-in, not part of build:release', () => {
        expect(packageJson.scripts['build:release']).not.toContain('optimize');
        expect(packageJson.scripts.optimize).toContain('tools/optimize.sh');
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
        expect(withoutJsLineComments(indexHtml)).not.toMatch(/new\s+Function\s*\(/);
        expect(indexHtml).toContain('@vite-ignore');
    });

    it('points Pyodide at the vendored same-origin copy', () => {
        expect(indexHtml).toContain('HYPHON_PYODIDE_BASE_URL');
        expect(bootstrapJs).not.toContain('cdn.jsdelivr.net');
        expect(bootstrapJs).toContain('HYPHON_PYODIDE_BASE_URL');
        // indexURL matters as much as the script tag: without it Pyodide derives its
        // own asset base and can still leave the origin.
        expect(bootstrapJs).toContain('indexURL: PYODIDE_BASE');
    });

    it('sets the Pyodide base before the module that boots it', () => {
        // hyphon_native.js runs pyodide_bootstrap.js via --post-js, and the first
        // inline module script has a top-level await, which would defer a later one.
        expect(indexHtml.indexOf('HYPHON_PYODIDE_BASE_URL'))
            .toBeLessThan(indexHtml.indexOf('/hyphon_native.js?url'));
    });

    it('can vendor Pyodide reproducibly from the pin', () => {
        expect(packageJson.scripts['vendor:pyodide']).toContain('fetch-pyodide.mjs');
        expect(toolchain.pyodide.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(toolchain.pyodide.files).toContain('pyodide.js');
        expect(toolchain.pyodide.files).toContain('pyodide-lock.json');
        // The bootstrap loads these; without the wheels, same-origin resolution 404s.
        expect(toolchain.pyodide.packages).toEqual(['numpy', 'scipy']);
        expect(bootstrapJs).toContain("loadPackage(['numpy', 'scipy'])");
    });

    it('keeps the vendored runtime out of git', () => {
        expect(read('.gitignore')).toContain('public/pyodide/');
    });
});
