/**
 * What an offline bounce of the sampler does NOT reproduce (#1273 Part C).
 *
 * Stretch-mode banks render through the offline vocal host
 * (`vocal/offlineVocalHost.ts`): a second Rubber Band module in the export's
 * OfflineAudioContext, driven by the live trigger. Stretch, formant pitch,
 * the rb_fx_* chain, Phoneme Painter edits and the V2 vowel crossfade are in
 * the bounce. What is still live-only, per bank:
 *
 * - everything above, when the host could not load (`unsupportedReason`):
 *   that bank's stem is left out — never replaced by dry TTS;
 * - HARM layers (the harmonizer lives only in the realtime graph);
 * - a note FX chain on a stretch bank (the host plays the steps).
 */

import type { Note, PartSequence, SamplerBankParams } from '@/types';

export type OfflineVocalGap = 'rubber-band' | 'vocal-fx' | 'phoneme-edits' | 'harmonizer' | 'note-fx';

export interface OfflineVocalBankReport {
  /** 0-based sampler bank. */
  bank: number;
  sampleName: string;
  gaps: OfflineVocalGap[];
  /** Why the offline Rubber Band host could not render this bank; its stem was left out. */
  unsupportedReason?: string;
}

export const OFFLINE_VOCAL_GAP_LABELS: Record<OfflineVocalGap, string> = {
  'rubber-band': 'stretch / formant pitch',
  'vocal-fx': 'vocal FX',
  'phoneme-edits': 'phoneme edits',
  harmonizer: 'HARM layers',
  'note-fx': 'note FX',
};

/** Worklet FX params: non-zero on the bank or a step means the live chain colours the voice. */
const VOCAL_FX_KEYS = [
  'freeze', 'grainJitter', 'grainPanSpread', 'granularPitchShift', 'grainPitchQuantize',
  'vocalChorus', 'subHarmonics', 'spectralComp', 'bitcrush', 'autoTune', 'microtonalVariance',
  'drumDuckDepth', 'phonemeFilterMod', 'volumeFilterMod', 'gateDepth', 'breathIntensity',
  'phonemeDelayAmount',
] as const satisfies readonly (keyof SamplerBankParams & keyof Note)[];

const hasVocalFx = (source: Partial<Record<(typeof VOCAL_FX_KEYS)[number] | 'downsample', unknown>>) =>
  VOCAL_FX_KEYS.some((key) => typeof source[key] === 'number' && (source[key] as number) > 0)
  || (typeof source.downsample === 'number' && source.downsample > 1);

function notesOf(sequence: PartSequence | null | undefined): Note[] {
  return (sequence?.steps ?? []).filter((step): step is Note => !!step);
}

/** True when a bank's stem comes from the offline vocal host rather than the dry renderer. */
export function usesOfflineVocalHost(params: SamplerBankParams | null | undefined): boolean {
  return params?.mode === 'stretch';
}

/**
 * Banks whose live sound an offline bounce would miss. Only banks that play
 * at least one note in `sequences` are reported.
 */
export function describeOfflineVocalSupport(input: {
  sampler: readonly SamplerBankParams[];
  sequences: readonly (PartSequence | null | undefined)[];
  harmonizerActive?: boolean;
  /** Banks the offline host could not render, with the reason. */
  unsupported?: ReadonlyMap<number, string>;
  /** Banks whose note FX chain is active. */
  noteFxBanks?: ReadonlySet<number>;
}): OfflineVocalBankReport[] {
  const reports: OfflineVocalBankReport[] = [];
  input.sampler.forEach((params, bank) => {
    const notes = notesOf(input.sequences[bank]);
    if (!params || notes.length === 0) return;

    const gaps: OfflineVocalGap[] = [];
    const unsupportedReason = usesOfflineVocalHost(params) ? input.unsupported?.get(bank) : undefined;
    if (unsupportedReason !== undefined) {
      gaps.push('rubber-band');
      if (hasVocalFx(params) || notes.some(hasVocalFx)) gaps.push('vocal-fx');
      if (notes.some((n) => (n.phonemes?.length ?? 0) > 0)) gaps.push('phoneme-edits');
    } else if (usesOfflineVocalHost(params) && input.noteFxBanks?.has(bank)) {
      gaps.push('note-fx');
    }
    if (input.harmonizerActive) gaps.push('harmonizer');
    if (gaps.length === 0) return;
    reports.push(unsupportedReason !== undefined
      ? { bank, sampleName: params.sampleName, gaps, unsupportedReason }
      : { bank, sampleName: params.sampleName, gaps });
  });
  return reports;
}

/** One line for the export toast / badge tooltip, or null when nothing is missing. */
export function formatOfflineVocalWarning(reports: readonly OfflineVocalBankReport[]): string | null {
  if (reports.length === 0) return null;
  const parts: string[] = [];
  const unsupported = reports.filter((r) => r.unsupportedReason !== undefined);
  if (unsupported.length > 0) {
    const banks = unsupported.map((r) => `bank ${r.bank + 1} (${r.unsupportedReason})`).join('; ');
    parts.push(`Vocal freeze unsupported, stem left out rather than rendered dry: ${banks}.`);
  }
  const partial = reports.filter((r) => r.unsupportedReason === undefined);
  if (partial.length > 0) {
    const banks = partial
      .map((r) => `bank ${r.bank + 1} (${r.gaps.map((g) => OFFLINE_VOCAL_GAP_LABELS[g]).join(', ')})`)
      .join('; ');
    parts.push(`Not in the sampler bounce: ${banks}.`);
  }
  return parts.join(' ');
}
