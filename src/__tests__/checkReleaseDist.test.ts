/**
 * Regression test for the release-bundle gate's WASM export check.
 *
 * A dist/ whose hyphon_native.wasm is not the binary its glue was linked with
 * used to pass every release check and ship: the worklets then instantiated the
 * module fine and found neither open303_* nor prophecy_* on it, silently
 * degrading the 303 and Prophecy engines to their JS fallbacks in production.
 *
 * The gate is only worth having if it fails on that bundle, so this builds
 * fixture dist/ directories (hermetic — hand-encoded WASM, no build artifacts)
 * and runs the real script against them via HYPHON_DIST_DIR.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mixBusWasmFixture, type MixBusFixtureVariant } from '../test/helpers/mixBusWasmFixture';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts', 'check-release-dist.mjs');

const MANIFEST = JSON.parse(
    execFileSync('node', ['-p', "JSON.stringify(require('./emscripten/wasm_export_manifest.json'))"], {
        cwd: ROOT,
        encoding: 'utf8',
    }),
) as { required: string[] };

/** The real native rows, so the over-budget fixture tracks the budget. */
const NATIVE_BUDGET = (JSON.parse(readFileSync(join(ROOT, 'dist-budget.json'), 'utf8')) as {
    native: Record<string, number>;
}).native;

/** Worklet processor names check-release-dist.mjs requires in the dist JS. */
const WORKLETS = [
    'clock-processor',
    'open303-processor',
    'prophecy-processor',
    'macro-processor',
    'drumkit-processor',
    'sustain-processor',
    'RubberBandProcessor',
    'master-loudness-processor',
];

/**
 * The chunk stem Vite emits for each worklet entry (`<module>-<hash>.js`). The gate
 * classifies chunks by this name, so the fixture must use the real one: the
 * registered processor name is `RubberBandProcessor`, the module is rubberband-processor.
 */
const WORKLET_CHUNK_STEM: Record<string, string> = {
    'clock-processor': 'clock-processor',
    'open303-processor': 'open303-processor',
    'prophecy-processor': 'prophecy-processor',
    'macro-processor': 'macro-processor',
    'drumkit-processor': 'drumkit-processor',
    'sustain-processor': 'sustain-processor',
    RubberBandProcessor: 'rubberband-processor',
    'master-loudness-processor': 'master-loudness-processor',
};
const workletChunkName = (processor: string, hash = 'AbCd1234') => `${WORKLET_CHUNK_STEM[processor]}-${hash}.js`;

function uleb(value: number): number[] {
    const out: number[] = [];
    let n = value;
    do {
        let byte = n & 0x7f;
        n >>>= 7;
        if (n !== 0) byte |= 0x80;
        out.push(byte);
    } while (n !== 0);
    return out;
}

function section(id: number, payload: number[]): number[] {
    return [id, ...uleb(payload.length), ...payload];
}

function name(text: string): number[] {
    const bytes = [...Buffer.from(text, 'utf8')];
    return [...uleb(bytes.length), ...bytes];
}

/**
 * A minimal valid module exporting `names` as no-op `() -> ()` functions,
 * optionally importing `env.memory` (plain, or shared like a pthread build).
 */
function wasmExporting(names: readonly string[], memory: 'none' | 'plain' | 'shared' = 'none'): Buffer {
    const n = names.length;
    const types = section(1, [...uleb(1), 0x60, ...uleb(0), ...uleb(0)]);
    const limits = memory === 'shared' ? [0x03, ...uleb(1), ...uleb(2)] : [0x00, ...uleb(1)];
    const imports = memory === 'none'
        ? []
        : section(2, [...uleb(1), ...name('env'), ...name('memory'), 0x02, ...limits]);
    const funcs = section(3, [...uleb(n), ...names.map(() => 0)]);
    const exports = section(7, [
        ...uleb(n),
        ...names.flatMap((name, i) => {
            const bytes = [...Buffer.from(name, 'utf8')];
            return [...uleb(bytes.length), ...bytes, 0x00, ...uleb(i)];
        }),
    ]);
    const body = [...uleb(0), 0x0b]; // no locals, `end`
    const code = section(10, [...uleb(n), ...names.flatMap(() => [...uleb(body.length), ...body])]);
    return Buffer.from([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        ...types, ...imports, ...funcs, ...exports, ...code,
    ]);
}

const FIXTURES: string[] = [];

