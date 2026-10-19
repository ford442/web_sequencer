/**
 * MacroParams.ts
 *
 * The `macro-*` engine family: 24 synthesis models from the Mutable
 * Instruments Plaits source code (MIT), rendered polyphonically by
 * emscripten/macro_wrapper.cpp inside hyphon_native.wasm. See
 * docs/audio-engine/macro-voices.md.
 *
 * MacroParam and the MACRO_ENGINES order MUST stay in sync with the MacroParam
 * enum and the engine registration order in emscripten/macro_wrapper.cpp —
 * both the waveform ids and the engine indices are persisted in songs.
 *
 * Product naming: the family is "MACRO" in the UI. Per the eurorack licence
 * guidelines the derivative is not branded with the module's name; the
 * attribution lives in THIRD_PARTY_NOTICES.md.
 */

import type { MacroSynthParams, Waveform } from '../types';

// Const object instead of a numeric enum (erasableSyntaxOnly).
export const MacroParam = {
    /** Engine index 0–23 (MACRO_ENGINES order). */
    ENGINE: 0,
    HARMONICS: 1,
    TIMBRE: 2,
    MORPH: 3,
    /** LPG + internal envelope decay, 0–1. */
    DECAY: 4,
    /** 0 = VCA, 1 = low-pass gate. */
    LPG_COLOUR: 5,
    /** Part output gain 0–2. */
    VOLUME: 6,
    /** 1–8 voices; 1 = mono, slides go legato. */
    POLYPHONY: 7,
    /** Internal envelope → pitch, −1…1. */
    FM_MOD: 8,
    /** Internal envelope → TIMBRE, −1…1. */
    TIMBRE_MOD: 9,
    /** Internal envelope → MORPH, −1…1. */
    MORPH_MOD: 10,
    /** Stereo width from the AUX output, 0–1. */
    SPREAD: 11,
    /** Portamento time 0–1 (0 = off, 1 ≈ 1 s). */
    GLIDE: 12,
    /** 0 = gate (note length holds the LPG), 1 = ping (the module's trigger behaviour). */
    LPG_MODE: 13,
    /** Semitones, −48…48. */
    TRANSPOSE: 14,
    /** Crossfade OUT → AUX on the mid channel, 0–1. */
    AUX_MIX: 15,
} as const;

export type MacroParamId = typeof MacroParam[keyof typeof MacroParam];

/** Voices per part (macro::kMaxVoices). */
export const MACRO_MAX_POLYPHONY = 8;

export type MacroBank = 'synth' | 'texture' | 'percussion' | 'extended';

export interface MacroEngineInfo {
    /** Engine index on the native side (persisted). */
    index: number;
    /** Stable waveform id (persisted). */
    waveform: Waveform;
    label: string;
    /** Three-letter button text. */
    short: string;
    bank: MacroBank;
    /** What HARMONICS / TIMBRE / MORPH do on this model (knob captions). */
    knobs: { harmonics: string; timbre: string; morph: string };
    /** What the AUX output carries (shown in the panel; SPREAD / AUX MIX use it). */
    aux: string;
    /**
     * Played instead — and reported in the Engine HUD — when the macro engine
     * is not available (a build without it, or its worklet failed). A plain
     * JS oscillator family, so the substitution itself cannot fail.
     */
    fallback: Waveform;
    /** Percussive models that envelope themselves; the LPG is bypassed. */
    selfEnveloped: boolean;
}

/**
 * The 24 models, in native engine order (Voice::Init's registration order
 * upstream). Ids are generic descriptions, not product names.
 */
