/**
 * tb303VoiceExtra.ts — the `model303Extra` blob persisted next to `model303`
 * on SynthParams / Bass2Params (Phase L2 + L3), and the freeze rule that
 * reads it.
 *
 * Kept separate from TB303Models.ts: the catalog decides *which* voice a part
 * plays, this blob carries per-song state for the high-fid voice (A/B request
 * and diode-ladder coefficients). Both fields are optional, so songs saved
 * before L2/L3 load unchanged and older builds simply ignore the blob.
 */

import {
  CANONICAL_HIGHFID_COEFFICIENTS,
  normalizeHighFidCoefficients,
  type HighFidCoefficients,
} from '../audio-worklets/liveHighFidCoefficients';
import { HIGHFID_CPU_MODEL_ID } from '../audio/offline/OfflineHighFid303Engine';
import { abFreezeSide, clampAbMix, type LiveAbSettings } from './LiveHighFidAbPair';
import { isLiveHighFidModel, normalizeTB303Model } from './TB303Models';

export interface TB303VoiceExtra {
  /** Live A/B (Phase L2). Only meaningful while `model303` is `live-highfid`. */
  ab?: LiveAbSettings;
  /**
   * Diode-ladder coefficients (Phase L3). Absent = canonical preset; a song
   * only carries this once the user moved a coefficient.
   */
  highFidCoefficients?: HighFidCoefficients;
}

/** Sanitize a loaded / received blob. Returns undefined when nothing survives. */
export function normalizeTB303VoiceExtra(raw: unknown): TB303VoiceExtra | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as { ab?: unknown; highFidCoefficients?: unknown };
  const out: TB303VoiceExtra = {};
  if (source.ab && typeof source.ab === 'object') {
    const ab = source.ab as { armed?: unknown; mix?: unknown };
    out.ab = { armed: ab.armed === true, mix: clampAbMix(ab.mix) };
  }
  const coeffs = normalizeHighFidCoefficients(source.highFidCoefficients);
  if (coeffs) out.highFidCoefficients = coeffs;
  return out.ab || out.highFidCoefficients ? out : undefined;
}

/** Voices whose freeze renders the diode ladder and so honours coefficients. */
export function usesHighFidCoefficients(model303: string | undefined): boolean {
  return isLiveHighFidModel(model303) || model303 === HIGHFID_CPU_MODEL_ID;
}

export interface TB303FreezeJob {
  /** Offline engine id handed to render303Offline. */
  modelId: string;
  /** Which A/B side (or the plain model) the freeze records. */
  side: 'stock' | 'highfid' | 'model';
  /** Coefficients for a `highfid-cpu` render; undefined for other engines. */
  highFidCoefficients?: HighFidCoefficients;
  /** Where the coefficients came from — `canonical` unless the song stored some. */
  coefficientSource?: 'song' | 'canonical';
}

/**
 * What a freeze / export / capture of one 303 part renders.
 *
 *  - `live-highfid` with A/B armed records **one** side — high-fid at blend
 *    ≥ 0.5, stock below. A blend is never frozen: that needs the offline
 *    graph compiler (#1235) to render both sides.
 *  - The high-fid side (and `highfid-cpu`) renders through `highfid-cpu` with
 *    the song's stored coefficients, or the canonical preset if it stored none.
 *  - Everything else freezes as its own model id, unchanged from L1.
 */
export function resolveTB303FreezeJob(voice: {
  model303?: string;
  engine303?: string;
  model303Extra?: TB303VoiceExtra;
}): TB303FreezeJob {
  const model = normalizeTB303Model(voice.model303, voice.engine303);
  const extra = normalizeTB303VoiceExtra(voice.model303Extra);

  if (isLiveHighFidModel(model) && extra?.ab?.armed && abFreezeSide(extra.ab.mix) === 'stock') {
    return { modelId: 'stock-open303', side: 'stock' };
  }

  if (usesHighFidCoefficients(model)) {
    const stored = extra?.highFidCoefficients;
    return {
      modelId: HIGHFID_CPU_MODEL_ID,
      side: 'highfid',
      highFidCoefficients: stored ? { ...stored } : { ...CANONICAL_HIGHFID_COEFFICIENTS },
      coefficientSource: stored ? 'song' : 'canonical',
    };
  }

  return { modelId: model, side: 'model' };
}