interface DistOptions {
    /** Exports the fixture binary actually carries. Defaults to every required one. */
    wasmExports?: readonly string[];
    /** Export map written to the bundle. Defaults to an identity map. */
    exportMap?: Record<string, string>;
    /** Memory import of hyphon_native.st.wasm. A pthread-style shared one must fail. */
    stMemory?: 'plain' | 'shared';
    /** dist/mix_bus.wasm (#1341); `null` leaves it out. */
    mixBus?: MixBusFixtureVariant | null;
    /** Bytes appended to hyphon_native.wasm as a custom section (still a valid module). */
    pthreadPadding?: number;
    /** A string the pthread binary must not contain (libomp / embind / run_script). */
    pthreadMarker?: string;
    /** Ship dist/THIRD_PARTY_NOTICES.md (the macro engine's MIT notice). */
    notices?: boolean;
    /** Extra files under dist/assets/, name -> text. */
    extraAssets?: Record<string, string>;
    /** Text appended to a worklet chunk, keyed by processor name. */
    workletSuffix?: Record<string, string>;
    /** Processors whose chunk is left out, as if inlined into a shared chunk. */
    omitWorklets?: readonly string[];
    /** Extra files at the dist/ root (relative path -> bytes), e.g. a stale public/ copy. */
    extraRootFiles?: Record<string, string>;
}

/** Custom section (id 0): ignored by engines, so the module stays valid. */
function customSection(sectionName: string, payload: Buffer): Buffer {
    return Buffer.from(section(0, [...name(sectionName), ...payload]));
}

function makeDist({
    wasmExports,
    exportMap,
    stMemory = 'plain',
    mixBus = 'valid',
    pthreadPadding = 0,
    pthreadMarker,
    notices = true,
    extraAssets = {},
    workletSuffix = {},
    omitWorklets = [],
    extraRootFiles = {},
}: DistOptions = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'hyphon-dist-'));
    FIXTURES.push(dir);

    const map = exportMap ?? Object.fromEntries(MANIFEST.required.map((n) => [n, n]));
    const binaryExports = wasmExports ?? MANIFEST.required;

    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'native-artifacts.json'), '{}\n');
    // One self-contained chunk per worklet, as `worker: { format: 'es' }` emits
    // in production. check-release-dist.mjs asserts that shape (a worklet scope
    // has no module loader), so the fixture has to have it too.
    for (const worklet of WORKLETS) {
        if (omitWorklets.includes(worklet)) continue;
        writeFileSync(
            join(dir, 'assets', workletChunkName(worklet)),
            `registerProcessor(${JSON.stringify(worklet)}, class {});\n${workletSuffix[worklet] ?? ''}`,
        );
    }
    // A chunk that merely names a processor must still be present for a bundle that omits one.
    for (const worklet of omitWorklets) {
        writeFileSync(join(dir, 'assets', 'shared-ZxCvBnM1.js'), `const n = ${JSON.stringify(worklet)};\n`, { flag: 'a' });
    }
    for (const [file, text] of Object.entries(extraAssets)) writeFileSync(join(dir, 'assets', file), text);
    writeFileSync(join(dir, 'assets', 'index.js'), 'const app = 1;\n');
    // Minimal PWA shell fixture — unrelated to the WASM export gate this file
    // tests, but check-release-dist.mjs now requires it unconditionally.
    writeFileSync(join(dir, 'manifest.webmanifest'), JSON.stringify({ name: 'Hyphon', start_url: './' }));
    writeFileSync(
        join(dir, 'precache-manifest.json'),
        JSON.stringify({ version: 'test', generatedAt: Date.now(), shell: ['./', './manifest.webmanifest', './assets/index.js'] }),
    );
    writeFileSync(join(dir, 'sw.js'), "const BUILD_ID = 'test-build-id';\n");
    if (notices) writeFileSync(join(dir, 'THIRD_PARTY_NOTICES.md'), readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8'));
    // Glue that declares the same names the map does, so only the binary differs.
    // The single-threaded glue quotes with `'`, as Emscripten emits it.
    const glue = (q: string) =>
        Object.entries(map)
            .map(([bare, minified]) => `Module[${q}_${bare}${q}] = wasmExports[${q}${minified}${q}];`)
            .join('\n');
    writeFileSync(join(dir, 'hyphon_wasm_export_map.json'), JSON.stringify(map, null, 2));
    writeFileSync(join(dir, 'hyphon_native.js'), glue('"'));
    writeFileSync(
        join(dir, 'hyphon_native.wasm'),
        Buffer.concat([
            wasmExporting(binaryExports, 'shared'),
            ...(pthreadPadding ? [customSection('pad', Buffer.alloc(pthreadPadding))] : []),
            ...(pthreadMarker ? [customSection(pthreadMarker, Buffer.alloc(0))] : []),
        ]),
    );
    // The single-threaded profile carries the full contract, the same map, plain memory.
    const required = MANIFEST.required;
    const stMap = Object.fromEntries(required.map((n) => [n, n]));
    writeFileSync(join(dir, 'hyphon_wasm_export_map.st.json'), JSON.stringify(stMap, null, 2));
    writeFileSync(
        join(dir, 'hyphon_native.st.js'),
        required.map((n) => `Module['_${n}'] = wasmExports['${n}'];`).join('\n'),
    );
    writeFileSync(join(dir, 'hyphon_native.st.wasm'), wasmExporting(required, stMemory));
    if (mixBus !== null) writeFileSync(join(dir, 'mix_bus.wasm'), mixBusWasmFixture(mixBus));
    for (const [rel, text] of Object.entries(extraRootFiles)) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), text);
    }
    return dir;
}

