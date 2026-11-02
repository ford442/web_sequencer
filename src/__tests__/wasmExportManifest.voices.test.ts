import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEventSchema } from '../../tools/gen_hyphon_native_types.mjs';
import { EVENT_BYTES, EventOffset, EventType } from '../shared/rt/eventLayout';

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
        expect(macroSuffixes()).toEqual(['create', 'destroy', 'init', 'push_event', 'render', 'cancel_notes', 'flush']);
    });

    it('declares every export HYPHON_EXPORT_VOICE generates', () => {
        const prefixes = voicePrefixes();
        expect([...prefixes].sort()).toEqual(['drumkit', 'highfid303', 'jc303', 'macro', 'open303', 'prophecy']);
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

describe('generated hyphonNativeExports.ts (#1344)', () => {
    it('is up to date with the manifest, the C prototypes and the event enums', () => {
        const out = execFileSync('node', ['tools/gen_hyphon_native_types.mjs', '--check'], {
            cwd: repoRoot,
            encoding: 'utf8',
        });
        expect(out).toContain('src/shared/rt/hyphonNativeExports.ts is up to date');
    });

    it('types every export the manifest declares', () => {
        const generated = read('src/shared/rt/hyphonNativeExports.ts');
        const missing = [...manifest.required, ...manifest.optional].filter(
            (n) => !new RegExp(`^  ${n}\\??\\(`, 'm').test(generated),
        );
        expect(missing).toEqual([]);
    });
});

describe('control-plane record, generated from emscripten/core/event_schema.json (#1497)', () => {
    interface SchemaJson {
        record: { bytes: number; fields: Array<{ name: string; type: string; count?: number }> };
        types: Array<{ id: number; args?: Array<{ name: string; doc: string }> }>;
    }
    const schemaText = read('emscripten/core/event_schema.json');
    const edit = (fn: (schema: SchemaJson) => void) => {
        const schema = JSON.parse(schemaText) as SchemaJson;
        fn(schema);
        return JSON.stringify(schema);
    };

    it('the drift check covers both layouts', () => {
        const out = execFileSync('node', ['tools/gen_hyphon_native_types.mjs', '--check'], { cwd: repoRoot, encoding: 'utf8' });
        expect(out).toContain('src/shared/rt/eventLayout.ts is up to date');
        expect(out).toContain('emscripten/core/event_layout.h is up to date');
    });

    it('check:exports runs the drift check even without WASM artifacts', () => {
        expect(read('tools/check_wasm_export_map.mjs')).toMatch(/staleGeneratedFiles\(\)/);
        const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
        expect(pkg.scripts.lint).toContain('check:native-types');
    });

    it('the C++ header asserts the size and offsets the TS writer uses', () => {
        const header = read('emscripten/core/event_layout.h');
        expect(header).toContain(`constexpr size_t kEventBytes = ${EVENT_BYTES};`);
        expect(header).toContain('static_assert(sizeof(Event) == kEventBytes');
        const asserted = Object.fromEntries(
            [...header.matchAll(/offsetof\(Event, (\w+)\) == (\d+)/g)].map((m) => [m[1], Number(m[2])]),
        );
        expect(asserted).toEqual(EventOffset);
        for (const [symbol, id] of Object.entries(EventType)) {
            expect(header).toMatch(new RegExp(`k${symbol}\\s+= ${id >= 0x100 ? `0x${id.toString(16).toUpperCase()}` : id},`));
        }
        expect(read('emscripten/core/voice.h')).toContain('#include "event_layout.h"');
    });

    it('lays fields out at natural alignment and refuses a layout that is not 32 bytes', () => {
        expect(loadEventSchema(schemaText).fields.map((f) => [f.name, f.offset])).toEqual([
            ['frame', 0], ['type', 8], ['target', 10], ['value', 12], ['args', 16],
        ]);
        expect(() => loadEventSchema(edit((s) => { s.record.bytes = 40; }))).toThrow(/take 32 bytes/);
        // A uint16 first pushes the int64 frame off its 8-byte alignment.
        expect(() => loadEventSchema(edit((s) => { s.record.fields.unshift(s.record.fields.splice(1, 1)[0]); }))).toThrow(/not 8-aligned/);
        expect(() => loadEventSchema(edit((s) => { s.record.fields[3].type = 'float16'; }))).toThrow(/unknown type/);
    });

    it('refuses duplicate or out-of-range type ids and arg slots the record does not have', () => {
        expect(() => loadEventSchema(edit((s) => { s.types[1].id = 1; }))).toThrow(/used twice/);
        expect(() => loadEventSchema(edit((s) => { s.types[0].id = 256; }))).toThrow(/id must be/);
        expect(() => loadEventSchema(edit((s) => {
            s.types[0].args = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, doc: '' }));
        }))).toThrow(/more arg slots/);
    });
});
