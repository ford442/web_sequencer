/**
 * One export manifest for all three em++ modules (#1596 follow-up P3).
 *
 * emscripten/wasm_export_manifest.json declares hyphon_native (top-level buckets),
 * `rubberband` and `mixBus`. Each build script exports exactly its section, the
 * generator types it, the module checkers hold the binaries to it, and
 * `check:native-types` fails on a TS / tool caller of a name no section declares.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportedFunctions, moduleSurface } from '../../tools/hyphon_native_exports.mjs';
import { staleGeneratedFiles, unknownExportCallers } from '../../tools/gen_hyphon_native_types.mjs';
import { RUBBERBAND_FX_EXPORTS, RUBBERBAND_STRETCHER_EXPORTS } from '../shared/rt/rubberbandExports';
import { MIX_BUS_EXPORTS } from '../shared/rt/mixBusExports';
import { RB_REQUIRED_EXPORTS } from '../audio-worklets/rubberband/stretcher';
import { RB_FX_REQUIRED_EXPORTS } from '../audio-worklets/rubberband/nativeVocalFx';
import { MIX_BUS_REQUIRED_EXPORTS } from '../audio/offline/mixBus/mixBusKernel';

const REPO_ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const manifest = JSON.parse(read('emscripten/wasm_export_manifest.json')) as {
    rubberband: { required: string[] };
    mixBus: { required: string[]; runtime?: string[] };
};

describe('wasm_export_manifest.json covers every em++ module', () => {
    it('has a section per standalone module, each with a required list', () => {
        expect(manifest.rubberband.required.length).toBeGreaterThan(0);
        expect(manifest.mixBus.required.length).toBeGreaterThan(0);
        // No name is declared by two modules.
        const hyphon = moduleSurface(manifest, 'hyphonNative');
        const all = [...hyphon.required, ...hyphon.optional, ...manifest.mixBus.required,
            ...manifest.rubberband.required.filter((n) => n !== 'malloc' && n !== 'free')];
        expect(new Set(all).size).toBe(all.length);
    });

    it('each build script exports its own section, not a hand-kept array', () => {
        expect(read('emscripten/build.sh')).toContain('hyphon_native_exports.mjs" --profile "$BUILD_PROFILE"');
        expect(read('emscripten/build_rubberband.sh')).toContain('hyphon_native_exports.mjs" --module rubberband');
        expect(read('emscripten/build_mix_bus.sh')).toContain('hyphon_native_exports.mjs" --module mixBus');
        expect(exportedFunctions(manifest, 'release', 'rubberband')).toEqual(manifest.rubberband.required.map((n) => `_${n}`));
        expect(exportedFunctions(manifest, 'release', 'mixBus')).toEqual(manifest.mixBus.required.map((n) => `_${n}`));
    });

    it('the generated TS lists are the sections, and the callers use them', () => {
        expect(staleGeneratedFiles()).toEqual([]);
        const rb = manifest.rubberband.required;
        expect([...RUBBERBAND_STRETCHER_EXPORTS]).toEqual(rb.filter((n) => /^rb_(?!fx_)/.test(n)).map((n) => `_${n}`));
        expect([...RUBBERBAND_FX_EXPORTS]).toEqual(rb.filter((n) => n.startsWith('rb_fx_')).map((n) => `_${n}`));
        expect([...MIX_BUS_EXPORTS]).toEqual(manifest.mixBus.required);
        expect(RB_REQUIRED_EXPORTS).toBe(RUBBERBAND_STRETCHER_EXPORTS);
        expect(RB_FX_REQUIRED_EXPORTS).toBe(RUBBERBAND_FX_EXPORTS);
        expect(MIX_BUS_REQUIRED_EXPORTS).toBe(MIX_BUS_EXPORTS);
    });

    it('the three modules are re-checked by check:exports', () => {
        const tool = read('tools/check_wasm_export_map.mjs');
        expect(tool).toContain('checkRubberBandModule');
        expect(tool).toContain('checkMixBusModule');
    });
});

describe('check:native-types rejects callers of undeclared exports', () => {
    it('finds none in the tree', () => {
        expect(unknownExportCallers()).toEqual([]);
    });

    it('catches an undeclared call or quoted name for each module', () => {
        // The scan reads repo-relative files; point it at a fixture of bad callers.
        const found = unknownExportCallers({ files: ['src/test/fixtures/undeclaredNativeExportCallers.ts.txt'] });
        expect(found.map((f) => `${f.module}:${f.name}`)).toEqual([
            'rubberband:rb_set_sample_rate',
            'rubberband:rb_fx_reverb',
            'mix_bus:mix_bus_rms',
            'hyphon_native:open303_set_cutoff',
            'hyphon_native:hyphon_stack_reset',
        ]);
    });
});
