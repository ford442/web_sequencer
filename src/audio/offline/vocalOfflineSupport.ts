/**
 * What an offline bounce of the sampler can NOT reproduce yet (#1273 Part C).
 *
 * compileOfflineGraph (#1235) builds the master patch offline, but sampler
 * stems still come from patternRenderer's dry, varispeed AudioBufferSource.
 * The live vocal strip — Rubber Band stretch + formant-preserving pitch, the
 * rb_fx_* chain, Phoneme Painter edits (elasticity, bend, volume) and the
 * harmonizer layers — only runs in the realtime worklet. Until the offline
 * compiler instantiates that same module, export says so per bank instead of
 * shipping dry TTS as if it were the mix.
 */

import type { Note, PartSequence, SamplerBankParams } from '@/types';

export type OfflineVocalGap = 'rubber-band' | 'vocal-fx' | 'phoneme-edits' | 'harmonizer';

export interface OfflineVocalBankReport {
  /** 0-based sampler bank. */
  bank: number;
  sampleName: string;
  gaps: OfflineVocalGap[];
}

export const OFFLINE_VOCAL_GAP_LABELS: Record<OfflineVocalGap, string> = {
  'rubber-band': 'stretch / formant pitch',
  'vocal-fx': 'vocal FX',
  'phoneme-edits': 'phoneme edits',
  harmonizer: 'HARM layers',
};

/** Worklet FX params: non-zero on the bank or a step means the live chain colours the voice. */
const VOCAL_FX_KEYS = [
  'freeze', 'grainJitter', 'grainPanSpread', 'granularPitchShift', 'grainPitchQuantize',
  'vocalChorus', 'subHarmonics', 'spectralComp', 'bitcrush', 'autoTune', 'microtonalVariance',
  'drumDuckDepth', 'phonemeFilterMod', 'volumeFilterMod', 'gateDepth', 'breathIntensity',
] as const satisfies readonly (keyof SamplerBankParams & keyof Note)[];

const hasVocalFx = (source: Partial<Record<(typeof VOCAL_FX_KEYS)[number] | 'downsample', unknown>>) =>
  VOCAL_FX_KEYS.some((key) => typeof source[key] === 'number' && (source[key] as number) > 0)
  || (typeof source.downsample === 'number' && source.downsample > 1);

function notesOf(sequence: PartSequence | null | undefined): Note[] {
  return (sequence?.steps ?? []).filter((step): step is Note => !!step);
}

/**
 * Banks whose live sound an offline bounce would miss. Only banks that play
 * at least one note in `sequences` are reported.
 */
export function describeOfflineVocalSupport(input: {
  sampler: readonly SamplerBankParams[];
  sequences: readonly (PartSequence | null | undefined)[];
  harmonizerActive?: boolean;
}): OfflineVocalBankReport[] {
  const reports: OfflineVocalBankReport[] = [];
  input.sampler.forEach((params, bank) => {
    const notes = notesOf(input.sequences[bank]);
    if (!params || notes.length === 0) return;

    const gaps: OfflineVocalGap[] = [];
    if (params.mode === 'stretch') {
      gaps.push('rubber-band');
      if (hasVocalFx(params) || notes.some(hasVocalFx)) gaps.push('vocal-fx');
      if (notes.some((n) => (n.phonemes?.length ?? 0) > 0)) gaps.push('phoneme-edits');
    }
    if (input.harmonizerActive) gaps.push('harmonizer');
    if (gaps.length > 0) reports.push({ bank, sampleName: params.sampleName, gaps });
  });
  return reports;
}

/** One line for the export toast / badge tooltip, or null when nothing is missing. */
export function formatOfflineVocalWarning(reports: readonly OfflineVocalBankReport[]): string | null {
  if (reports.length === 0) return null;
  const banks = reports
    .map((r) => `bank ${r.bank + 1} (${r.gaps.map((g) => OFFLINE_VOCAL_GAP_LABELS[g]).join(', ')})`)
    .join('; ');
  return `Vocal FX freeze unsupported: sampler stems are dry and do not match what you hear — ${banks}.`;
}
