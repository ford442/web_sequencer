/**
 * What the co-producer may turn: the panel knobs of every track (in the
 * units the song stores, with the range the knob covers) and the automation
 * lanes that both play live and exist in the AI song format.
 *
 * Ranges come from `utils/knobConfigs.ts` — the knob position each panel
 * draws is `value / range`, so a value inside these ranges is one a user could
 * dial in. Lane parameters are derived from the two tables that decide whether
 * a lane is heard (`ROUTED_AUTOMATION` via `laneDispatchGap`) and whether the
 * AI format can say it (`VALID_PARAMETERS_BY_TARGET`), so this list cannot
 * offer a lane that never plays or that `get_song` could not show back.
 */

import type { AISongTrackName } from '../../importers/ai-song/types';
import { VALID_PARAMETERS_BY_TARGET } from '../../importers/ai-song/automationParameters';
import { laneDispatchGap } from '../../audio/automation/laneResolver';
import { MACRO_ENGINES, MACRO_AUTOMATION_TARGETS, type MacroAutomationParam } from '../../engines/MacroParams';
import type { Waveform } from '../../types';

/** Tracks as the AI song format names them. */
export const COPRODUCER_TRACKS = [
    'synthA', 'synthB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler',
] as const satisfies readonly AISongTrackName[];
export type CoproducerTrack = (typeof COPRODUCER_TRACKS)[number];

export const MELODIC_TRACKS = ['synthA', 'synthB', 'bass2'] as const;
export type MelodicTrack = (typeof MELODIC_TRACKS)[number];
export const DRUM_TRACKS = ['kick', 'snare', 'closedHat', 'openHat'] as const;
export type DrumTrack = (typeof DRUM_TRACKS)[number];

export const isMelodicTrack = (t: string): t is MelodicTrack => (MELODIC_TRACKS as readonly string[]).includes(t);
export const isDrumTrack = (t: string): t is DrumTrack => (DRUM_TRACKS as readonly string[]).includes(t);

/** Every waveform id a SYNTH A / B part can play (the `Waveform` union, as a value). */
export const SYNTH_WAVEFORMS: readonly Waveform[] = [
    'sawtooth', 'square', 'triangle', 'sine',
    'pyodide-saw', 'pyodide-square', 'pyodide-sine',
    'wgsl-saw', 'wgsl-sqr', 'wgsl-tri', 'wgsl-sin',
    'wam-saw', 'wam-sqr', 'wam-tri', 'wam-sin',
    'wav-saw', 'wav-sqr',
    '303-saw', '303-sqr',
    'prophecy-saw', 'prophecy-sqr', 'prophecy-tri', 'prophecy-pulse',
    ...MACRO_ENGINES.map((e) => e.waveform),
];
export const BASS2_WAVEFORMS: readonly Waveform[] = ['303-saw', '303-sqr'];

export interface KnobSpec {
    min: number;
    max: number;
    /** Shown to the model next to the range. */
    unit: string;
}

const k = (min: number, max: number, unit = ''): KnobSpec => ({ min, max, unit });

/** A subtractive / 303 / Prophecy part (`getSynthControls`), plus the delay feedback the AI format sets. */
const SYNTH_KNOBS: Readonly<Record<string, KnobSpec>> = {
    pitch: k(-24, 24, 'semitones'),
    filterCutoff: k(20, 8000, 'Hz'),
    filterResonance: k(0, 20),
    filterMode: k(0, 1, '0 = 18 dB, 1 = 24 dB'),
    drive: k(0, 1),
    attack: k(0, 1, 's'),
    decay: k(0, 2, 's'),
    sustain: k(0, 1),
    release: k(0, 2, 's'),
    length: k(0.01, 2, 's gate'),
    volume: k(0, 1),
    delayMix: k(0, 1),
    delayTime: k(0, 1, 's'),
    delayFeedback: k(0, 0.95),
};

