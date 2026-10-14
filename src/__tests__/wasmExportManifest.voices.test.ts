import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * #1344: emscripten/wasm_export_manifest.json is the one list of hyphon_native's
 * C API — build.sh exports exactly what it declares. An engine on the shared
 * voice core gets its generic exports from HYPHON_EXPORT_VOICE, so every
 * name the macro generates must be declared there, or the link drops it.
 */

const repoRoot = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

interface Manifest {
    required: string[];
    optional: string[];
    runtime: string[];
}
const manifest = JSON.parse(read('emscripten/wasm_export_manifest.json')) as Manifest;
const built = new Set([...manifest.required, ...manifest.optional]);

/** Suffixes the macro defines as EMSCRIPTEN_KEEPALIVE functions. */
function macroSuffixes(): string[] {
    const header = read('emscripten/core/voice_exports.h');
    return [...header.matchAll(/EMSCRIPTEN_KEEPALIVE[^\n]*?prefix##_(\w+)\s*\(/g)].map((m) => m[1]);
}

/** Every `HYPHON_EXPORT_VOICE(prefix, …)` in the wrappers. */
function voicePrefixes(): string[] {
    const dir = path.join(repoRoot, 'emscripten');
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.cpp'))
        .flatMap((f) => [...read(`emscripten/${f}`).matchAll(/^HYPHON_EXPORT_VOICE\((\w+),/gm)].map((m) => m[1]));
}

function exportedFunctions(...args: string[]): string[] {
    const out = execFileSync('node', ['tools/hyphon_native_exports.mjs', ...args], { cwd: repoRoot, encoding: 'utf8' });
    return JSON.parse(out) as string[];
}

describe('hyphon_native export manifest (#1344)', () => {
    it('reads the macro\'s generic export set', () => {
        expect(macroSuffixes()).toEqual(['create', 'destroy', 'init', 'push_event', 'render', 'cancel_notes']);
    });

    it('declares every export HYPHON_EXPORT_VOICE generates', () => {
        const prefixes = voicePrefixes();
        expect([...prefixes].sort()).toEqual(['drumkit', 'highfid303', 'jc303', 'open303', 'prophecy']);
        const missing = prefixes.flatMap((p) => macroSuffixes().map((s) => `${p}_${s}`)).filter((n) => !built.has(n));
        expect(missing).toEqual([]);
    });

    it('keeps the buckets disjoint', () => {
        const all = [...manifest.required, ...manifest.optional, ...manifest.runtime];
        expect(all.length).toBe(new Set(all).size);
    });

    it('build.sh exports exactly required + optional, the same for both profiles', () => {
        const bare = (names: string[]) => names.map((n) => n.replace(/^_/, '')).sort();
        expect(bare(exportedFunctions())).toEqual([...built].sort());
        expect(read('emscripten/build.sh')).toMatch(/tools\/hyphon_native_exports\.mjs/);
    });
});