export const MACRO_ENGINES: readonly MacroEngineInfo[] = [
    { index: 0, waveform: 'macro-va-vcf', label: 'VA + filter', short: 'VCF', bank: 'extended', knobs: { harmonics: 'Resonance', timbre: 'Cutoff', morph: 'Wave/Sub' }, aux: '12 dB variant', fallback: 'sawtooth', selfEnveloped: false },
    { index: 1, waveform: 'macro-phase-dist', label: 'Phase distortion', short: 'PD', bank: 'extended', knobs: { harmonics: 'Distortion f', timbre: 'Amount', morph: 'Asymmetry' }, aux: 'Unsynced variant', fallback: 'sawtooth', selfEnveloped: false },
    { index: 2, waveform: 'macro-fm6-a', label: '6-op FM bank A', short: 'FMA', bank: 'extended', knobs: { harmonics: 'Patch', timbre: 'Mod level', morph: 'Env stretch' }, aux: 'Patch variant', fallback: 'sine', selfEnveloped: true },
    { index: 3, waveform: 'macro-fm6-b', label: '6-op FM bank B', short: 'FMB', bank: 'extended', knobs: { harmonics: 'Patch', timbre: 'Mod level', morph: 'Env stretch' }, aux: 'Patch variant', fallback: 'sine', selfEnveloped: true },
    { index: 4, waveform: 'macro-fm6-c', label: '6-op FM bank C', short: 'FMC', bank: 'extended', knobs: { harmonics: 'Patch', timbre: 'Mod level', morph: 'Env stretch' }, aux: 'Patch variant', fallback: 'sine', selfEnveloped: true },
    { index: 5, waveform: 'macro-wave-terrain', label: 'Wave terrain', short: 'TER', bank: 'extended', knobs: { harmonics: 'Terrain', timbre: 'Path radius', morph: 'Path offset' }, aux: 'Path variant', fallback: 'triangle', selfEnveloped: false },
    { index: 6, waveform: 'macro-string-machine', label: 'String machine', short: 'STR', bank: 'extended', knobs: { harmonics: 'Chord', timbre: 'Chorus/filter', morph: 'Waveform' }, aux: 'Stereo half', fallback: 'sawtooth', selfEnveloped: false },
    { index: 7, waveform: 'macro-chiptune', label: 'Chiptune', short: 'CHP', bank: 'extended', knobs: { harmonics: 'Chord', timbre: 'Arpeggio', morph: 'PW / sync' }, aux: 'Bass note', fallback: 'square', selfEnveloped: false },
    { index: 8, waveform: 'macro-va', label: 'Virtual analog', short: 'VA', bank: 'synth', knobs: { harmonics: 'Detune', timbre: 'Square', morph: 'Saw shape' }, aux: 'Hard-sync pair', fallback: 'sawtooth', selfEnveloped: false },
    { index: 9, waveform: 'macro-waveshaper', label: 'Waveshaper', short: 'WSH', bank: 'synth', knobs: { harmonics: 'Shaper', timbre: 'Fold', morph: 'Asymmetry' }, aux: 'Shaper variant', fallback: 'triangle', selfEnveloped: false },
    { index: 10, waveform: 'macro-fm2', label: '2-op FM', short: 'FM2', bank: 'synth', knobs: { harmonics: 'Ratio', timbre: 'Index', morph: 'Feedback' }, aux: 'Sub-oscillator', fallback: 'sine', selfEnveloped: false },
    { index: 11, waveform: 'macro-grain', label: 'Granular formant', short: 'GRN', bank: 'synth', knobs: { harmonics: 'Formant ratio', timbre: 'Formant', morph: 'Width' }, aux: 'Windowed sines', fallback: 'square', selfEnveloped: false },
    { index: 12, waveform: 'macro-additive', label: 'Harmonic', short: 'ADD', bank: 'synth', knobs: { harmonics: 'Bumps', timbre: 'Peak harmonic', morph: 'Bump shape' }, aux: 'Organ harmonics', fallback: 'sine', selfEnveloped: false },
    { index: 13, waveform: 'macro-wavetable', label: 'Wavetable', short: 'WTB', bank: 'synth', knobs: { harmonics: 'Bank', timbre: 'Row', morph: 'Column' }, aux: 'Lo-fi 5-bit', fallback: 'sawtooth', selfEnveloped: false },
    { index: 14, waveform: 'macro-chords', label: 'Chords', short: 'CHD', bank: 'synth', knobs: { harmonics: 'Chord type', timbre: 'Inversion', morph: 'Waveform' }, aux: 'Root note', fallback: 'sawtooth', selfEnveloped: false },
    { index: 15, waveform: 'macro-speech', label: 'Speech', short: 'SPK', bank: 'synth', knobs: { harmonics: 'Synth / words', timbre: 'Species', morph: 'Phoneme' }, aux: 'Raw vocal cords', fallback: 'square', selfEnveloped: false },
    { index: 16, waveform: 'macro-swarm', label: 'Swarm', short: 'SWM', bank: 'texture', knobs: { harmonics: 'Pitch spread', timbre: 'Density', morph: 'Grain size' }, aux: 'Sine', fallback: 'sawtooth', selfEnveloped: false },
    { index: 17, waveform: 'macro-noise', label: 'Filtered noise', short: 'NOI', bank: 'texture', knobs: { harmonics: 'LP → HP', timbre: 'Clock', morph: 'Resonance' }, aux: 'Dual band-pass', fallback: 'square', selfEnveloped: false },
    { index: 18, waveform: 'macro-particle', label: 'Particle noise', short: 'PRT', bank: 'texture', knobs: { harmonics: 'Randomness', timbre: 'Density', morph: 'Filter type' }, aux: 'Raw dust', fallback: 'square', selfEnveloped: false },
    { index: 19, waveform: 'macro-string', label: 'Inharmonic string', short: 'STG', bank: 'percussion', knobs: { harmonics: 'Material', timbre: 'Brightness', morph: 'Decay' }, aux: 'Exciter', fallback: 'triangle', selfEnveloped: true },
    { index: 20, waveform: 'macro-modal', label: 'Modal resonator', short: 'MOD', bank: 'percussion', knobs: { harmonics: 'Material', timbre: 'Brightness', morph: 'Decay' }, aux: 'Exciter', fallback: 'sine', selfEnveloped: true },
    { index: 21, waveform: 'macro-bass-drum', label: 'Analog bass drum', short: 'BD', bank: 'percussion', knobs: { harmonics: 'Punch', timbre: 'Tone', morph: 'Decay' }, aux: 'FM bass drum', fallback: 'sine', selfEnveloped: true },
    { index: 22, waveform: 'macro-snare', label: 'Analog snare', short: 'SD', bank: 'percussion', knobs: { harmonics: 'Snappy', timbre: 'Tone', morph: 'Decay' }, aux: 'Synthetic snare', fallback: 'triangle', selfEnveloped: true },
    { index: 23, waveform: 'macro-hihat', label: 'Analog hi-hat', short: 'HH', bank: 'percussion', knobs: { harmonics: 'Metal / noise', timbre: 'High-pass', morph: 'Decay' }, aux: 'Hi-hat variant', fallback: 'square', selfEnveloped: true },
];

