/** Note names to frequencies, 12-TET or microtonal. Engine code imports this module directly. */
import { noteToMidi, applyMicrotonalTuning } from '../utils/musicTheory';
import type { ScaleDefinition } from '../utils/musicTheory';

// Note to Frequency mapping
const noteFrequencies: { [key: string]: number } = {
  'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78, 'E2': 82.41, 'F2': 87.31, 'F#2': 92.50, 'G2': 98.00, 'G#2': 103.83, 'A2': 110.00, 'A#2': 116.54, 'B2': 123.47,
  'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
  'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
  'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77,
};

/** Hz for a note name (flats and doubles accepted); `null` when it is not a note name. */
export const noteToFrequency = (note: string): number | null => {
  const table = noteFrequencies[note];
  if (table) return table;
  // Outside the C2-B5 table (the live keyboard shifted up or down an octave,
  // or a flat spelling like "Eb3"): derive from MIDI.
  const midi = noteToMidi(note);
  if (midi === null) return null;
  return 440.00 * Math.pow(2, (midi - 69) / 12);
};


export const tunedNoteToFrequency = (note: string, tuning: ScaleDefinition | null = null): number | null => {
  const baseMidi = noteToMidi(note);
  if (baseMidi === null) return null;

  if (!tuning || !tuning.tuning || tuning.tuning === '12-TET') {
    // Return standard lookup to avoid math precision issues for 12-TET if possible,
    // or just calculate it directly.
    return noteToFrequency(note);
  }

  const tunedMidi = applyMicrotonalTuning(baseMidi, tuning);
  // midiToFreq logic:
  return 440.00 * Math.pow(2, (tunedMidi - 69) / 12);
};
