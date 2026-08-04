/**
 * Module-level TUNE offset helpers.
 *
 * Synth A/B and Bass 2 expose a TUNE knob (`params.pitch`) expressed in
 * semitones (-24..+24). The knob only writes into params state, so every
 * playback path has to fold that offset into the pitch it actually sounds.
 */

/** Clamp range of the TUNE knob, matching the knob config mapping. */
export const PITCH_OFFSET_MIN = -24;
export const PITCH_OFFSET_MAX = 24;

/**
 * Read a module's TUNE offset in semitones from its params, tolerating
 * params objects that predate the field (older saved patterns).
 */
export function getPitchOffsetSemitones(params: { pitch?: number } | null | undefined): number {
    const raw = params?.pitch;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
    return Math.max(PITCH_OFFSET_MIN, Math.min(PITCH_OFFSET_MAX, raw));
}

/** Transpose a MIDI note number by a semitone offset. */
export function transposeMidi(midi: number, semitones: number): number {
    if (!semitones) return midi;
    return midi + semitones;
}

/** Transpose a frequency (Hz) by a semitone offset. */
export function transposeFrequency(freq: number, semitones: number): number {
    if (!semitones) return freq;
    return freq * Math.pow(2, semitones / 12);
}
