/**
 * macroPresets.ts — factory patches for the macro engine family.
 *
 * A patch is a model (the waveform id) plus its `SynthParams.macro` knobs and
 * an output level. Applying one replaces the whole macro block (fields it
 * leaves out take DEFAULT_MACRO_PARAMS), so patches never inherit stray
 * knob positions from whatever was loaded before.
 *
 * Ids are stable (songs and session packs may name them); names are what the
 * panel shows.
 */

import type { MacroSynthParams, MacroWaveform, SynthParams } from '../types';
import { DEFAULT_MACRO_PARAMS, type MacroBank } from './MacroParams';

export interface MacroPreset {
    id: string;
    name: string;
    bank: MacroBank;
    waveform: MacroWaveform;
    macro: MacroSynthParams;
    /** Output level; omitted keeps the part's current LEVEL. */
    volume?: number;
}

const p = (
    id: string,
    name: string,
    bank: MacroBank,
    waveform: MacroWaveform,
    macro: MacroSynthParams,
    volume?: number,
): MacroPreset => ({ id, name, bank, waveform, macro, volume });

export const MACRO_PRESETS: readonly MacroPreset[] = [
    // ── Pitched ──────────────────────────────────────────────────────────────
    p('va-fat-saw', 'Detuned saw lead', 'synth', 'macro-va', { harmonics: 0.35, timbre: 0.25, morph: 0.9, decay: 0.45, lpgColour: 0.6, spread: 0.5 }),
    p('va-square-bass', 'Square bass (mono)', 'synth', 'macro-va', { harmonics: 0, timbre: 0.5, morph: 0, decay: 0.3, lpgColour: 0.8, polyphony: 1, glide: 0.2, spread: 0 }),
    p('va-sync-lead', 'Sync lead', 'synth', 'macro-va', { harmonics: 0.7, timbre: 0.9, morph: 0.7, decay: 0.5, lpgColour: 0.5, timbreMod: 0.3, polyphony: 1, glide: 0.15 }),
    p('ws-fold-bass', 'Wavefold bass', 'synth', 'macro-waveshaper', { harmonics: 0.2, timbre: 0.6, morph: 0.3, decay: 0.35, lpgColour: 0.9, polyphony: 1, timbreMod: 0.4 }),
    p('ws-glass-keys', 'Glass keys', 'synth', 'macro-waveshaper', { harmonics: 0.65, timbre: 0.35, morph: 0.5, decay: 0.6, lpgColour: 0.4, timbreMod: 0.4, lpgMode: 'ping' }),
    p('fm2-ep', 'FM electric piano', 'synth', 'macro-fm2', { harmonics: 0.25, timbre: 0.35, morph: 0.45, decay: 0.55, lpgColour: 0.3, timbreMod: 0.5, lpgMode: 'ping' }),
    p('fm2-bell', 'FM bell', 'synth', 'macro-fm2', { harmonics: 0.6, timbre: 0.6, morph: 0.5, decay: 0.8, lpgColour: 0.2, timbreMod: 0.6, lpgMode: 'ping', spread: 0.5 }),
    p('fm2-growl', 'FM growl bass', 'synth', 'macro-fm2', { harmonics: 0.1, timbre: 0.8, morph: 0.8, decay: 0.3, lpgColour: 0.9, polyphony: 1, glide: 0.1 }),
    p('grain-vox', 'Formant voice', 'synth', 'macro-grain', { harmonics: 0.4, timbre: 0.5, morph: 0.3, decay: 0.5, lpgColour: 0.5, morphMod: 0.2 }),
    p('grain-cz-lead', 'Phase-window lead', 'synth', 'macro-grain', { harmonics: 0.7, timbre: 0.35, morph: 0.7, decay: 0.45, lpgColour: 0.6, auxMix: 1, polyphony: 1, glide: 0.2 }),
    p('add-organ', 'Drawbar organ', 'synth', 'macro-additive', { harmonics: 0.2, timbre: 0.3, morph: 0.7, decay: 0.8, lpgColour: 0, auxMix: 1, spread: 0.4 }),
    p('add-spectral-pad', 'Spectral pad', 'synth', 'macro-additive', { harmonics: 0.6, timbre: 0.5, morph: 0.5, decay: 0.9, lpgColour: 0.2, timbreMod: 0.3, spread: 0.7 }),
    p('wt-digital-pad', 'Digital pad', 'synth', 'macro-wavetable', { harmonics: 0.3, timbre: 0.5, morph: 0.4, decay: 0.9, lpgColour: 0.3, glide: 0.1, spread: 0.6 }),
    p('wt-lofi-arp', 'Lo-fi arp', 'synth', 'macro-wavetable', { harmonics: 0.8, timbre: 0.2, morph: 0.6, decay: 0.25, lpgColour: 0.7, auxMix: 1, lpgMode: 'ping' }),
    p('chords-minor-stab', 'Minor chord stab', 'synth', 'macro-chords', { harmonics: 0.35, timbre: 0.5, morph: 0.2, decay: 0.3, lpgColour: 0.7, polyphony: 2 }),
    p('chords-organ-pad', 'Chord organ pad', 'synth', 'macro-chords', { harmonics: 0.5, timbre: 0.4, morph: 0.5, decay: 0.85, lpgColour: 0.2, polyphony: 2, spread: 0.6 }),
    p('speech-robot', 'Robot vowels', 'synth', 'macro-speech', { harmonics: 0.2, timbre: 0.5, morph: 0.5, decay: 0.6, lpgColour: 0.5, morphMod: 0.3 }),
    p('speech-words', 'Talking words', 'synth', 'macro-speech', { harmonics: 0.9, timbre: 0.5, morph: 0.3, decay: 0.7, lpgColour: 0.4, lpgMode: 'ping', polyphony: 1 }),

    // ── Noise / texture ──────────────────────────────────────────────────────
    p('swarm-supersaw', 'Swarm supersaw', 'texture', 'macro-swarm', { harmonics: 0.2, timbre: 0.5, morph: 0.8, decay: 0.9, lpgColour: 0.3, spread: 0.8 }),
    p('swarm-glissando', 'Glissando cloud', 'texture', 'macro-swarm', { harmonics: 0.7, timbre: 0.4, morph: 0.3, decay: 0.9, lpgColour: 0.2, spread: 0.8 }),
    p('noise-wind', 'Wind', 'texture', 'macro-noise', { harmonics: 0.5, timbre: 0.4, morph: 0.8, decay: 0.95, lpgColour: 0.1, spread: 0.6 }),
    p('noise-tuned-hat', 'Tuned noise tick', 'texture', 'macro-noise', { harmonics: 0.9, timbre: 0.9, morph: 0.3, decay: 0.2, lpgColour: 0.6, lpgMode: 'ping' }),
    p('particle-rain', 'Rain', 'texture', 'macro-particle', { harmonics: 0.5, timbre: 0.4, morph: 0.2, decay: 0.9, lpgColour: 0.3, spread: 0.7 }),
    p('particle-crackle', 'Crackle', 'texture', 'macro-particle', { harmonics: 0.9, timbre: 0.2, morph: 0.8, decay: 0.8, lpgColour: 0.5, auxMix: 0.5 }),

    // ── Physical / drums (self-enveloped: MORPH is the decay) ────────────────
    p('string-pluck', 'Plucked string', 'percussion', 'macro-string', { harmonics: 0.3, timbre: 0.6, morph: 0.4 }),
    p('string-sitar', 'Buzzing sitar', 'percussion', 'macro-string', { harmonics: 0.8, timbre: 0.7, morph: 0.7, spread: 0.5 }),
    p('modal-marimba', 'Marimba', 'percussion', 'macro-modal', { harmonics: 0.2, timbre: 0.4, morph: 0.4 }),
    p('modal-bell', 'Tubular bell', 'percussion', 'macro-modal', { harmonics: 0.6, timbre: 0.7, morph: 0.8, spread: 0.6 }),
    p('modal-steel-drum', 'Steel drum', 'percussion', 'macro-modal', { harmonics: 0.45, timbre: 0.55, morph: 0.55 }),
    p('bd-808', 'Boomy bass drum', 'percussion', 'macro-bass-drum', { harmonics: 0.2, timbre: 0.3, morph: 0.7, polyphony: 1, spread: 0 }),
    p('bd-punchy', 'Punchy bass drum', 'percussion', 'macro-bass-drum', { harmonics: 0.7, timbre: 0.6, morph: 0.4, polyphony: 1, spread: 0 }),
    p('sd-analog', 'Analog snare', 'percussion', 'macro-snare', { harmonics: 0.5, timbre: 0.5, morph: 0.5, polyphony: 2 }),
    p('hh-closed', 'Closed hat', 'percussion', 'macro-hihat', { harmonics: 0.5, timbre: 0.6, morph: 0.2, polyphony: 2 }),
    p('hh-open', 'Open hat', 'percussion', 'macro-hihat', { harmonics: 0.5, timbre: 0.5, morph: 0.7, polyphony: 2 }),

    // ── Extended ─────────────────────────────────────────────────────────────
    p('vcf-acid', 'Acid line (mono)', 'extended', 'macro-va-vcf', { harmonics: 0.7, timbre: 0.3, morph: 0.2, decay: 0.3, lpgColour: 0.9, polyphony: 1, glide: 0.25, timbreMod: 0.5, spread: 0 }),
    p('vcf-brass', 'Filter brass', 'extended', 'macro-va-vcf', { harmonics: 0.3, timbre: 0.5, morph: 0.5, decay: 0.6, lpgColour: 0.5, timbreMod: 0.4 }),
    p('pd-bass', 'Phase-distortion bass', 'extended', 'macro-phase-dist', { harmonics: 0.3, timbre: 0.6, morph: 0.4, decay: 0.35, lpgColour: 0.8, polyphony: 1, timbreMod: 0.3 }),
    p('fm6-a-keys', '6-op keys', 'extended', 'macro-fm6-a', { harmonics: 0, timbre: 0.5, morph: 0.5 }),
    p('fm6-b-brass', '6-op brass', 'extended', 'macro-fm6-b', { harmonics: 0.3, timbre: 0.5, morph: 0.5 }),
    p('fm6-c-bass', '6-op bass', 'extended', 'macro-fm6-c', { harmonics: 0.6, timbre: 0.5, morph: 0.5, polyphony: 1 }),
    p('terrain-drone', 'Terrain drone', 'extended', 'macro-wave-terrain', { harmonics: 0.5, timbre: 0.6, morph: 0.3, decay: 0.95, lpgColour: 0.2, spread: 0.7 }),
    p('string-machine', 'String ensemble', 'extended', 'macro-string-machine', { harmonics: 0.3, timbre: 0.5, morph: 0.5, decay: 0.9, lpgColour: 0.3, spread: 0.8 }),
    p('chip-arp', 'Chiptune arp', 'extended', 'macro-chiptune', { harmonics: 0.4, timbre: 0.6, morph: 0.3, decay: 0.4, lpgColour: 0.6 }),
];

const BY_ID = new Map(MACRO_PRESETS.map((preset) => [preset.id, preset]));

export function getMacroPreset(id: string): MacroPreset | undefined {
    return BY_ID.get(id);
}

/**
 * The SynthParams update that loads a patch: model, the whole macro block
 * (defaults under the patch's own values) and, when the patch sets one, LEVEL.
 */
export function macroPresetUpdate(preset: MacroPreset): Partial<SynthParams> {
    const update: Partial<SynthParams> = {
        waveform: preset.waveform,
        macro: { ...DEFAULT_MACRO_PARAMS, ...preset.macro },
    };
    if (preset.volume !== undefined) update.volume = preset.volume;
    return update;
}
