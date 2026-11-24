/**
 * Import-graph + selection guard for the oscillator families (#1294).
 *
 * The failure mode this exists to prevent: an "engine" that is a waveform
 * prefix, a panel and a HUD badge, but whose only implementation is a
 * main-thread `generate()` looped through an `AudioBufferSourceNode` — or, in
 * `cpp-*`'s case, no implementation at all, falling through to `OscillatorNode`
 * while the UI claimed otherwise. Same class of hazard as the shadow playback
 * stacks guarded by `noDuplicateSamplerEntry.test.ts` (#1134 / #1155).
 *
 * `cpp-*` came back in #1665 the only way this file allows: a real C++ kernel
 * (emscripten/cpp_osc.cpp → public/cpp_osc.wasm) running in an AudioWorklet.
 * `dwgs-*` (#1666), which had been panel art and nothing else, arrived the same
 * way: a Rust kernel (dwgs-audio/ → public/dwgs_osc.wasm) in an AudioWorklet.
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
import { DWGS_WAVES } from '../../dwgsWaves';
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
    'cpp',
    'dwgs',
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

    it('plays cpp-* on the C++ backend, not a rewrite onto wam-* (#1665)', () => {
        const cpp = getWaveformsForType('cpp');
        expect(cpp).toEqual(['cpp-saw', 'cpp-sqr', 'cpp-tri', 'cpp-sin']);
        for (const waveform of cpp) {
            const parsed = parseWaveform(waveform);
            expect(parsed.engine).toBe('cpp');
            expect(parsed.legacyFrom).toBeUndefined();
        }
        expect(ENGINE_CATALOG.cpp).toEqual({ kind: 'backend', backendId: 'cpp', label: 'C++ OSC' });
        // Songs saved with cpp-saw/sqr/tri/sin load onto the live family as-is;
        // only cpp-rand (never a sound of its own) is rewritten, onto the C++ saw.
        const cppAliases = Object.entries(LEGACY_WAVEFORM_ALIASES).filter(([k]) => k.startsWith('cpp-'));
        expect(cppAliases).toEqual([['cpp-rand', 'cpp-saw']]);
        // A cpp-* part that cannot get a worklet drops one step, to the AS table —
        // never to OscillatorNode directly.
        const order = [...BACKEND_FALLBACK_ORDER];
        expect(order.indexOf('wam')).toBe(order.indexOf('cpp') + 1);
    });

    it('plays dwgs-* on the DWGS backend, each wave by name, with a basic-shape fallback (#1666)', () => {
        const dwgs = getWaveformsForType('dwgs');
        expect(dwgs).toEqual(DWGS_WAVES.map((w) => `dwgs-${w.suffix}`));
        expect(new Set(dwgs).size).toBe(dwgs.length);
        for (const [i, waveform] of dwgs.entries()) {
            const parsed = parseWaveform(waveform);
            expect(parsed.engine).toBe('dwgs');
            expect(parsed.variant).toBe(DWGS_WAVES[i].suffix);
            expect(parsed.shape).toBe(DWGS_WAVES[i].fallback);
            expect(parsed.legacyFrom).toBeUndefined();
        }
        expect(ENGINE_CATALOG.dwgs).toEqual({ kind: 'backend', backendId: 'dwgs', label: 'DWGS' });
        // Entry-only, at the head of the order: a dwgs-* part that cannot get its
        // worklet walks every live engine below; nothing above can fall onto it.
        expect(BACKEND_FALLBACK_ORDER[0]).toBe('dwgs');
        // An unknown DWGS wave plays the DWGS saw rather than leaving the family.
        expect(parseWaveform('dwgs-nope')).toEqual({ engine: 'dwgs', shape: 'saw', variant: 'saw', legacyFrom: undefined });
        // Basic-wave ids carry no variant.
        expect(parseWaveform('rust-saw').variant).toBeUndefined();
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
        // A rust-* part that cannot get the Rust kernel (no WASM SIMD) drops to the
        // scalar C++ kernel — still a live band-limited voice — then the AS table.
        const order = [...BACKEND_FALLBACK_ORDER];
        expect(order.indexOf('cpp')).toBe(order.indexOf('rust') + 1);
        expect(order.indexOf('wam')).toBe(order.indexOf('rust') + 2);
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
    // Drives the cpp-osc-processor AudioWorklet (emscripten/cpp_osc.cpp, #1665).
    'CppOscillator.ts',
    // Drives the dwgs-osc-processor AudioWorklet (dwgs-audio/, #1666).
    'DwgsOscillator.ts',
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

    it('CppOscillator drives an AudioWorklet and renders nothing on the main thread (#1665)', () => {
        // cpp-* once had no renderer at all. It exists now only as a worklet
        // voice; the bridge must not grow a main-thread render on the side.
        const source = readFileSync(join(SRC, 'engines', 'CppOscillator.ts'), 'utf8');
        expect(source).toContain('new AudioWorkletNode(');
        expect(source).not.toMatch(/createBuffer(Source)?\(/);
        expect(source).not.toMatch(/new Float32Array\(/);
        expect(source).not.toMatch(/\.exports\b/); // never instantiates the kernel here
        // And nothing else in src/ renders cpp-* any other way.
        const kernelUsers = walk(SRC).filter((f) => /\.cosc_render\(/.test(readFileSync(f, 'utf8')));
        expect(kernelUsers.map((f) => f.slice(SRC.length + 1)).sort()).toEqual([
            'audio-worklets/cpp-osc-processor.ts',
            'audio/offline/OfflineCppOscEngine.ts',
        ]);
        const voiceManager = readFileSync(join(SRC, 'engines', 'VoiceManager.ts'), 'utf8');
        expect(voiceManager).not.toMatch(/OfflineCppOsc|renderCppOsc/);
    });

    it('DwgsOscillator drives an AudioWorklet and renders nothing on the main thread (#1666)', () => {
        const source = readFileSync(join(SRC, 'engines', 'DwgsOscillator.ts'), 'utf8');
        expect(source).toContain('new AudioWorkletNode(');
        expect(source).not.toMatch(/createBuffer(Source)?\(/);
        expect(source).not.toMatch(/new Float32Array\(/);
        expect(source).not.toMatch(/\.exports\b/); // never instantiates the kernel here
        const kernelUsers = walk(SRC).filter((f) => /\.dwgs_render\(/.test(readFileSync(f, 'utf8')));
        expect(kernelUsers.map((f) => f.slice(SRC.length + 1)).sort()).toEqual([
            'audio-worklets/dwgs-osc-processor.ts',
            'audio/offline/OfflineDwgsOscEngine.ts',
        ]);
        const voiceManager = readFileSync(join(SRC, 'engines', 'VoiceManager.ts'), 'utf8');
        expect(voiceManager).not.toMatch(/OfflineDwgsOsc|renderDwgsOsc/);
    });

    it('builds the DWGS kernel as its own scalar module (#1666)', () => {
        const build = readFileSync(join(ROOT, 'scripts', 'build-dwgs-osc.mjs'), 'utf8');
        expect(build).not.toMatch(/simd128/);
        expect(readFileSync(join(ROOT, 'emscripten', 'build.sh'), 'utf8')).not.toMatch(/dwgs/);
        expect(readFileSync(join(ROOT, 'dwgs-audio', 'src', 'lib.rs'), 'utf8')).toMatch(/#!\[cfg_attr\(not\(test\), no_std\)\]/);
    });

    it('builds the C++ kernel as its own module, not into hyphon_native (#1665)', () => {
        // The voice module's heap is sized for its voices; a per-voice
        // oscillator instance must not share or multiply it.
        const build = readFileSync(join(ROOT, 'emscripten', 'build.sh'), 'utf8');
        expect(build).not.toMatch(/cpp_osc/);
        expect(existsSync(join(ROOT, 'emscripten', 'build_cpp_osc.sh'))).toBe(true);
        expect(readFileSync(join(ROOT, 'emscripten', 'build_cpp_osc.sh'), 'utf8')).toMatch(/STANDALONE_WASM=1/);
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

    it('the WASM OSC filter is a stage, not an oscillator family: it filters in a worklet and never renders on the main thread (#1663)', () => {
        const bridge = readFileSync(join(SRC, 'engines', 'WamFilter.ts'), 'utf8');
        expect(bridge).toContain('new AudioWorkletNode(');
        expect(bridge).not.toMatch(/createBuffer(Source)?\(/);
        expect(bridge).not.toMatch(/new Float32Array\(/);
        expect(bridge).not.toMatch(/\.exports\b/); // never instantiates the kernel here
        // Only the worklet runs the streaming kernel.
        const kernelUsers = walk(SRC).filter((f) => /\.abiVersion\(\)/.test(readFileSync(f, 'utf8')));
        expect(kernelUsers.map((f) => f.slice(SRC.length + 1)).sort()).toEqual(['audio-worklets/wam-filter-processor.ts']);
        // It is not a backend in the fallback chain: nothing falls onto a filter.
        expect(BACKEND_FALLBACK_ORDER as readonly string[]).not.toContain('wamFilter');
        // And it shares its DSP with the oscillator's baked filter rather than copying it.
        const biquad = readFileSync(join(ROOT, 'assembly', 'biquad.ts'), 'utf8');
        for (const entry of ['oscillators.ts', 'wamFilter.ts']) {
            expect(readFileSync(join(ROOT, 'assembly', entry), 'utf8'), entry).toMatch(/from '\.\/biquad'/);
        }
        expect(biquad).toMatch(/export function setCoefficients/);
        expect(readFileSync(join(ROOT, 'assembly', 'oscillators.ts'), 'utf8')).not.toMatch(/Math\.cos\(w0\)/);
    });

    it('the Rust filter is a stage in the oscillator\'s own module: only its worklet runs the kernel, the main thread never filters (#1672)', () => {
        const bridge = readFileSync(join(SRC, 'engines', 'RustFilter.ts'), 'utf8');
        expect(bridge).not.toMatch(/new Float32Array\(/);
        expect(bridge).not.toMatch(/createBuffer(Source)?\(/);
        expect(bridge).not.toMatch(/\.exports\b/);
        const stage = readFileSync(join(SRC, 'engines', 'WamFilter.ts'), 'utf8');
        expect(stage).toContain('new AudioWorkletNode(');
        // Only the worklet calls the streaming filter export.
        const kernelUsers = walk(SRC).filter((f) => /\.rflt_process\(/.test(readFileSync(f, 'utf8')));
        expect(kernelUsers.map((f) => f.slice(SRC.length + 1)).sort()).toEqual(['audio-worklets/rust-filter-processor.ts']);
        // Not a backend in the fallback chain, and the realtime note path reaches it only via the stage registry.
        expect(BACKEND_FALLBACK_ORDER as readonly string[]).not.toContain('rustFilter');
        const voiceManager = readFileSync(join(SRC, 'engines', 'VoiceManager.ts'), 'utf8');
        expect(voiceManager).not.toMatch(/RustFilter|rust_osc/);
        // One module, one DSP: the filter lives in the same crate as the oscillator, not a copy of the AS biquad.
        const lib = readFileSync(join(ROOT, 'rust-audio', 'src', 'lib.rs'), 'utf8');
        expect(lib).toMatch(/pub struct Biquad/);
        expect(lib).toMatch(/pub extern "C" fn rflt_process/);
    });

    it('keeps the Safari feature intersection on both AssemblyScript filter builds: simd + bulk-memory, no GC (#1663)', () => {
        const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
        for (const name of ['build:wasm:oscillators', 'build:wasm:wamfilter']) {
            expect(scripts[name], name).toContain('--enable simd');
            expect(scripts[name], name).toContain('--enable bulk-memory');
            expect(scripts[name], name).not.toMatch(/--enable (gc|relaxed-simd|threads)\b/);
            expect(scripts[name], name).not.toContain('wasm-gc');
        }
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
        expect(source).not.toMatch(/AudioWorkletNode|rust-osc|RustOsc|cpp-osc|CppOsc|dwgs-osc|DwgsOsc/);
        // And no resurrected per-prefix ladder.
        expect(source).not.toMatch(/parsed\.engine === '(wam|rust|cpp|dwgs|wgsl|pyodide|wav)'/);
        expect(source).not.toMatch(/backendId === '(rust|cpp|dwgs|wam|webgpu|pyodide|wav)'/);
    });
});
