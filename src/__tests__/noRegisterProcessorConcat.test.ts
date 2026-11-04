/**
 * Guard: `registerProcessor` is never spelled by string concatenation.
 *
 * `globalThis['register' + 'Processor'](…)` was a dodge to keep
 * `scripts/check-release-dist.mjs` from classifying a chunk that merely
 * *contains* worklet source as a worklet. #1509 made the gate classify worklet
 * chunks by their `?worker&url` entry instead and removed the dodge; #1517
 * re-added it in `src/agent/liveCapture.ts` the same day. A hidden
 * `registerProcessor` also hides real worklet code from that gate, so this test
 * fails on any spelling that assembles the name from pieces:
 *
 *   'register' + 'Processor'   "register" + "Processor"   `register` + `Processor`
 *   `${'register'}Processor`    `register${'Processor'}`    …and longer splits.
 *
 * Each line is normalised (literal `${'…'}` interpolations inlined, adjacent
 * string literals joined across `+`); a line that then contains
 * `registerProcessor` but did not before is an offence.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const SELF = path.resolve(__filename);
const NAME = 'register' + 'Processor'; // the guard's own needle, built so this file stays quiet

const INTERPOLATED_LITERAL = /\$\{\s*(['"`])([^'"`\n]*)\1\s*\}/g;
const JOINED_LITERALS = /(['"`])([^'"`\n]*)\1\s*\+\s*(['"`])([^'"`\n]*)\3/;

/** The line with literal interpolations inlined and `'a' + 'b'` joined to `'ab'`. */
export function normaliseConcatenation(line: string): string {
    let out = line.replace(INTERPOLATED_LITERAL, '$2');
    for (let guard = 0; guard < 16; guard++) {
        const next = out.replace(JOINED_LITERALS, (_m, _q1, a: string, _q2, b: string) => `'${a}${b}'`);
        if (next === out) break;
        out = next;
    }
    return out;
}

/** True when the line assembles `registerProcessor` from pieces. */
export function hidesRegisterProcessor(line: string): boolean {
    if (line.includes(NAME)) return false;
    return normaliseConcatenation(line).includes(NAME);
}

function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules') continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
        else if (/\.tsx?$/.test(entry)) files.push(full);
    }
    return files;
}

describe('no string-concatenated registerProcessor', () => {
    it('detects every spelling it is meant to catch, and not the plain call', () => {
        const q = "'";
        const offences = [
            `globalThis[${q}register${q} + ${q}Processor${q}]('x', X);`,
            'globalThis["register" + "Processor"]("x", X);',
            'globalThis[`register` + `Processor`]("x", X);',
            "globalThis[`${'register'}Processor`]('x', X);",
            "globalThis[`register${'Processor'}`]('x', X);",
            `self[${q}regis${q} + ${q}ter${q} + ${q}Processor${q}]('x', X);`,
        ];
        for (const line of offences) expect(hidesRegisterProcessor(line), line).toBe(true);

        expect(hidesRegisterProcessor(`${NAME}('hyphon-agent-recorder', HyphonAgentRecorder);`)).toBe(false);
        expect(hidesRegisterProcessor("const a = 'register' + suffix;")).toBe(false);
    });

    it('finds no such spelling under src/', () => {
        const hits: string[] = [];
        for (const file of sourceFiles(SRC)) {
            if (path.resolve(file) === SELF) continue;
            const lines = readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (hidesRegisterProcessor(line)) {
                    hits.push(`${path.relative(path.resolve(SRC, '..'), file)}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(hits, `registerProcessor assembled from pieces — write the plain call:\n${hits.join('\n')}`).toEqual([]);
    });
});
