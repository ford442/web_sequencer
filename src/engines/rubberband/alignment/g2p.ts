import { CMU_DICT } from './cmuDict';

const VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY',
  'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
]);

export function isArpabetVowel(phoneme: string): boolean {
  return VOWELS.has(phoneme.toUpperCase().replace(/[0-9]/g, ''));
}

export type PhonemeCategory = 'vowel' | 'consonant' | 'fricative' | 'plosive' | 'nasal' | 'liquid';

export function categorizePhoneme(phoneme: string): PhonemeCategory {
  const ph = phoneme.toUpperCase().replace(/[0-9]/g, '');
  if (isArpabetVowel(ph)) return 'vowel';
  if (['F', 'V', 'TH', 'DH', 'S', 'Z', 'SH', 'ZH', 'H', 'HH'].includes(ph)) return 'fricative';
  if (['P', 'B', 'T', 'D', 'K', 'G'].includes(ph)) return 'plosive';
  if (['M', 'N', 'NG'].includes(ph)) return 'nasal';
  if (['L', 'R', 'W', 'Y'].includes(ph)) return 'liquid';
  return 'consonant';
}

/** Letter-pattern G2P for OOV tokens (legacy heuristic). */
export function estimatePhonemesForWord(word: string): string[] {
  const phonemes: string[] = [];
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  for (let i = 0; i < w.length; i++) {
    const char = w[i];
    const nextChar = w[i + 1] || '';
    if ('aeiou'.includes(char)) {
      if (char === 'a') phonemes.push('AE');
      else if (char === 'e') phonemes.push('EH');
      else if (char === 'i') phonemes.push('IH');
      else if (char === 'o') phonemes.push('OW');
      else phonemes.push('UH');
    } else if (char === 't' && nextChar === 'h') {
      phonemes.push('TH');
      i++;
    } else if (char === 's' && nextChar === 'h') {
      phonemes.push('SH');
      i++;
    } else if (char === 'c' && nextChar === 'h') {
      phonemes.push('CH');
      i++;
    } else if (char === 'n' && nextChar === 'g') {
      phonemes.push('NG');
      i++;
    } else if (char === 'w' && nextChar === 'h') {
      phonemes.push('W');
      i++;
    } else if (char === 'q' && nextChar === 'u') {
      phonemes.push('K');
      phonemes.push('W');
      i++;
    } else if (char === 'c' && (nextChar === 'e' || nextChar === 'i' || nextChar === 'y')) {
      phonemes.push('S');
    } else if (char === 'c') {
      phonemes.push('K');
    } else if (char === 'x') {
      phonemes.push('K');
      phonemes.push('S');
    } else if (char === 'y' && i === 0) {
      phonemes.push('Y');
    } else if (char === 'y') {
      phonemes.push('IY');
    } else if (char === 'j') {
      phonemes.push('JH');
    } else {
      phonemes.push(char.toUpperCase());
    }
  }
  return phonemes.length > 0 ? phonemes : ['AH'];
}

export function g2pWord(word: string): string[] {
  const key = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return [];
  const listed = CMU_DICT[key];
  if (listed) return [...listed];
  return estimatePhonemesForWord(key);
}

export function g2pText(text: string): string[] {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 0);
  const phonemes: string[] = [];
  for (const word of words) {
    phonemes.push(...g2pWord(word));
  }
  return phonemes;
}

/** Relative duration weights: vowels last longer than consonants. */
export function defaultPhonemeDurationWeights(phonemes: string[]): number[] {
  return phonemes.map((p) => (isArpabetVowel(p) ? 2.2 : 1));
}
