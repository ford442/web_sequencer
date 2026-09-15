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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts', 'check-release-dist.mjs');

const MANIFEST = JSON.parse(
    execFileSync('node', ['-p', "JSON.stringify(require('./emscripten/wasm_export_manifest.json'))"], {
        cwd: ROOT,
        encoding: 'utf8',
    }),
) as { required: string[] };

/** Worklet processor names check-release-dist.mjs requires in the dist JS. */
const WORKLETS = [
    'clock-processor',
    'open303-processor',
    'prophecy-processor',
    'drumkit-processor',
    'sustain-processor',
    'RubberBandProcessor',
    'master-loudness-processor',
];

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
}

function makeDist({ wasmExports, exportMap, stMemory = 'plain' }: DistOptions = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'hyphon-dist-'));
    FIXTURES.push(dir);

    const map = exportMap ?? Object.fromEntries(MANIFEST.required.map((n) => [n, n]));
    const binaryExports = wasmExports ?? MANIFEST.required;

    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'native-artifacts.json'), '{}\n');
    writeFileSync(
        join(dir, 'assets', 'index.js'),
        WORKLETS.map((name) => `registerProcessor(${JSON.stringify(name)});`).join('\n'),
    );
    // Glue that declares the same names the map does, so only the binary differs.
    // The single-threaded glue quotes with `'`, as Emscripten emits it.
    const glue = (q: string) =>
        Object.entries(map)
            .map(([bare, minified]) => `Module[${q}_${bare}${q}] = wasmExports[${q}${minified}${q}];`)
            .join('\n');
    writeFileSync(join(dir, 'hyphon_wasm_export_map.json'), JSON.stringify(map, null, 2));
    writeFileSync(join(dir, 'hyphon_native.js'), glue('"'));
    writeFileSync(join(dir, 'hyphon_native.wasm'), wasmExporting(binaryExports, 'shared'));
    // The single-threaded profile carries the full contract, the same map, plain memory.
    const required = MANIFEST.required;
    const stMap = Object.fromEntries(required.map((n) => [n, n]));
    writeFileSync(join(dir, 'hyphon_wasm_export_map.st.json'), JSON.stringify(stMap, null, 2));
    writeFileSync(
        join(dir, 'hyphon_native.st.js'),
        required.map((n) => `Module['_${n}'] = wasmExports['${n}'];`).join('\n'),
    );
    writeFileSync(join(dir, 'hyphon_native.st.wasm'), wasmExporting(required, stMemory));
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
        expect(missingLine).toContain('prophecy_process');
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
});
