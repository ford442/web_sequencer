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
import { getWaveformsForType } from '../../../components/oscillatorThemes';
import { macroEngineForWaveform } from '../../MacroParams';
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
    'rust',
    'macro',
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

    it('gives every macro model a live fallback family (a part that cannot run the engine is never silent)', () => {
        for (const waveform of getWaveformsForType('macro')) {
            const { engine } = parseWaveform(waveform);
            expect(engine).toBe('macro');
            const fallback = macroEngineForWaveform(waveform)?.fallback;
            expect(fallback, `${waveform} has no fallback`).toBeDefined();
            expect(parseWaveform(fallback!).engine).toBe('js');
        }
    });

    it('no longer offers the retired cpp-* family in the rack', () => {
        for (const waveform of ALL_WAVEFORMS) {
            expect(waveform.startsWith('cpp-')).toBe(false);
        }
    });

    it('plays rust-* on the Rust backend, not a rewrite onto wam-* (#1664)', () => {
        const rust = getWaveformsForType('rust');
        expect(rust).toEqual(['rust-saw', 'rust-sqr', 'rust-tri', 'rust-sin']);
        for (const waveform of rust) {
            const parsed = parseWaveform(waveform);
            expect(parsed.engine).toBe('rust');
            expect(parsed.legacyFrom).toBeUndefined();
        }
        expect(ENGINE_CATALOG.rust).toEqual({ kind: 'backend', backendId: 'rust', label: 'Rust OSC' });
        // Songs saved before #1294 load onto the live family as-is.
        expect(Object.keys(LEGACY_WAVEFORM_ALIASES).filter((k) => k.startsWith('rust-'))).toEqual([]);
        // A rust-* part that cannot get a worklet drops one step, to the AS table.
        const order = [...BACKEND_FALLBACK_ORDER];
        expect(order.indexOf('wam')).toBe(order.indexOf('rust') + 1);
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
    // Drives the macro-processor AudioWorklet (hyphon_native macro_*).
    'MacroOscillator.ts',
    'Open303Oscillator.ts',
    'ProphecyOscillator.ts',
    // Drives the rust-osc-processor AudioWorklet (rust-audio/, #1664).
    'RustOscillator.ts',
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

    it('RustOscillator drives an AudioWorklet and renders nothing on the main thread (#1664)', () => {
        // #1294 removed rust-* for being a main-thread Float32Array looped
        // through a buffer source. It may only come back as a worklet voice.
        const source = readFileSync(join(SRC, 'engines', 'RustOscillator.ts'), 'utf8');
        expect(source).toContain('new AudioWorkletNode(');
        expect(source).not.toMatch(/createBuffer(Source)?\(/);
        expect(source).not.toMatch(/new Float32Array\(/);
        expect(source).not.toMatch(/\.exports\b/); // never instantiates the kernel here
        // And nothing else in src/ renders rust-* any other way.
        const kernelUsers = walk(SRC).filter((f) => /\.rosc_render\(/.test(readFileSync(f, 'utf8')));
        // The realtime voice is the worklet; the only other caller is the
        // offline (export/bounce) renderer, which runs the same kernel into a
        // buffer that is played once — a pre-render, like WebGPU's.
        expect(kernelUsers.map((f) => f.slice(SRC.length + 1)).sort()).toEqual([
            'audio-worklets/rust-osc-processor.ts',
            'audio/offline/OfflineRustOscEngine.ts',
        ]);
        // And the realtime note path cannot reach the offline renderer.
        const voiceManager = readFileSync(join(SRC, 'engines', 'VoiceManager.ts'), 'utf8');
        expect(voiceManager).not.toMatch(/OfflineRustOsc|renderRustOsc/);
    });

    it('keeps VoiceManager free of per-engine generate()/buffer branches', () => {
        const source = readFileSync(join(SRC, 'engines', 'VoiceManager.ts'), 'utf8');

        // No concrete engine may be imported here — selection goes through the
        // registry, which is the whole point of #1294.
        expect(source).not.toMatch(/from '\.\/\w*Oscillator'/);
        // Exactly one place builds a looped source, fed by BackendRegistry.
        const bufferSources = source.match(/createBufferSource\(\)/g) ?? [];
        expect(bufferSources).toHaveLength(1);
        expect(source).toContain('registry.sourceFrom(');
        // Live worklet sources arrive through the contract type, never by name.
        expect(source).not.toMatch(/AudioWorkletNode|rust-osc|RustOsc/);
        // And no resurrected per-prefix ladder.
        expect(source).not.toMatch(/parsed\.engine === '(wam|rust|cpp|wgsl|pyodide|wav)'/);
        expect(source).not.toMatch(/backendId === '(rust|wam|webgpu|pyodide|wav)'/);
    });
});