function runCheck(distDir: string): { status: number; output: string } {
    try {
        const output = execFileSync('node', [SCRIPT], {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, HYPHON_DIST_DIR: distDir },
        });
        return { status: 0, output };
    } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return {
            status: failure.status ?? 1,
            output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
        };
    }
}

afterEach(() => {
    while (FIXTURES.length) {
        rmSync(FIXTURES.pop()!, { recursive: true, force: true });
    }
});

describe('check-release-dist WASM export gate', () => {
    it('passes a bundle whose binary carries every required export', () => {
        const result = runCheck(makeDist());
        expect(result.output).toContain('resolved in the binary');
        expect(result.status).toBe(0);
    });

    it('fails a bundle without the third-party notices (macro engine MIT code)', () => {
        const result = runCheck(makeDist({ notices: false }));
        expect(result.status).not.toBe(0);
        expect(result.output).toContain('THIRD_PARTY_NOTICES.md');
    });

    it('fails the bundle that shipped: glue and map agree, binary has neither API', () => {
        // The production failure — a .wasm from a different link, whose exports
        // are minified, alongside a glue/map pair that agree with each other.
        const result = runCheck(makeDist({ wasmExports: ['a', 'b', 'c', 'malloc', 'free'] }));

        expect(result.status).toBe(1);
        expect(result.output).toContain('open303_create');
        expect(result.output).toContain('prophecy_create');
        // The actual export names must be in the failure, or the map is unfixable.
        expect(result.output).toMatch(/Actual exports \(\d+\)/);
    });

    it('names the missing export when only Prophecy is absent', () => {
        const withoutProphecy = MANIFEST.required.filter((n) => !n.startsWith('prophecy_'));
        const result = runCheck(makeDist({ wasmExports: withoutProphecy }));

        expect(result.status).toBe(1);
        const missingLine = result.output
            .split('\n')
            .find((line) => line.includes('required export(s):'));
        expect(missingLine).toContain('prophecy_render');
        // Present exports belong in the "Actual exports" preview, not the missing list.
        expect(missingLine).not.toContain('open303_process');
    });

    it('accepts minified exports when the map resolves them', () => {
        const minified = Object.fromEntries(
            MANIFEST.required.map((name, i) => [name, `m${i}`]),
        );
        const result = runCheck(
            makeDist({ exportMap: minified, wasmExports: Object.values(minified) }),
        );

        expect(result.output).toContain('resolved in the binary');
        expect(result.status).toBe(0);
    });

    it('rejects a map naming symbols the binary does not export', () => {
        // Bare names still resolve, so the API works — but the map is stale and
        // the next rename would go unnoticed.
        const stale = Object.fromEntries(MANIFEST.required.map((name) => [name, `stale_${name}`]));
        const result = runCheck(makeDist({ exportMap: stale, wasmExports: MANIFEST.required }));

        expect(result.status).toBe(1);
        expect(result.output).toContain('absent from dist/hyphon_native.wasm');
    });

    it('checks the single-threaded profile too', () => {
        const result = runCheck(makeDist());
        expect(result.output).toContain('hyphon_native.st.wasm: ');
        expect(result.status).toBe(0);
    });

    it('rejects a single-threaded binary that imports shared memory', () => {
        const result = runCheck(makeDist({ stMemory: 'shared' }));

        expect(result.status).toBe(1);
        expect(result.output).toContain('hyphon_native.st.wasm is not a single-threaded build');
    });

    it.each(['jc303-single.wasm', 'jc303-threaded-worklet.js', 'jc303.js', 'jc303_worklet.js'])(
        'rejects a retired standalone JC-303 artifact (%s)',
        (file) => {
            const result = runCheck(makeDist({ extraRootFiles: { [file]: '' } }));

            expect(result.status).toBe(1);
            expect(result.output).toContain('retired standalone JC-303 artifacts');
            expect(result.output).toContain(file);
        },
    );

    it('keeps the JC-303 UI art (osc/jc303.webp)', () => {
        // Only the JC-303 gate is under test: a lone dist/osc/ entry trips the
        // panel-art check for the other engines, so the exit status is not asserted.
        const result = runCheck(makeDist({ extraRootFiles: { 'osc/jc303.webp': '' } }));

        expect(result.output).not.toContain('retired standalone JC-303');
    });

    it('requires the offline mix bus to ship (#1341)', () => {
        const result = runCheck(makeDist({ mixBus: null }));

        expect(result.status).toBe(1);
        expect(result.output).toContain('dist/mix_bus.wasm is missing');
    });

    it('budgets the voice module binaries (dist-budget.json#native)', () => {
        const result = runCheck(makeDist({ pthreadPadding: NATIVE_BUDGET['hyphon_native.wasm'] + 1 }));

        expect(result.status).toBe(1);
        expect(result.output).toMatch(/hyphon_native\.wasm is [\d,]+ B, over budget/);
    });

    it('rejects a pthread binary that still links embind', () => {
        const result = runCheck(makeDist({ pthreadMarker: '_embind_register_function' }));

        expect(result.status).toBe(1);
        expect(result.output).toContain('dist/hyphon_native.wasm links a runtime it has no caller for');
        expect(result.output).toContain('embind is linked');
    });

    it('rejects a mix bus whose memory could grow', () => {
        const result = runCheck(makeDist({ mixBus: 'growable-memory' }));

        expect(result.status).toBe(1);
        expect(result.output).toContain('dist/mix_bus.wasm is not a valid mix bus');
        expect(result.output).toContain('memory can grow');
    });
});