/** Number of engines this catalog knows; must equal macro_engine_count() of the loaded wasm. */
export const MACRO_ENGINE_COUNT = MACRO_ENGINES.length;

const BY_WAVEFORM = new Map<string, MacroEngineInfo>(MACRO_ENGINES.map((e) => [e.waveform, e]));

/** The macro engine for a waveform id, or undefined for anything that is not `macro-*`. */
export function macroEngineForWaveform(waveform: string | undefined): MacroEngineInfo | undefined {
    return waveform ? BY_WAVEFORM.get(waveform) : undefined;
}

export function isMacroWaveform(waveform: string | undefined): boolean {
    return BY_WAVEFORM.has(waveform ?? '');
}

/** Every macro waveform id, in engine order. */
export const MACRO_WAVEFORMS: readonly Waveform[] = MACRO_ENGINES.map((e) => e.waveform);

/** Engine buttons grouped as the panel shows them. */
export const MACRO_BANKS: ReadonlyArray<{ bank: MacroBank; label: string; engines: readonly MacroEngineInfo[] }> = [
    { bank: 'synth', label: 'Pitched', engines: MACRO_ENGINES.filter((e) => e.bank === 'synth') },
    { bank: 'texture', label: 'Noise / texture', engines: MACRO_ENGINES.filter((e) => e.bank === 'texture') },
    { bank: 'percussion', label: 'Physical / drums', engines: MACRO_ENGINES.filter((e) => e.bank === 'percussion') },
    { bank: 'extended', label: 'Extended', engines: MACRO_ENGINES.filter((e) => e.bank === 'extended') },
];

/** Defaults for `SynthParams.macro` — what a fresh macro part sounds like. */
export const DEFAULT_MACRO_PARAMS: Required<MacroSynthParams> = {
    harmonics: 0.5,
    timbre: 0.5,
    morph: 0.5,
    decay: 0.5,
    lpgColour: 0.5,
    polyphony: MACRO_MAX_POLYPHONY,
    fmMod: 0,
    timbreMod: 0,
    morphMod: 0,
    spread: 0.3,
    glide: 0,
    lpgMode: 'gate',
    auxMix: 0,
};

