/**
 * Import-graph + selection guard for the oscillator families (#1294).
 *
 * The failure mode this exists to prevent: an "engine" that is a waveform
 * prefix, a panel and a HUD badge, but whose only implementation is a
 * main-thread `generate()` looped through an `AudioBufferSourceNode` — or, in
 * `cpp-*`'s case, no implementation at all, falling through to `OscillatorNode`
 * while the UI claimed otherwise. Same class of hazard as the shadow playback
 * stacks guarded by `noDuplicateSamplerEntry.test.ts` (#1134 / #1155).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { BACKEND_FALLBACK_ORDER } from '../OscillatorBackend';
import { ENGINE_CATALOG } from '../engineCatalog';
import {
    LEGACY_WAVEFORM_ALIASES,
    parseWaveform,
    type OscEngineId,
} from '../../../utils/waveformParser';
import { getWaveformsForType } from '../../../types';
import type { OscillatorType, Waveform } from '../../../types';

const ROOT = resolve(__dirname, '../../../..');
const SRC = join(ROOT, 'src');

/** Every waveform the rack can actually offer, from the type-driven selector. */
const OSCILLATOR_TYPES: OscillatorType[] = [
    'javascript',
    'pcm',
    'open303',
    'jc303',
    'prophecy',
    'pyodide',
    'webgpu',
    'wam',
];
const ALL_WAVEFORMS: Waveform[] = OSCILLATOR_TYPES.flatMap((t) => getWaveformsForType(t));

describe('every waveform family resolves to a documented engine', () => {
    it('maps each parseWaveform engine id to a catalog entry', () => {
        const engineIds = Object.keys(ENGINE_CATALOG) as OscEngineId[];
        for (const waveform of ALL_WAVEFORMS) {
            const { engine } = parseWaveform(waveform);
            expect(engineIds, `"${waveform}" parsed to unknown engine "${engine}"`).toContain(engine);
        }
    });

    it('never silently falls through to the JS oscillator', () => {
        // A non-`js` prefix that parses to `js` is exactly the `cpp-*` bug:
        // the selector offered a family the renderer had never heard of.
        for (const waveform of ALL_WAVEFORMS) {
            const { engine } = parseWaveform(waveform);
            const isPlainJs = !waveform.includes('-');
            expect(engine === 'js', `"${waveform}" fell through to the JS oscillator`).toBe(isPlainJs);
        }
    });

    it('routes every backend-kind engine to an id BackendRegistry knows', () => {
        for (const [engine, entry] of Object.entries(ENGINE_CATALOG)) {
            if (entry.kind !== 'backend') continue;
            expect(
                BACKEND_FALLBACK_ORDER,
                `engine "${engine}" starts at backend "${entry.backendId}", which is not in the fallback order`,
            ).toContain(entry.backendId);
        }
    });

    it('rewrites retired waveform ids onto live ones, and reports the rewrite', () => {
        for (const [legacy, replacement] of Object.entries(LEGACY_WAVEFORM_ALIASES)) {
            const parsed = parseWaveform(legacy as Waveform);
            expect(parsed.legacyFrom).toBe(legacy);
            expect(parsed.engine).toBe(parseWaveform(replacement).engine);
            // And the replacement must itself be a live family.
            expect(ALL_WAVEFORMS).toContain(replacement);
        }
    });

    it('no longer offers the retired rust-* / cpp-* families in the rack', () => {
        for (const waveform of ALL_WAVEFORMS) {
            expect(waveform.startsWith('rust-')).toBe(false);
            expect(waveform.startsWith('cpp-')).toBe(false);
        }
    });
});

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/**
 * Oscillator engine modules that are allowed to exist. Adding a file here is a
 * deliberate act: a new entry must either drive an AudioWorklet or be reachable
 * only through an `OscillatorBackend` adapter, never be a fresh
 * `generate()`-into-a-buffer family bolted onto `VoiceManager`.
 */
const ALLOWED_ENGINE_MODULES = [
    'Open303Oscillator.ts',
    'ProphecyOscillator.ts',
    'WasmOscillator.ts',
    'WebGpuOscillator.ts',
].sort();

describe('no new decorative oscillator families', () => {
    it('keeps src/engines/*Oscillator.ts to the allowlist', () => {
        const found = readdirSync(join(SRC, 'engines'))
            .filter((f) => /Oscillator\.tsx?$/.test(f))
            .sort();
        expect(found).toEqual(ALLOWED_ENGINE_MODULES);
    });

    it('has no CppOscillator, and no promise of one', () => {
        expect(existsSync(join(SRC, 'engines', 'CppOscillator.ts'))).toBe(false);
        const offenders = walk(SRC).filter((f) => /CppOscillator/.test(readFileSync(f, 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('has no RustOscillator (rust-audio/ is a bench crate, not a voice)', () => {
        expect(existsSync(join(SRC, 'engines', 'RustOscillator.ts'))).toBe(false);
        const offenders = walk(SRC).filter((f) => /RustOscillator/.test(readFileSync(f, 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('keeps VoiceManager free of per-engine generate()/buffer branches', () => {
        const source = readFileSync(join(SRC, 'engines', 'VoiceManager.ts'), 'utf8');

        // No concrete engine may be imported here — selection goes through the
        // registry, which is the whole point of #1294.
        expect(source).not.toMatch(/from '\.\/\w*Oscillator'/);
        // Exactly one place builds a looped source, fed by BackendRegistry.
        const bufferSources = source.match(/createBufferSource\(\)/g) ?? [];
        expect(bufferSources).toHaveLength(1);
        expect(source).toContain('renderLoopFrom');
        // And no resurrected per-prefix ladder.
        expect(source).not.toMatch(/parsed\.engine === '(wam|rust|cpp|wgsl|pyodide|wav)'/);
    });
});
