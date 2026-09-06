/**
 * Apply imported HyphonSong extras (PCF, per-slot 303 params) onto live engines.
 */

import type { Bass2Params, SynthParams } from '../../types';
import type { HyphonSong, PcfSettings } from './types';
import { Open303Manager } from '../../engines/Open303Manager';

export function convert303Waveform(waveform: string): 'saw' | 'sqr' {
  return waveform === '303-sqr' || waveform === 'square' ? 'sqr' : 'saw';
}

export function pcfFilterToPcfSettings(
  pcf: NonNullable<HyphonSong['pcfFilter']>,
): PcfSettings {
  const filterType: PcfSettings['filterType'] =
    pcf.filterType === 'bp' ? 'bp' : pcf.filterType === 'hp' ? 'hp' : 'lp';
  return {
    enabled: pcf.enabled,
    filterType,
    cutoff: pcf.cutoff,
    resonance: pcf.resonance,
    envAmount: pcf.envAmount,
    decay: pcf.decay,
    pattern: [...pcf.pattern],
    target: { ...pcf.target },
  };
}

export function applyPcfFilterToEffect(
  pcfFilter: HyphonSong['pcfFilter'] | undefined,
  pcfEffect: { loadSettings: (settings: PcfSettings) => void } | null | undefined,
): boolean {
  if (!pcfFilter || !pcfEffect) return false;
  pcfEffect.loadSettings(pcfFilterToPcfSettings(pcfFilter));
  return true;
}

export type TrackParamStorage = NonNullable<
  NonNullable<HyphonSong['songArrangement']>['trackParamStorage']
>;

function applyLeadOrBass1(
  open303: Open303Manager,
  voice: 'lead' | 'bass1',
  params: Partial<SynthParams>,
): void {
  const cutoff = params.filterCutoff ?? 800;
  const resonance = params.filterResonance ?? 0.5;
  const decay = params.decay ?? 0.3;
  const volume = params.volume ?? 0.8;
  const waveform = convert303Waveform(String(params.waveform ?? ''));
  const payload = {
    filterCutoff: cutoff,
    filterResonance: resonance,
    filterMode: params.filterMode ?? 0,
    decay,
    volume,
    pan: params.pan,
  };
  if (voice === 'lead') {
    open303.applyLead303Params(payload, waveform);
  } else {
    open303.applyBass1Params(payload, waveform);
  }
}

/** Apply per-slot 303 knobs to Open303 + mutate live synth refs (no React setState). */
export function applyTrackParamSlotToEngine(
  storage: TrackParamStorage | null | undefined,
  track: 'partA' | 'partB' | 'bass2',
  slotIndex: number,
  open303: Open303Manager | null | undefined,
  refs: {
    synthA: SynthParams;
    synthB: SynthParams;
    bass2: Bass2Params;
  },
): { synthA?: SynthParams; synthB?: SynthParams; bass2?: Bass2Params } {
  if (!storage || slotIndex < 0) return {};
  const updated: { synthA?: SynthParams; synthB?: SynthParams; bass2?: Bass2Params } = {};

  if (track === 'partA') {
    const slot = storage.synthA[slotIndex];
    if (!slot) return {};
    const merged = { ...refs.synthA, ...slot };
    updated.synthA = merged;
    if (open303) applyLeadOrBass1(open303, 'lead', merged);
  } else if (track === 'partB') {
    const slot = storage.synthB[slotIndex];
    if (!slot) return {};
    const merged = { ...refs.synthB, ...slot };
    updated.synthB = merged;
    if (open303) applyLeadOrBass1(open303, 'bass1', merged);
  } else {
    const slot = storage.bass2[slotIndex];
    if (!slot) return {};
    const merged = { ...refs.bass2, ...slot } as Bass2Params;
    updated.bass2 = merged;
    if (open303) open303.applyBass2Params(merged);
  }

  return updated;
}