/** `params.macro` with every field filled in (missing / non-finite fields take the default). */
export function resolveMacroParams(macro: MacroSynthParams | undefined): Required<MacroSynthParams> {
    const out = { ...DEFAULT_MACRO_PARAMS };
    if (!macro) return out;
    const num = (v: unknown, lo: number, hi: number, d: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
    out.harmonics = num(macro.harmonics, 0, 1, out.harmonics);
    out.timbre = num(macro.timbre, 0, 1, out.timbre);
    out.morph = num(macro.morph, 0, 1, out.morph);
    out.decay = num(macro.decay, 0, 1, out.decay);
    out.lpgColour = num(macro.lpgColour, 0, 1, out.lpgColour);
    out.polyphony = Math.round(num(macro.polyphony, 1, MACRO_MAX_POLYPHONY, out.polyphony));
    out.fmMod = num(macro.fmMod, -1, 1, out.fmMod);
    out.timbreMod = num(macro.timbreMod, -1, 1, out.timbreMod);
    out.morphMod = num(macro.morphMod, -1, 1, out.morphMod);
    out.spread = num(macro.spread, 0, 1, out.spread);
    out.glide = num(macro.glide, 0, 1, out.glide);
    out.lpgMode = macro.lpgMode === 'ping' ? 'ping' : 'gate';
    out.auxMix = num(macro.auxMix, 0, 1, out.auxMix);
    return out;
}

/**
 * Native parameter values for a part: `SynthParams` (volume, TUNE) plus the
 * resolved `macro` block, as [paramId, value] pairs. The oscillator diffs
 * these against what it last sent, so applying them per note is cheap.
 */
export function macroNativeParams(
    engine: MacroEngineInfo,
    macro: Required<MacroSynthParams>,
    volume: number,
): Array<[MacroParamId, number]> {
    return [
        [MacroParam.ENGINE, engine.index],
        [MacroParam.HARMONICS, macro.harmonics],
        [MacroParam.TIMBRE, macro.timbre],
        [MacroParam.MORPH, macro.morph],
        [MacroParam.DECAY, macro.decay],
        [MacroParam.LPG_COLOUR, macro.lpgColour],
        [MacroParam.VOLUME, Number.isFinite(volume) ? Math.max(0, Math.min(2, volume)) : 0.8],
        [MacroParam.POLYPHONY, macro.polyphony],
        [MacroParam.FM_MOD, macro.fmMod],
        [MacroParam.TIMBRE_MOD, macro.timbreMod],
        [MacroParam.MORPH_MOD, macro.morphMod],
        [MacroParam.SPREAD, macro.spread],
        [MacroParam.GLIDE, macro.glide],
        [MacroParam.LPG_MODE, macro.lpgMode === 'ping' ? 1 : 0],
        [MacroParam.AUX_MIX, macro.auxMix],
    ];
}

export interface MacroControlTarget {
    /** The `SynthParams.macro` field. */
    field: Exclude<keyof MacroSynthParams, 'lpgMode' | 'polyphony' | 'auxMix'>;
    paramId: MacroParamId;
    label: string;
    /** The 0–1 knob / lane maps onto −1…1. */
    bipolar?: boolean;
}

/**
 * The macro knobs: one id per control, used as the rack knob id, the MIDI
 * learn target and the automation lane parameter (target synthA / synthB).
 * Lane and knob values are normalized 0–1 (`macroControlValue` maps them).
 */
export const MACRO_AUTOMATION_TARGETS = {
    macroHarmonics: { field: 'harmonics', paramId: MacroParam.HARMONICS, label: 'Harmonics (Macro)' },
    macroTimbre: { field: 'timbre', paramId: MacroParam.TIMBRE, label: 'Timbre (Macro)' },
    macroMorph: { field: 'morph', paramId: MacroParam.MORPH, label: 'Morph (Macro)' },
    macroDecay: { field: 'decay', paramId: MacroParam.DECAY, label: 'Decay (Macro)' },
    macroLpgColour: { field: 'lpgColour', paramId: MacroParam.LPG_COLOUR, label: 'LPG colour (Macro)' },
    macroFmMod: { field: 'fmMod', paramId: MacroParam.FM_MOD, label: 'FM env (Macro)', bipolar: true },
    macroTimbreMod: { field: 'timbreMod', paramId: MacroParam.TIMBRE_MOD, label: 'Timbre env (Macro)', bipolar: true },
    macroMorphMod: { field: 'morphMod', paramId: MacroParam.MORPH_MOD, label: 'Morph env (Macro)', bipolar: true },
    macroGlide: { field: 'glide', paramId: MacroParam.GLIDE, label: 'Glide (Macro)' },
    macroSpread: { field: 'spread', paramId: MacroParam.SPREAD, label: 'Spread (Macro)' },
} as const satisfies Record<string, MacroControlTarget>;

export type MacroAutomationParam = keyof typeof MACRO_AUTOMATION_TARGETS;

/** Every macro control id, in panel order. */
export const MACRO_AUTOMATION_PARAMS = Object.keys(MACRO_AUTOMATION_TARGETS) as MacroAutomationParam[];

export function isMacroAutomationParam(param: string): param is MacroAutomationParam {
    return Object.prototype.hasOwnProperty.call(MACRO_AUTOMATION_TARGETS, param);
}

/** A normalized 0–1 knob / lane value in the control's own range. */
export function macroControlValue(param: MacroAutomationParam, normalized: number): number {
    const v = Math.max(0, Math.min(1, normalized));
    return (MACRO_AUTOMATION_TARGETS[param] as MacroControlTarget).bipolar ? v * 2 - 1 : v;
}

/** The control's value in `macro`, normalized back to its 0–1 knob position. */
export function macroControlKnob(param: MacroAutomationParam, macro: Required<MacroSynthParams>): number {
    const target: MacroControlTarget = MACRO_AUTOMATION_TARGETS[param];
    const v = macro[target.field];
    return target.bipolar ? (v + 1) / 2 : v;
}
