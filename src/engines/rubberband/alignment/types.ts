/** Phoneme timing information from forced alignment */
export interface PhonemeSegment {
  phoneme: string;
  start: number;
  end: number;
  isVowel: boolean;
  category?: 'vowel' | 'consonant' | 'fricative' | 'plosive' | 'nasal' | 'liquid';
}

export interface AlignmentResult {
  phonemes: PhonemeSegment[];
  sampleRate: number;
  duration: number;
  text: string;
}

export interface AlignPassOptions {
  durationPriors?: number[];
}

/** Median boundary error vs hand labels on the committed English fixture. */
export const ALIGNMENT_BOUNDARY_TOLERANCE_MS = 40;
