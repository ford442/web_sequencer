/**
 * ProphecyParams.ts
 *
 * Parameter definitions and defaults for the Korg Prophecy formant synthesis
 * engine (prophecy_wrapper.cpp → hyphon_native.wasm).
 *
 * The numeric enum values MUST stay in sync with the ProphecyParam enum in
 * emscripten/prophecy_wrapper.cpp.
 */

// Using a const object instead of a numeric enum for erasableSyntaxOnly compatibility
// (matches the pattern used elsewhere in this project).
export const ProphecyParam = {
    /** Oscillator waveform: 0=Saw, 1=Square, 2=Triangle, 3=Pulse */
    WAVEFORM:       0,
    /** Vowel formant preset: 0=A, 1=E, 2=I, 3=O, 4=U */
    VOWEL:          1,
    /** Output volume: 0–1 */
    VOLUME:         2,
    /** ADSR attack time: 0–1 (maps to 1 ms – 2 s) */
    ATTACK:         3,
    /** ADSR decay time: 0–1 (maps to 10 ms – 2 s) */
    DECAY:          4,
    /** ADSR sustain level: 0–1 */
    SUSTAIN:        5,
    /** ADSR release time: 0–1 (maps to 10 ms – 3 s) */
    RELEASE:        6,
    /** Portamento rate: 0 = instantaneous, 1 = maximum glide */
    PORTAMENTO:     7,
    /** Formant frequency shift: 0 = none, 1 = +3 semitones upward */
    FORMANT_SHIFT:  8,
    /** Formant resonance / bandwidth scale: 0 = very resonant, 1 = nominal width */
    RESONANCE:      9,
} as const;

export type ProphecyParamKey = keyof typeof ProphecyParam;
export type ProphecyParamValue = typeof ProphecyParam[ProphecyParamKey];

/** Run-time parameters for a Prophecy engine instance. */
export interface ProphecyParams {
    waveform:      number;   // 0–3
    vowel:         number;   // 0–4
    volume:        number;   // 0–1
    attack:        number;   // 0–1
    decay:         number;   // 0–1
    sustain:       number;   // 0–1
    release:       number;   // 0–1
    portamento:    number;   // 0–1
    formantShift:  number;   // 0–1
    resonance:     number;   // 0–1
}

/**
 * Maps a full Prophecy Waveform enum value to the short waveType suffix
 * used internally (e.g. 'prophecy-saw' → 'saw').
 */
export const PROPHECY_WAVEFORM_SUFFIX: Partial<Record<string, string>> = {
    'prophecy-saw':   'saw',
    'prophecy-sqr':   'sqr',
    'prophecy-tri':   'tri',
    'prophecy-pulse': 'pulse',
};

/**
 * Maps a short waveType suffix to the numeric waveform ID expected by
 * `prophecy_set_param(WAVEFORM, ...)` (0=Saw, 1=Square, 2=Triangle, 3=Pulse).
 */
export const PROPHECY_WAVEFORM_ID: Record<string, number> = {
    saw:   0,
    sqr:   1,
    tri:   2,
    pulse: 3,
};

/** Sensible defaults that give an audible formant-rich pad sound immediately. */
export const DEFAULT_PROPHECY_PARAMS: ProphecyParams = {
    waveform:     0,     // Sawtooth
    vowel:        0,     // Vowel A
    volume:       0.75,
    attack:       0.05,  // ~100 ms
    decay:        0.3,
    sustain:      0.7,
    release:      0.25,  // ~750 ms
    portamento:   0.0,   // No glide
    formantShift: 0.0,   // No shift
    resonance:    0.5,   // Mid-point bandwidth
};
