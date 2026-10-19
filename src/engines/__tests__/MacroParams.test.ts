import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
    DEFAULT_MACRO_PARAMS,
    MACRO_AUTOMATION_PARAMS,
    MACRO_AUTOMATION_TARGETS,
    MACRO_BANKS,
    MACRO_ENGINES,
    MACRO_MAX_POLYPHONY,
    MACRO_WAVEFORMS,
    MacroParam,
    isMacroWaveform,
    macroControlKnob,
    macroControlValue,
    macroEngineForWaveform,
    macroNativeParams,
    resolveMacroParams,
} from '../MacroParams';
import { MACRO_PRESETS, getMacroPreset, macroPresetUpdate } from '../macroPresets';
import { getSynthControls } from '../../utils/knobConfigs';
import { mergeSynthParams } from '../../hooks/appState/useInstrumentState';
import { parseWaveform } from '../../utils/waveformParser';
import { DEFAULT_SYNTH_PARAMS_A } from '../../constants';
import type { SynthParams } from '../../types';

const ROOT = resolve(__dirname, '../../..');
const WRAPPER = readFileSync(join(ROOT, 'emscripten/macro_wrapper.cpp'), 'utf8');

describe('macro catalog', () => {
    it('lists 24 models with consecutive indices and unique, persisted ids', () => {
        expect(MACRO_ENGINES).toHaveLength(24);
        MACRO_ENGINES.forEach((engine, i) => expect(engine.index).toBe(i));
        expect(new Set(MACRO_WAVEFORMS).size).toBe(24);
        for (const waveform of MACRO_WAVEFORMS) {
            expect(waveform.startsWith('macro-')).toBe(true);
            expect(parseWaveform(waveform).engine).toBe('macro');
            expect(isMacroWaveform(waveform)).toBe(true);
        }
        expect(isMacroWaveform('prophecy-saw')).toBe(false);
        expect(macroEngineForWaveform('macro-modal')?.index).toBe(20);
    });

    it('keeps MacroParam in sync with the C++ enum', () => {
        const enumBody = WRAPPER.slice(WRAPPER.indexOf('enum MacroParam'), WRAPPER.indexOf('MACRO_PARAM_COUNT'));
        const native = Object.fromEntries(
            [...enumBody.matchAll(/MACRO_([A-Z_]+)\s*=\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
        );
        expect(native).toEqual(MacroParam);
    });

    it('keeps the model order in sync with the native registration order', () => {
        // Plaits engine member → catalog waveform, in MacroVoice::Init's order.
        const members = [...WRAPPER.matchAll(/engines_\.RegisterInstance\(&(\w+)_,/g)].map((m) => m[1]);
        const expected: Record<string, string> = {
            virtual_analog_vcf_engine: 'macro-va-vcf',
            phase_distortion_engine: 'macro-phase-dist',
            six_op_engine: 'macro-fm6',
            wave_terrain_engine: 'macro-wave-terrain',
            string_machine_engine: 'macro-string-machine',
            chiptune_engine: 'macro-chiptune',
            virtual_analog_engine: 'macro-va',
            waveshaping_engine: 'macro-waveshaper',
            fm_engine: 'macro-fm2',
            grain_engine: 'macro-grain',
            additive_engine: 'macro-additive',
            wavetable_engine: 'macro-wavetable',
            chord_engine: 'macro-chords',
            speech_engine: 'macro-speech',
            swarm_engine: 'macro-swarm',
            noise_engine: 'macro-noise',
            particle_engine: 'macro-particle',
            string_engine: 'macro-string',
            modal_engine: 'macro-modal',
            bass_drum_engine: 'macro-bass-drum',
            snare_drum_engine: 'macro-snare',
            hi_hat_engine: 'macro-hihat',
        };
        expect(members).toHaveLength(24);
        members.forEach((member, i) => {
            expect(MACRO_ENGINES[i].waveform.startsWith(expected[member]), `${i}: ${member}`).toBe(true);
        });
    });

    it('groups every model into exactly one bank of at most 8', () => {
        const banked = MACRO_BANKS.flatMap((b) => b.engines.map((e) => e.waveform));
        expect(banked.sort()).toEqual([...MACRO_WAVEFORMS].sort());
        for (const bank of MACRO_BANKS) expect(bank.engines.length).toBeLessThanOrEqual(8);
    });
});

describe('macro params', () => {
    it('fills defaults and clamps out-of-range or non-finite values', () => {
        expect(resolveMacroParams(undefined)).toEqual(DEFAULT_MACRO_PARAMS);
        const r = resolveMacroParams({ harmonics: 2, timbre: Number.NaN, fmMod: -3, polyphony: 12.6, lpgMode: 'nope' as never });
        expect(r.harmonics).toBe(1);
        expect(r.timbre).toBe(DEFAULT_MACRO_PARAMS.timbre);
        expect(r.fmMod).toBe(-1);
        expect(r.polyphony).toBe(MACRO_MAX_POLYPHONY);
        expect(r.lpgMode).toBe('gate');
    });

    it('maps a part onto native params: model index, knobs, volume, LPG mode', () => {
        const engine = macroEngineForWaveform('macro-fm2')!;
        const native = new Map(macroNativeParams(engine, resolveMacroParams({ timbre: 0.3, lpgMode: 'ping' }), 0.6));
        expect(native.get(MacroParam.ENGINE)).toBe(10);
        expect(native.get(MacroParam.TIMBRE)).toBe(0.3);
        expect(native.get(MacroParam.VOLUME)).toBe(0.6);
        expect(native.get(MacroParam.LPG_MODE)).toBe(1);
    });

    it('maps 0–1 knobs / lanes onto each control, bipolar where it is', () => {
        expect(macroControlValue('macroTimbre', 0.25)).toBe(0.25);
        expect(macroControlValue('macroFmMod', 0)).toBe(-1);
        expect(macroControlValue('macroFmMod', 1)).toBe(1);
        expect(macroControlValue('macroMorphMod', 7)).toBe(1);
        const m = resolveMacroParams({ timbreMod: -0.5, glide: 0.4 });
        expect(macroControlKnob('macroTimbreMod', m)).toBe(0.25);
        expect(macroControlKnob('macroGlide', m)).toBe(0.4);
        for (const param of MACRO_AUTOMATION_PARAMS) {
            const target = MACRO_AUTOMATION_TARGETS[param];
            expect(Object.values(MacroParam)).toContain(target.paramId);
        }
    });
});

describe('macro panel knobs', () => {
    const macroA: SynthParams = { ...DEFAULT_SYNTH_PARAMS_A, waveform: 'macro-va', macro: { harmonics: 0.2, fmMod: -0.5 } };

    it('replaces the subtractive knobs with the model knobs, ids = automation lanes', () => {
        const ids = getSynthControls(macroA).map((c) => c.id);
        expect(ids).toEqual(expect.arrayContaining([...MACRO_AUTOMATION_PARAMS, 'pitch', 'volume']));
        expect(ids).not.toContain('filterCutoff');
        const harmonics = getSynthControls(macroA).find((c) => c.id === 'macroHarmonics')!;
        expect(harmonics.value).toBe(0.2);
        expect(harmonics.valueDisplay).toContain('Detune');
        expect(getSynthControls(macroA).find((c) => c.id === 'macroFmMod')!.value).toBe(0.25);
    });

    it('keeps the subtractive knobs for every other family', () => {
        expect(getSynthControls(DEFAULT_SYNTH_PARAMS_A).map((c) => c.id)).toContain('filterCutoff');
    });

    it('merges a one-field macro update without dropping the other fields', () => {
        const next = mergeSynthParams(macroA, { macro: { timbre: 0.9 } });
        expect(next.macro).toEqual({ harmonics: 0.2, fmMod: -0.5, timbre: 0.9 });
        expect(mergeSynthParams(macroA, { volume: 0.5 }).macro).toBe(macroA.macro);
    });
});

describe('macro presets', () => {
    it('ships ~40 patches with unique ids on real models and in-range knobs', () => {
        expect(MACRO_PRESETS.length).toBeGreaterThanOrEqual(40);
        expect(new Set(MACRO_PRESETS.map((p) => p.id)).size).toBe(MACRO_PRESETS.length);
        for (const preset of MACRO_PRESETS) {
            expect(isMacroWaveform(preset.waveform), preset.id).toBe(true);
            expect(resolveMacroParams(preset.macro)).toEqual({ ...DEFAULT_MACRO_PARAMS, ...preset.macro });
        }
        // Every bank has patches.
        for (const bank of MACRO_BANKS) expect(MACRO_PRESETS.some((p) => p.bank === bank.bank)).toBe(true);
    });

    it('loads a patch as the whole macro block (no stray knobs from before)', () => {
        const update = macroPresetUpdate(getMacroPreset('vcf-acid')!);
        expect(update.waveform).toBe('macro-va-vcf');
        expect(update.macro).toEqual({ ...DEFAULT_MACRO_PARAMS, ...getMacroPreset('vcf-acid')!.macro });
        const before: SynthParams = { ...DEFAULT_SYNTH_PARAMS_A, macro: { auxMix: 1, morphMod: 0.9 } };
        const after = mergeSynthParams(before, update);
        expect(after.macro?.auxMix).toBe(0);
        expect(after.macro?.morphMod).toBe(0);
    });
});
