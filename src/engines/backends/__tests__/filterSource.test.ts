// The pure policy of the selectable filter (#1663): ids, validation, and what a
// host engine that bakes a filter into its table is asked to do.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_FILTER_SOURCE,
    DEFAULT_FILTER_TYPE,
    FILTER_SOURCES,
    FILTER_SOURCE_DESCRIPTIONS,
    FILTER_SOURCE_LABELS,
    FILTER_TYPES,
    FILTER_TYPE_ID,
    FLAT_RESONANCE,
    STAGED_FILTER_SOURCES,
    biquadTypeFor,
    filterSourceIssueId,
    hostFilterRequest,
    kernelResonance,
    maxFilterCutoff,
    resetFilterSourceWarningsForTests,
    resolveFilterSource,
    resolveFilterType,
} from '../filterSource';
import { WAM_FILTER_TYPE_ID } from '../../../audio-worklets/wamFilter';
import { RUST_FILTER_TYPE_ID } from '../../../audio-worklets/rustFilter';
import { CPP_FILTER_TYPE_ID } from '../../../audio-worklets/cppFilter';
import { DWGS_FILTER_TYPE_ID } from '../../../audio-worklets/dwgsFilter';
import { BackendRegistry, filterTypeRefusal } from '../BackendRegistry';
import type { BackendCapabilities, GenerateRequest, OscillatorBackend } from '../OscillatorBackend';

const RATE = 48000;
const PARAMS = { filterCutoff: 1800, filterResonance: 4 };

