/**
 * Contract for public/dwgs_osc.wasm (#1666), hermetic: the places that name the
 * export surface, the ABI version, the wave ids and the fixed memory size are
 * held in step, and the release checker rejects the modules it exists to reject.
 * The same module carries the DWGS filter (#1674, `dflt_*`), checked here too.
 *
 * The real binary is exercised by
 * src/audio-worklets/__tests__/dwgsOscVoice.realWasm.test.ts (integration tier);
 * the DSP itself by the crate's host tests (`cargo test` in dwgs-audio/).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    DWGS_OSC_ABI_VERSION as CHECKER_ABI,
    DWGS_OSC_BUDGET,
    DWGS_OSC_REQUIRED_EXPORTS as CHECKER_EXPORTS,
    DWGS_OSC_WAVE_COUNT as CHECKER_WAVES,
    checkDwgsOscModule,
} from '../../tools/check_dwgs_osc_module.mjs';
import { dwgsOscRustflags } from '../../scripts/build-dwgs-osc.mjs';
import {
    DWGS_OSC_ABI_VERSION,
    DWGS_OSC_REQUIRED_EXPORTS,
    DWGS_OSC_WAVE_COUNT,
    dwgsWaveId,
    hasDwgsOscApi,
} from '../audio-worklets/dwgsOsc';
import {
    DWGS_FILTER_ABI_VERSION,
    DWGS_FILTER_REQUIRED_EXPORTS,
    DWGS_FILTER_TYPE_ID,
    hasDwgsFilterApi,
    instantiateDwgsFilter,
} from '../audio-worklets/dwgsFilter';
import { CPP_FILTER_TYPE_ID } from '../audio-worklets/cppFilter';
import { DWGS_WAVES, DWGS_WAVEFORMS, dwgsWaveForShape, dwgsWaveIndex } from '../engines/dwgsWaves';
import { dwgsOscWasmFixture } from '../test/helpers/dwgsOscWasmFixture';

const REPO_ROOT = join(__dirname, '../..');
const source = readFileSync(join(REPO_ROOT, 'dwgs-audio/src/lib.rs'), 'utf8');
const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'emscripten/wasm_export_manifest.json'), 'utf8')) as {
    dwgsOsc: { required: string[]; requiredFilter: string[] };
};

describe('dwgs_osc export surface', () => {
    it('manifest, release checker and worklet name the same exports', () => {
        expect(CHECKER_EXPORTS).toEqual([...manifest.dwgsOsc.required, ...manifest.dwgsOsc.requiredFilter]);
        expect([...DWGS_OSC_REQUIRED_EXPORTS]).toEqual(manifest.dwgsOsc.required);
        expect([...DWGS_FILTER_REQUIRED_EXPORTS]).toEqual(manifest.dwgsOsc.requiredFilter);
    });

    it('every export is a #[no_mangle] extern "C" fn in lib.rs, and nothing else is', () => {
        const defined = [...source.matchAll(/#\[no_mangle\]\s+pub extern "C" fn (\w+)\s*\(/g)].map((m) => m[1]);
        expect(defined.sort()).toEqual([...manifest.dwgsOsc.required, ...manifest.dwgsOsc.requiredFilter].sort());
    });

    it('the ABI version and wave count agree in lib.rs, the checker and the worklet', () => {
        expect(source).toContain(`pub const ABI_VERSION: u32 = ${DWGS_OSC_ABI_VERSION};`);
        expect(CHECKER_ABI).toBe(DWGS_OSC_ABI_VERSION);
        expect(source).toContain(`pub const WAVE_COUNT: u32 = ${DWGS_OSC_WAVE_COUNT};`);
        expect(CHECKER_WAVES).toBe(DWGS_OSC_WAVE_COUNT);
    });
});

describe('the DWGS filter half of dwgs_osc (#1674)', () => {
    it('lives in the same module and binds the same ABI', () => {
        expect([...DWGS_FILTER_REQUIRED_EXPORTS]).toEqual(['dflt_buf_ptr', 'dflt_configure', 'dflt_reset', 'dflt_process']);
        expect(DWGS_FILTER_ABI_VERSION).toBe(DWGS_OSC_ABI_VERSION);
    });

    it('uses the filter type ids of every other kernel', () => {
        const name = { lp: 'LP', bp: 'BP', hp: 'HP' } as const;
        for (const [type, id] of Object.entries(DWGS_FILTER_TYPE_ID)) {
            expect(source, type).toContain(`pub const FILTER_${name[type as keyof typeof name]}: u32 = ${id};`);
        }
        expect(DWGS_FILTER_TYPE_ID).toEqual(CPP_FILTER_TYPE_ID);
    });

    it('is its own DSP: a 4-pole ladder with saturated feedback, not another kernel\'s biquad', () => {
        expect(source).toMatch(/pub struct Vcf/);
        expect(source).toMatch(/pub fn soft_clip/);
        expect(source).not.toMatch(/struct Biquad|struct Svf/);
    });

    it('the filter worklet accepts the fixture, and refuses one without the filter or with another ABI', () => {
        const ok = new WebAssembly.Instance(new WebAssembly.Module(dwgsOscWasmFixture('valid')), {});
        expect(hasDwgsFilterApi(ok.exports)).toBe(true);
        expect(instantiateDwgsFilter(new WebAssembly.Module(dwgsOscWasmFixture('valid'))).dflt_buf_ptr()).toBe(512);
        const broken = new WebAssembly.Instance(new WebAssembly.Module(dwgsOscWasmFixture('missing-filter')), {});
        expect(hasDwgsFilterApi(broken.exports)).toBe(false);
        expect(() => instantiateDwgsFilter(new WebAssembly.Module(dwgsOscWasmFixture('missing-filter')))).toThrow(/dflt_\* exports/);
        expect(() => instantiateDwgsFilter(new WebAssembly.Module(dwgsOscWasmFixture('wrong-abi')))).toThrow(/ABI 1, worklet expects 2/);
    });
});

describe('DWGS wave ids (persisted: append only)', () => {
    it('DWGS_WAVES is the kernel wave table, index for index', () => {
        // `pub const WAVE_<NAME>: u32 = <id>;` for every wave, noise included.
        const kernel = [...source.matchAll(/pub const WAVE_([A-Z]+): u32 = (\d+);/g)]
            .filter(([, n]) => n !== 'COUNT')
            .map(([, n, id]) => [Number(id), n.toLowerCase()] as const)
            .sort((a, b) => a[0] - b[0]);
        expect(kernel.map(([id]) => id)).toEqual(DWGS_WAVES.map((_, i) => i));
        expect(kernel.map(([, n]) => n)).toEqual(DWGS_WAVES.map((w) => w.suffix));
        expect(DWGS_WAVES).toHaveLength(DWGS_OSC_WAVE_COUNT);
    });

    it('the panel sources are all there: saw, square, noise and the digital waves', () => {
        expect(DWGS_WAVES.filter((w) => w.source !== 'digital').map((w) => w.suffix)).toEqual(['saw', 'sqr', 'noise']);
        expect(DWGS_WAVES.filter((w) => w.source === 'digital')).toHaveLength(14);
        expect(DWGS_WAVEFORMS).toEqual(DWGS_WAVES.map((w) => `dwgs-${w.suffix}`));
        expect(new Set(DWGS_WAVES.map((w) => w.short)).size).toBe(DWGS_WAVES.length);
    });

    it('maps names and basic shapes onto kernel ids', () => {
        expect(dwgsWaveIndex('saw')).toBe(0);
        expect(dwgsWaveIndex('noise')).toBe(16);
        expect(dwgsWaveIndex('nope')).toBe(-1);
        expect(dwgsWaveIndex(undefined)).toBe(-1);
        expect(dwgsWaveForShape('sin')).toBe(dwgsWaveIndex('sine'));
        expect(dwgsWaveForShape('sqr')).toBe(dwgsWaveIndex('sqr'));
        expect(dwgsWaveId(3.2)).toBe(3);
        expect(dwgsWaveId(99)).toBe(0);
        expect(dwgsWaveId(Number.NaN)).toBe(0);
    });
});

describe('dwgs_osc fixed memory and scalar build (BUILD_NOTES#dwgs-osc)', () => {
    it('the build fixes the memory from the budget and never asks for SIMD', () => {
        const flags = dwgsOscRustflags().join(' ');
        const bytes = DWGS_OSC_BUDGET.initialMemoryPages * 65536;
        expect(flags).toContain(`--initial-memory=${bytes}`);
        expect(flags).toContain(`--max-memory=${bytes}`);
        expect(flags).toContain(`-zstack-size=${DWGS_OSC_BUDGET.stackSizeBytes}`);
        expect(flags).not.toMatch(/simd128/);
    });

    it('keeps the budget page-sized and the static data inside it', () => {
        expect(Number.isInteger(DWGS_OSC_BUDGET.initialMemoryPages)).toBe(true);
        // freq + out + the DWGS filter's buffer (3 x 1024 f32) + 16 waves x 96 harmonics (f64) + stack.
        const statics = 3 * 1024 * 4 + 16 * 96 * 8;
        expect(source).toContain('pub const H_MAX: usize = 96;');
        expect(source).toContain('pub const TONAL_WAVES: usize = 16;');
        expect(statics + DWGS_OSC_BUDGET.stackSizeBytes).toBeLessThan(DWGS_OSC_BUDGET.initialMemoryPages * 65536);
    });
});

describe('tools/check_dwgs_osc_module.mjs', () => {
    it('accepts the valid fixture', () => {
        expect(checkDwgsOscModule(dwgsOscWasmFixture('valid'))).toEqual([]);
    });

    it.each([
        ['growable-memory', 'memory can grow'],
        ['simd', 'module uses v128'],
        ['wrong-abi', 'ABI version 1'],
        ['wrong-wave-count', 'dwgs_wave_count() is 16'],
        ['missing-render', 'missing exports: dwgs_render'],
        ['missing-filter', 'missing exports: dflt_process'],
        ['accepts-any-filter-type', 'dflt_configure accepted an unknown filter type'],
        ['silent', 'wave 0 rendered silence'],
    ] as const)('rejects %s', (variant, message) => {
        expect(checkDwgsOscModule(dwgsOscWasmFixture(variant)).join('\n')).toContain(message);
    });

    it('the worklet accepts the export surface the checker accepts', () => {
        const instance = new WebAssembly.Instance(new WebAssembly.Module(dwgsOscWasmFixture('valid')), {});
        expect(hasDwgsOscApi(instance.exports)).toBe(true);
        const broken = new WebAssembly.Instance(new WebAssembly.Module(dwgsOscWasmFixture('missing-render')), {});
        expect(hasDwgsOscApi(broken.exports)).toBe(false);
    });
});