describe('check-release-dist worklet classification (#1468)', () => {
    it('does not treat a chunk that carries an inline worklet source string as a worklet', () => {
        // src/agent/liveCapture.ts loads its recorder from a Blob URL: the source
        // is a string, so the AgentBridge UI chunk contains `registerProcessor(`
        // and an `export`, and is not an AudioWorklet chunk.
        const dir = makeDist({
            extraAssets: {
                'AgentBridge-QwErTy12.js':
                    'const SRC = `class R extends AudioWorkletProcessor {}\nregisterProcessor(\'hyphon-agent-recorder\', R);`;\n' +
                    'export { SRC as RECORDER_SOURCE };\n',
            },
        });
        const { status, output } = runCheck(dir);
        expect(output).toContain('8 worklet chunk(s) are self-contained');
        expect(status).toBe(0);
    });

    it('fails a real worklet chunk that keeps a runtime import', () => {
        const dir = makeDist({ workletSuffix: { 'clock-processor': 'import"./shared-ZxCvBnM1.js";\n' } });
        const { status, output } = runCheck(dir);
        expect(status).toBe(1);
        expect(output).toContain('contain runtime import/export');
        expect(output).toContain(workletChunkName('clock-processor'));
    });

    it('fails a real worklet chunk that keeps a runtime export', () => {
        const dir = makeDist({ workletSuffix: { RubberBandProcessor: 'export{RubberBandProcessor as default};\n' } });
        const { status, output } = runCheck(dir);
        expect(status).toBe(1);
        expect(output).toContain(workletChunkName('RubberBandProcessor'));
    });

    it('skips the ?worker&url pointer module that shares a worklet\'s name', () => {
        // import('…clock-processor.ts?worker&url') emits clock-processor-<hash>.js
        // holding only `new URL(<real chunk>, import.meta.url).href`.
        const dir = makeDist({
            extraAssets: {
                'clock-processor-ZyXwVu98.js':
                    `var e=new URL(\`${workletChunkName('clock-processor')}\`,import.meta.url).href;export{e as default};\n`,
            },
        });
        const { status, output } = runCheck(dir);
        expect(output).toContain('8 worklet chunk(s) are self-contained');
        expect(status).toBe(0);
    });

    it('fails when a worklet entry was inlined into a shared chunk', () => {
        const dir = makeDist({ omitWorklets: ['sustain-processor'] });
        const { status, output } = runCheck(dir);
        expect(status).toBe(1);
        expect(output).toContain('expected at least 8 worklet chunk(s)');
    });

    it('fails a worklet entry chunk that never registers a processor', () => {
        const dir = makeDist();
        writeFileSync(join(dir, 'assets', workletChunkName('clock-processor')), "const name = 'clock-processor';\n");
        const { status, output } = runCheck(dir);
        expect(status).toBe(1);
        expect(output).toContain('never call registerProcessor()');
        expect(output).toContain(workletChunkName('clock-processor'));
    });
});
