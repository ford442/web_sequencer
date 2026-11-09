/**
 * Guards for #1596 P1: one owner for the live AudioContext, one registry for
 * AudioWorklet modules. Static greps over `src/**` (tests excluded), modelled
 * on src/__tests__/noRegisterProcessorConcat.test.ts.
 *
 *  1. No AudioContext constructor outside the factory, the runtime and the
 *     StartOverlay E2E patch. Aliases are resolved the cheap way: any file
 *     that reads `window.AudioContext` / `webkitAudioContext` is flagged.
 *  2. No `.addModule(` outside the runtime — load through `loadWorkletModule`.
 *  3. No `.resume()` outside the runtime — call `ensureRunning`. The one
 *     exception is the offline vocal host's suspend/resume pair on a render
 *     context (not a gesture, not the live context).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');

const RUNTIME_DIR = 'audio/runtime/';
const CONSTRUCTOR_ALLOW = new Set([
    'hooks/audioEngine/audioContextFactory.ts',
    'components/StartOverlay.tsx', // ?e2e=1 AudioContext patch only
]);
const RESUME_ALLOW = new Set([
    'audio/offline/vocal/offlineVocalHost.ts', // suspend/resume pair on an OfflineAudioContext render
]);

const isTestFile = (p: string) =>
    /(^|\/)__tests__\//.test(p) || /\.(test|spec|bench)\.tsx?$/.test(p) || p.startsWith('test/');

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

/** Code lines with comments and string-literal contents removed. */
export function codeOnly(line: string): string {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
    return line
        .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
        .replace(/\/\/.*$/, '');
}

export const CONSTRUCTS_CONTEXT = /new\s+(?:window\.)?(?:webkit)?AudioContext\s*\(|\bwindow\.AudioContext\b|\bwebkitAudioContext\b/;
export const ADDS_MODULE = /\.addModule\s*\(/;
export const RESUMES = /\.resume\s*\(\s*\)/;

function offences(pattern: RegExp, allowed: (p: string) => boolean): string[] {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
        const p = rel(file);
        if (isTestFile(p) || p.startsWith(RUNTIME_DIR) || allowed(p)) continue;
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
            if (pattern.test(codeOnly(line))) hits.push(`src/${p}:${i + 1}: ${line.trim()}`);
        });
    }
    return hits;
}

describe('audio runtime guards (#1596)', () => {
    it('the patterns bite on the spellings they target', () => {
        expect(CONSTRUCTS_CONTEXT.test(codeOnly('const c = new AudioContext();'))).toBe(true);
        expect(CONSTRUCTS_CONTEXT.test(codeOnly('const Ctx = window.AudioContext || w.webkitAudioContext;'))).toBe(true);
        expect(CONSTRUCTS_CONTEXT.test(codeOnly('new OfflineAudioContext(2, 128, 48000)'))).toBe(false);
        expect(ADDS_MODULE.test(codeOnly('await ctx.audioWorklet.addModule(url);'))).toBe(true);
        expect(RESUMES.test(codeOnly('await ctx.resume();'))).toBe(true);
        expect(RESUMES.test(codeOnly("console.error('AudioContext.resume() failed')"))).toBe(false);
        expect(RESUMES.test(codeOnly(' * `await context.resume()` hangs'))).toBe(false);
    });

    it('constructs AudioContext only in the factory, the runtime and the E2E patch', () => {
        const hits = offences(CONSTRUCTS_CONTEXT, (p) => CONSTRUCTOR_ALLOW.has(p));
        expect(hits, `build the live context through audioRuntime.createLiveContext:\n${hits.join('\n')}`).toEqual([]);
    });

    it('loads worklet modules only through the registry', () => {
        const hits = offences(ADDS_MODULE, () => false);
        expect(hits, `use loadWorkletModule(context, url, processorName):\n${hits.join('\n')}`).toEqual([]);
    });

    it('resumes contexts only in the runtime (offline vocal host excepted)', () => {
        const hits = offences(RESUMES, (p) => RESUME_ALLOW.has(p));
        expect(hits, `use ensureRunning(gesture):\n${hits.join('\n')}`).toEqual([]);
    });
});
