/**
 * Render one event script through many 303 voices and compare them (#1543).
 */

import {
  analyzeSignal,
  comparePair,
  nullTest,
  spectralDistanceDb,
  type PairMetrics,
  type SignalAnalysis,
} from './metrics';
import type { RbsPatternRef } from './rbsSource';
import type { Voice303Script } from './script';
import { renderCompareVoice, type BackendRunners, type CompareVoice } from './voices';

export interface CompareCase {
  /** Stable label, e.g. `jsynth_kilo#A0`. */
  id: string;
  song: string;
  pattern: Pick<RbsPatternRef, 'device' | 'slot' | 'uses' | 'notes'>;
  tempo: number;
  script: Voice303Script;
}

export interface VoiceResult {
  voice: CompareVoice;
  signal: Float32Array;
  analysis: SignalAnalysis;
  renderMs: number;
  /** Against the case's reference voice; absent for the reference itself. */
  vsReference?: PairMetrics;
  /** The reference scaled/aligned to compare: gain and lag from the null test, for the overlay. */
  alignment?: { gain: number; lagSamples: number };
}

export interface CaseResult {
  case: CompareCase;
  referenceId: string;
  /** Voices that rendered, in registry order. */
  results: VoiceResult[];
  /** Registered voices that could not render, with the reason. */
  skipped: Array<{ id: string; reason: string }>;
  /** `matrix[i][j]`: mean per-frame spectral distance (dB) of `results[j]` from `results[i]`. */
  matrix: number[][];
}

function hasNonFinite(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) return true;
  return false;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function runCase(
  compareCase: CompareCase,
  voices: readonly CompareVoice[],
  runners: BackendRunners,
  referenceId: string,
): Promise<CaseResult> {
  const results: VoiceResult[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const sampleRate = compareCase.script.sampleRate;

  for (const voice of voices) {
    if (!voice.backend) {
      skipped.push({ id: voice.id, reason: voice.unavailableReason ?? 'unavailable' });
      continue;
    }
    const t0 = now();
    try {
      const signal = await renderCompareVoice(voice, compareCase.script, runners);
      if (hasNonFinite(signal)) throw new Error('non-finite samples in render');
      results.push({ voice, signal, analysis: analyzeSignal(signal, sampleRate), renderMs: now() - t0 });
    } catch (err) {
      skipped.push({ id: voice.id, reason: `render failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const reference = results.find((r) => r.voice.id === referenceId) ?? results[0];
  if (reference) {
    for (const r of results) {
      if (r === reference || r.analysis.silent || reference.analysis.silent) continue;
      r.vsReference = comparePair(reference.signal, reference.analysis, r.signal, r.analysis);
      const nt = nullTest(reference.signal, r.signal, Math.round(0.005 * sampleRate), 2 * sampleRate);
      r.alignment = { gain: nt.gain, lagSamples: nt.lagSamples };
    }
  }

  const matrix = results.map((a) =>
    results.map((b) => (a === b ? 0 : a.analysis.silent || b.analysis.silent ? NaN : spectralDistanceDb(a.analysis, b.analysis))),
  );
  return { case: compareCase, referenceId: reference?.voice.id ?? referenceId, results, skipped, matrix };
}
