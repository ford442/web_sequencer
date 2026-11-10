/**
 * Guard for #1596 P4: `clamp`, `lerp` and Hz <-> MIDI are defined once, in
 * src/utils/math.ts. A static grep over `src/**` (tests excluded), modelled on
 * src/audio/runtime/__tests__/audioRuntimeGuards.test.ts. Domain-specific
 * variants with different signatures take a distinct name (`clampParam`,
 * `clamp01`, …) so they do not shadow the shared helper.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clamp, hzToMidi, lerp, midiToHz } from '../math';
import * as musicTheory from '../musicTheory';

const SRC = path.resolve(__dirname, '../..');
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');
const OWNER = 'utils/math.ts';

const isTestFile = (p: string) =>
    /(^|\/)__tests__\//.test(p) || /\.(test|spec|bench|perf)\.tsx?$/.test(p) || p.startsWith('test/');

function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
        else if (/\.tsx?$/.test(entry)) files.push(full);
    }
    return files;
}

const NAMES = 'clamp|lerp|midiToFreq|midiToHz|freqToMidi|hzToMidi';
/** `function clamp(`, `const clamp =`, `let lerp =` — a local definition, not a call or an import. */
export const DEFINES_HELPER = new RegExp(`(?:\\bfunction\\s+|\\b(?:const|let|var)\\s+)(?:${NAMES})\\s*(?:[(=<:])`);

describe('shared math helpers (#1596 P4)', () => {
    it('the pattern bites on definitions only', () => {
        expect(DEFINES_HELPER.test('function clamp(v: number, lo: number, hi: number) {')).toBe(true);
        expect(DEFINES_HELPER.test('export function midiToFreq(midiNote: number): number {')).toBe(true);
        expect(DEFINES_HELPER.test('const clamp = (x: number) => x;')).toBe(true);
        expect(DEFINES_HELPER.test('    const lerp = (lo: number, hi: number, v: number) => lo;')).toBe(true);
        expect(DEFINES_HELPER.test("import { clamp } from '@/utils/math';")).toBe(false);
        expect(DEFINES_HELPER.test('const y = clamp(x, 0, 1);')).toBe(false);
        expect(DEFINES_HELPER.test('function clampParam(value: number) {')).toBe(false);
        expect(DEFINES_HELPER.test('fn midiToFreq(midi: f32) -> f32 {')).toBe(false); // WGSL
    });

    it('defines clamp / lerp / midiToHz / hzToMidi only in utils/math.ts', () => {
        const hits: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const p = rel(file);
            if (p === OWNER || isTestFile(p)) continue;
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                if (DEFINES_HELPER.test(line)) hits.push(`src/${p}:${i + 1}: ${line.trim()}`);
            });
        }
        expect(hits, `import from '@/utils/math' instead:\n${hits.join('\n')}`).toEqual([]);
    });

    it('computes what the removed copies computed', () => {
        expect(clamp(5, 0, 1)).toBe(1);
        expect(clamp(-5, 0, 1)).toBe(0);
        expect(clamp(0.25, 0, 1)).toBe(0.25);
        expect(Number.isNaN(clamp(Number.NaN, 0, 1))).toBe(true);
        expect(Object.is(clamp(-0, 0, 1), 0)).toBe(true);
        expect(lerp(10, 20, 0.5)).toBe(15);
        expect(midiToHz(69)).toBe(440);
        expect(midiToHz(57)).toBeCloseTo(220, 10);
        expect(midiToHz(60)).toBeCloseTo(261.6255653, 6);
        expect(hzToMidi(880)).toBeCloseTo(81, 10);
        expect(hzToMidi(midiToHz(42.5))).toBeCloseTo(42.5, 10);
    });

    it('musicTheory re-exports the Hz <-> MIDI pair', () => {
        expect(musicTheory.midiToHz).toBe(midiToHz);
        expect(musicTheory.hzToMidi).toBe(hzToMidi);
    });
});
