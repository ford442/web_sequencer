// ARPABET phoneme to readable name
export const PHONEME_NAMES: Record<string, string> = {
  'AA': 'a', 'AE': 'æ', 'AH': 'ʌ', 'AO': 'ɔ', 'AW': 'aw',
  'AY': 'ay', 'EH': 'e', 'ER': 'er', 'EY': 'ey', 'IH': 'i',
  'IY': 'ee', 'OW': 'ow', 'OY': 'oy', 'UH': 'uh', 'UW': 'oo',
  'P': 'p', 'B': 'b', 'T': 't', 'D': 'd', 'K': 'k', 'G': 'g',
  'CH': 'ch', 'JH': 'j', 'F': 'f', 'V': 'v', 'TH': 'th',
  'DH': 'dh', 'S': 's', 'Z': 'z', 'SH': 'sh', 'ZH': 'zh',
  'HH': 'h', 'M': 'm', 'N': 'n', 'NG': 'ng', 'L': 'l',
  'R': 'r', 'W': 'w', 'Y': 'y'
};

// Common phonemes for quick add
export const COMMON_PHONEMES = [
  { cat: 'Vowels', phones: ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'] },
  { cat: 'Plosives', phones: ['P', 'B', 'T', 'D', 'K', 'G'] },
  { cat: 'Fricatives', phones: ['F', 'V', 'TH', 'S', 'Z', 'SH', 'HH'] },
  { cat: 'Nasals', phones: ['M', 'N', 'NG'] },
  { cat: 'Liquids', phones: ['L', 'R', 'W', 'Y'] },
  { cat: 'Affricates', phones: ['CH', 'JH'] }
];

// Get phoneme color based on category
export const getPhonemeColor = (phoneme: string): string => {
  const ph = phoneme.toUpperCase();
  // Vowels - Purple
  if (['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'].includes(ph))
    return '#a855f7';
  // Plosives - Red
  if (['P', 'B', 'T', 'D', 'K', 'G'].includes(ph)) return '#ef4444';
  // Fricatives - Green
  if (['F', 'V', 'TH', 'DH', 'S', 'Z', 'SH', 'ZH', 'HH'].includes(ph)) return '#22c55e';
  // Affricates - Orange
  if (['CH', 'JH'].includes(ph)) return '#f97316';
  // Nasals - Blue
  if (['M', 'N', 'NG'].includes(ph)) return '#3b82f6';
  // Liquids/Glides - Cyan
  if (['L', 'R', 'W', 'Y'].includes(ph)) return '#06b6d4';
  return '#6b7280';
};

// Generate unique ID
export const generateId = () => `ph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