beforeEach(() => {
    resetFilterSourceWarningsForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('ids', () => {
    it('are the same numbers in the kernel (biquad.ts), the worklet contract and the TS policy', () => {
        // FILTER_LP / FILTER_BP / FILTER_HP in assembly/biquad.ts are 0 / 1 / 2.
        expect(FILTER_TYPE_ID).toEqual({ lp: 0, bp: 1, hp: 2 });
        expect(WAM_FILTER_TYPE_ID).toEqual(FILTER_TYPE_ID);
        expect(FILTER_TYPES).toEqual(['lp', 'bp', 'hp']);
        expect(FILTER_SOURCES).toEqual(['native', 'wam', 'rust', 'cpp', 'dwgs', 'webgpu']);
        // The GPU's filter renders tables; it is not a worklet stage, so it is not in this list.
        expect(STAGED_FILTER_SOURCES).toEqual(['wam', 'rust', 'cpp', 'dwgs']);
        // The Rust kernel's response ids are the same numbers (FILTER_LP/BP/HP in rust-audio/src/lib.rs).
        expect(RUST_FILTER_TYPE_ID).toEqual(FILTER_TYPE_ID);
        // And the C++ kernel's (kFilterLp/Bp/Hp in emscripten/cpp_osc.cpp).
        expect(CPP_FILTER_TYPE_ID).toEqual(FILTER_TYPE_ID);
        // And the DWGS kernel's (FILTER_LP/BP/HP in dwgs-audio/src/lib.rs).
        expect(DWGS_FILTER_TYPE_ID).toEqual(FILTER_TYPE_ID);
    });

    it('label the AssemblyScript source "WASM OSC" and the Rust one "Rust", the same names as their oscillators', () => {
        expect(FILTER_SOURCE_LABELS.wam).toBe('WASM OSC');
        expect(FILTER_SOURCE_LABELS.rust).toBe('Rust');
        expect(FILTER_SOURCE_LABELS.cpp).toBe('C++');
        expect(FILTER_SOURCE_LABELS.dwgs).toBe('DWGS');
        expect(FILTER_SOURCE_LABELS.webgpu).toBe('WebGPU');
    });

    it('give every source a description and its own degradation id', () => {
        for (const source of FILTER_SOURCES) {
            expect(FILTER_SOURCE_DESCRIPTIONS[source].length).toBeGreaterThan(10);
        }
        const ids = FILTER_SOURCES.map(filterSourceIssueId);
        expect(new Set(ids).size).toBe(FILTER_SOURCES.length);
    });

    it('map to the BiquadFilterNode type that is the same response', () => {
        expect(biquadTypeFor('lp')).toBe('lowpass');
        expect(biquadTypeFor('bp')).toBe('bandpass');
        expect(biquadTypeFor('hp')).toBe('highpass');
    });
});

describe('resolve', () => {
    it('treats absent as the default (every song saved before this field)', () => {
        expect(resolveFilterType(undefined)).toBe(DEFAULT_FILTER_TYPE);
        expect(resolveFilterSource(undefined)).toBe(DEFAULT_FILTER_SOURCE);
        expect(resolveFilterType(null)).toBe('lp');
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('passes valid values through', () => {
        for (const t of FILTER_TYPES) expect(resolveFilterType(t)).toBe(t);
        for (const s of FILTER_SOURCES) expect(resolveFilterSource(s)).toBe(s);
    });

    it('does not hide an unknown value: it falls back to the default and warns, once', () => {
        expect(resolveFilterType('notch')).toBe('lp');
        expect(resolveFilterType('notch')).toBe('lp');
        expect(resolveFilterSource('wam2')).toBe('native');
        expect(console.warn).toHaveBeenCalledTimes(2);
        expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('"notch"');
    });
});

describe('kernelResonance', () => {
    it('matches the BiquadFilterNode: dB for low / high pass, linear for band pass', () => {
        expect(kernelResonance('lp', 0)).toBeCloseTo(1, 12);
        expect(kernelResonance('lp', 6)).toBeCloseTo(10 ** (6 / 20), 12);
        expect(kernelResonance('hp', 12)).toBeCloseTo(10 ** (12 / 20), 12);
        expect(kernelResonance('bp', 6)).toBe(6);
    });

    it('never hands the kernel zero, a negative or a NaN Q', () => {
        expect(kernelResonance('bp', 0)).toBe(0.1);
        expect(kernelResonance('bp', -3)).toBe(0.1);
        expect(kernelResonance('bp', Number.NaN)).toBe(FLAT_RESONANCE);
        expect(kernelResonance('lp', Number.POSITIVE_INFINITY)).toBe(FLAT_RESONANCE);
    });
});

describe('hostFilterRequest', () => {
    const open = { cutoff: maxFilterCutoff(RATE), resonance: FLAT_RESONANCE, filterType: 'lp' };

    it('keeps the legacy double lowpass for native + lp (saved songs keep their sound)', () => {
        expect(hostFilterRequest(PARAMS, { source: 'native', type: 'lp' }, RATE)).toEqual({
            cutoff: 1800,
            resonance: 4,
            filterType: 'lp',
        });
    });

    it('clamps the legacy request the way the voice always did', () => {
        expect(hostFilterRequest({ filterCutoff: 5, filterResonance: 0 }, { source: 'native', type: 'lp' }, RATE))
            .toMatchObject({ cutoff: 20, resonance: 0.1 });
        expect(hostFilterRequest({ filterCutoff: 99999, filterResonance: 1 }, { source: 'native', type: 'lp' }, RATE).cutoff)
            .toBe(RATE / 2.1);
    });

    it.each([
        [{ source: 'native', type: 'bp' }],
        [{ source: 'native', type: 'hp' }],
        [{ source: 'wam', type: 'lp' }],
        [{ source: 'wam', type: 'bp' }],
        [{ source: 'wam', type: 'hp' }],
        [{ source: 'rust', type: 'lp' }],
        [{ source: 'rust', type: 'bp' }],
        [{ source: 'rust', type: 'hp' }],
        [{ source: 'cpp', type: 'lp' }],
        [{ source: 'cpp', type: 'bp' }],
        [{ source: 'cpp', type: 'hp' }],
        [{ source: 'dwgs', type: 'lp' }],
        [{ source: 'dwgs', type: 'bp' }],
        [{ source: 'dwgs', type: 'hp' }],
    ] as const)('opens the host\'s own filter for %j (the voice\'s filter does the work)', (effective) => {
        expect(hostFilterRequest(PARAMS, effective, RATE)).toEqual(open);
    });
});

describe('filterTypeRefusal (no silent substitution at the registry)', () => {
    const backend = (filterTypes?: BackendCapabilities['filterTypes']): OscillatorBackend =>
        ({ id: 'wam', capabilities: { simd: false, threads: false, offline: true, polyphony: 1, shapes: ['saw'], filterTypes } }) as unknown as OscillatorBackend;
    const req = (filterType?: GenerateRequest['filterType']): GenerateRequest =>
        ({ frequency: 440, duration: 1, sampleRate: RATE, shape: 'saw', cutoff: 1000, resonance: 1, filterType });

    it('lets a backend that bakes the asked response through', () => {
        expect(filterTypeRefusal(backend(['lp', 'bp', 'hp']), req('hp'))).toBeNull();
    });

    it('refuses a backend that would bake a lowpass for a high pass', () => {
        expect(filterTypeRefusal(backend(['lp']), req('hp'))).toMatch(/cannot bake a "hp" filter \(only lp\)/);
        expect(filterTypeRefusal(backend(['lp']), req('bp'))).not.toBeNull();
    });

    it('treats an absent filterType as lp', () => {
        expect(filterTypeRefusal(backend(['lp']), req())).toBeNull();
        expect(filterTypeRefusal(backend(['bp', 'hp']), req())).toMatch(/"lp"/);
    });

    it('never refuses a backend that bakes no filter at all: it ignores the fields', () => {
        expect(filterTypeRefusal(backend(undefined), req('hp'))).toBeNull();
    });

    it('is applied by BackendRegistry.generate: a lowpass-only backend is passed over for a high pass, and the drop is recorded', async () => {
        const mk = (id: 'wam' | 'wav', filterTypes: BackendCapabilities['filterTypes']) => {
            const generate = vi.fn(async () => new Float32Array(8).fill(1));
            return {
                backend: {
                    id, label: id, isSupported: true, isReady: true,
                    capabilities: { simd: false, threads: false, offline: true, polyphony: 1, shapes: ['saw'], filterTypes },
                    init: async () => ({ ok: true, backendId: id }),
                    supportsShape: () => true,
                    generate,
                    dispose: () => {},
                } as unknown as OscillatorBackend,
                generate,
            };
        };
        // `wam` heads this two-backend chain but (as a stand-in) can only bake a lowpass;
        // `wav` bakes no filter at all, so it ignores the request and can serve any type.
        const lowpassOnly = mk('wam', ['lp']);
        const noFilter = mk('wav', undefined);
        const registry = new BackendRegistry();
        registry.register(lowpassOnly.backend);
        registry.register(noFilter.backend);
        const base = { frequency: 440, duration: 1, sampleRate: RATE, shape: 'saw', cutoff: 1000, resonance: 1 } as const;

        const lp = await registry.generate({ ...base });
        expect(lp?.backendId).toBe('wam');

        const hp = await registry.generate({ ...base, filterType: 'hp' });
        expect(hp?.backendId).toBe('wav');
        expect(lowpassOnly.generate).toHaveBeenCalledTimes(1); // the lowpass call only
        expect(registry.getLastResolution()).toMatchObject({ degraded: true, active: 'wav', requested: 'wam' });
        expect(registry.getLastResolution()?.reason).toContain('wam: cannot bake a "hp" filter (only lp)');
    });
});
