/**
 * Worklet code type-checks against AudioWorkletGlobalScope, not a window
 * (docs/wasm/BUILD_NOTES.md#worklet-global-scope). `tsc -b` does the real work;
 * this pins the configuration that makes it so, so a "just add DOM" edit or a
 * new hand-written global declaration fails here with the reason attached.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** tsconfig files carry comments, so parse them the way tsc does. */
const tsconfig = (rel: string) =>
    ts.parseConfigFileTextToJson(rel, read(rel)).config as {
        compilerOptions?: { lib?: string[]; types?: string[] };
        include?: string[];
        exclude?: string[];
        references?: { path: string }[];
    };

function sources(dir: string): string[] {
    return readdirSync(join(ROOT, dir)).flatMap((name) => {
        const rel = join(dir, name);
        if (statSync(join(ROOT, rel)).isDirectory()) return name === '__tests__' ? [] : sources(rel);
        return /\.ts$/.test(name) && !name.endsWith('.d.ts') ? [relative(ROOT, join(ROOT, rel))] : [];
    });
}

describe('worklet global scope', () => {
    it('tsc -b builds the worklet and shared real-time projects', () => {
        const refs = tsconfig('tsconfig.json').references?.map((r) => r.path);
        expect(refs).toEqual(expect.arrayContaining(['./src/audio-worklets/tsconfig.json', './src/shared/rt/tsconfig.json']));
    });

    it('compiles src/audio-worklets with ES2022 + @types/audioworklet and no DOM', () => {
        const { compilerOptions } = tsconfig('src/audio-worklets/tsconfig.json');
        expect(compilerOptions?.lib).toEqual(['ES2022']);
        expect(compilerOptions?.types).toContain('audioworklet');
        expect(compilerOptions?.types?.some((t) => /dom|web$/i.test(t))).toBe(false);
    });

    it('compiles src/shared/rt with ES2022 alone, so it fits both worlds', () => {
        const { compilerOptions } = tsconfig('src/shared/rt/tsconfig.json');
        expect(compilerOptions?.lib).toEqual(['ES2022']);
        expect(compilerOptions?.types).toEqual([]);
    });

    it('excludes worklet and shared real-time sources from the DOM app project', () => {
        expect(tsconfig('tsconfig.app.json').exclude).toEqual(expect.arrayContaining([
            'src/audio-worklets/*.ts',
            'src/shared/rt/*.ts',
        ]));
    });

    it('has no hand-declared AudioWorkletGlobalScope members left in worklet sources', () => {
        const declared = sources('src/audio-worklets').filter((rel) =>
            /^\s*declare\s+(?:var|let|const|function|class)\s+(?:sampleRate|currentTime|currentFrame|registerProcessor|AudioWorkletProcessor)\b|^\s*interface\s+AudioWorkletProcessor\b/m
                .test(read(rel)));
        expect(declared).toEqual([]);
    });
});