/** A part on a `macro-*` model (`getMacroSynthControls`); the ids are the lane ids. */
const MACRO_KNOBS: Readonly<Record<MacroAutomationParam, KnobSpec>> = Object.fromEntries(
    (Object.keys(MACRO_AUTOMATION_TARGETS) as MacroAutomationParam[]).map((id) => [
        id,
        'bipolar' in MACRO_AUTOMATION_TARGETS[id] ? k(-1, 1) : k(0, 1),
    ]),
) as Record<MacroAutomationParam, KnobSpec>;

/** BASS 2 (`getBass2Controls`), named like the AI format names SYNTH knobs. */
const BASS2_KNOBS: Readonly<Record<string, KnobSpec>> = {
    pitch: k(-24, 24, 'semitones'),
    filterCutoff: k(20, 8000, 'Hz'),
    filterResonance: k(0, 20),
    filterMode: k(0, 1, '0 = 18 dB, 1 = 24 dB'),
    decay: k(0, 2, 's'),
    accent: k(0, 1),
    envMod: k(0, 1),
    drive: k(0, 1),
    volume: k(0, 1),
};

/** `Bass2Params` field behind each BASS 2 knob name. */
export const BASS2_FIELD: Readonly<Record<string, string>> = {
    filterCutoff: 'cutoff',
    filterResonance: 'resonance',
};

const KICK_KNOBS = { pitch: k(20, 150, 'Hz'), decay: k(0, 1, 's'), tone: k(0, 1), volume: k(0, 1) };
const SNARE_KNOBS = { tone: k(100, 400, 'Hz'), noise: k(1000, 8000, 'Hz'), decay: k(0, 0.5, 's'), volume: k(0, 1) };
const HAT_KNOBS = { decay: k(0, 1, 's'), pitch: k(0, 12000, 'Hz'), volume: k(0, 1) };
const SAMPLER_KNOBS = {
    volume: k(0, 1),
    playbackSpeed: k(0, 4, '×'),
    filterCutoff: k(20, 20000, 'Hz'),
    filterResonance: k(0, 20),
    drive: k(0, 1),
    delaySend: k(0, 1),
    glitchChance: k(0, 1),
};

/** The knobs `set_params` takes on `track` (macro knobs only while it plays a macro model). */
export function knobsFor(track: CoproducerTrack, macro = false): Readonly<Record<string, KnobSpec>> {
    switch (track) {
        case 'synthA':
        case 'synthB':
            return macro ? { pitch: SYNTH_KNOBS.pitch, volume: SYNTH_KNOBS.volume, ...MACRO_KNOBS } : SYNTH_KNOBS;
        case 'bass2': return BASS2_KNOBS;
        case 'kick': return KICK_KNOBS;
        case 'snare': return SNARE_KNOBS;
        case 'closedHat':
        case 'openHat': return HAT_KNOBS;
        case 'sampler': return SAMPLER_KNOBS;
    }
}

/** Every knob name any track takes — the property list of the `set_params` schema. */
export const ALL_KNOB_NAMES: readonly string[] = [...new Set([
    ...Object.keys(SYNTH_KNOBS), ...Object.keys(MACRO_KNOBS), ...Object.keys(BASS2_KNOBS),
    ...Object.keys(KICK_KNOBS), ...Object.keys(SNARE_KNOBS), ...Object.keys(HAT_KNOBS), ...Object.keys(SAMPLER_KNOBS),
])];

export const isMacroKnob = (name: string): name is MacroAutomationParam =>
    Object.prototype.hasOwnProperty.call(MACRO_AUTOMATION_TARGETS, name);

/**
 * Lane parameters per track that the live scheduler plays and the AI format
 * names: `VALID_PARAMETERS_BY_TARGET[track]` with no `laneDispatchGap`.
 */
export const LANE_PARAMETERS: Readonly<Record<CoproducerTrack, readonly string[]>> = Object.fromEntries(
    COPRODUCER_TRACKS.map((track): [CoproducerTrack, readonly string[]] => [
        track,
        VALID_PARAMETERS_BY_TARGET[track].filter((parameter) => laneDispatchGap(track, parameter) === null),
    ]),
) as Record<CoproducerTrack, readonly string[]>;

export const ALL_LANE_PARAMETERS: readonly string[] = [...new Set(Object.values(LANE_PARAMETERS).flat())];
