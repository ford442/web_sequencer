/**
 * The Pyodide filter, as pure policy (#1676).
 *
 * Python cannot be an audio-graph stage: it runs on the main thread, and an
 * `AudioWorkletGlobalScope` has no CPython. So, like the WebGPU filter, it is a
 * *table* filter — `generate_filtered_table()` in `hyphon_engine.py` renders the
 * note's shape with the resonant filter applied to every harmonic (SciPy's
 * `freqz` of the RBJ biquad, which is the steady state a `BiquadFilterNode`
 * settles to), and the voice loops that table with nothing behind it.
 *
 * What this module decides is the table's *geometry*. A table is pitched with
 * `playbackRate`, so it is made for the note nearest the one played and holds
 * whole periods: a table of `cycles` periods in `length` samples sounds at
 * `sampleRate · cycles / length`, which is within 0.03 % of the note (under half
 * a cent) once the table is at least `MIN_TABLE_LENGTH` long. That keeps
 * `playbackRate` at ~1, so the loop is not resampled (no interpolation aliasing)
 * and the filter's cutoff, evaluated at the note's own harmonics, stays in Hz.
 */

import { midiToHz } from '../../utils/math';
import type { ParsedWaveform } from '../../utils/waveformParser';
import { BANK_MIDI_HIGH, BANK_MIDI_LOW, basicShapeRefusal, nearestBankNote } from './gpuFilter';

/** Shortest table, in samples: bounds how far `cycles / length` is from the note's period (see above). */
export const MIN_TABLE_LENGTH = 2048;

export interface PyodideTablePlan {
    midi: number;
    /** The note the filter is evaluated for, Hz (equal-tempered, the nearest note). */
    f0: number;
    /** Whole periods in the table. */
    cycles: number;
    /** Samples in the table. */
    length: number;
    /** The pitch the table sounds at when played at rate 1, Hz. */
    baseFrequency: number;
}

/**
 * The table to loop for a note of `frequency`, or null when the pitch is outside
 * the range one table serves (C0 – G9, the other bank's range) or not a number
 * — the voice then uses its native filter, said out loud.
 */
export function planPyodideTable(frequency: number, sampleRate: number): PyodideTablePlan | null {
    const midi = nearestBankNote(frequency);
    if (midi === null) return null;
    const f0 = midiToHz(midi);
    const cycles = Math.max(1, Math.ceil((MIN_TABLE_LENGTH * f0) / sampleRate));
    // A note at or above Nyquist has no harmonic to render: the table would be silence.
    if (f0 >= sampleRate / 2) return null;
    // Whole periods in `length` samples, so the table sounds at `sampleRate · cycles / length`: a period
    // of 2 to 4 samples (the top octave) is fine, it is just the fundamental alone.
    const length = Math.round((sampleRate * cycles) / f0);
    return { midi, f0, cycles, length, baseFrequency: (sampleRate * cycles) / length };
}

/** Why Python cannot render `parsed` as a filtered table, or null when it can. */
export function pyodideFilterRefusal(parsed: ParsedWaveform): string | null {
    return basicShapeRefusal(parsed, 'Pyodide');
}

export const PYODIDE_FILTER_RANGE = `${midiToHz(BANK_MIDI_LOW).toFixed(1)}–${midiToHz(BANK_MIDI_HIGH).toFixed(0)} Hz`;
