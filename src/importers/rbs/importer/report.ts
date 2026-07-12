import type { RawRbsData } from '../types';
import type { ImportReport } from '../importer-types';
import { isV15SubsetVersion } from '../parser-types';
import { inferDevicesPresent } from '../deviceInference';
import type { ImporterContext } from './importerContext';

/** Warnings for v1.5 subset files missing v2.0 devices/features. */
export function buildFormatWarnings(raw: RawRbsData): string[] {
  const warnings: string[] = [];
  const devices = raw.devicesPresent ?? inferDevicesPresent(raw);

  if (isV15SubsetVersion(raw.version)) {
    if (!devices.includes('303-2')) {
      warnings.push('v1.5 subset: TB-303 #2 not present — partB/synthB pattern left empty');
    }
    if (!devices.includes('909')) {
      warnings.push('v1.5 subset: TR-909 not present — using TR-808 drum mapping');
    }
    if (raw.songData?.glob.playMode === 1 && (raw.songData.tracks.length === 0)) {
      warnings.push('v1.5 subset: song mode requested but TRKL arrangement data is missing');
    }
  }

  return warnings;
}

export function buildPcfReportStats(raw: RawRbsData): ImportReport['pcfStats'] {
  const p = raw.pcf;
  const patternMin = p.pattern.length > 0 ? Math.min(...p.pattern) : 0;
  const patternMax = p.pattern.length > 0 ? Math.max(...p.pattern) : 0;
  const targets: string[] = [];
  if (p.target.tb303A) targets.push('synthA');
  if (p.target.tb303B) targets.push('synthB');
  if (p.target.drums) targets.push('drums');

  const source: 'devl' | 'legacy' | 'none' =
    raw.songData ? 'devl' : (p.enabled ? 'legacy' : 'none');

  return {
    waveIndex: p.waveIndex ?? -1,
    patternMin,
    patternMax,
    patternVariance: patternMax - patternMin,
    targets,
    source,
  };
}

export function extractTb303Params(tb303: {
  cutoff: number;
  resonance: number;
  envMod: number;
  decay: number;
  accent: number;
  waveform: 0 | 1;
  distortion?: number;
  delaySend?: number;
}) {
  const { ...params } = tb303;
  return params;
}

/** Count total steps across all patterns. */
export function countSteps(ctx: ImporterContext, raw: RawRbsData): number {
  const stepLength = ctx.options.expandTo32Steps ? 32 : raw.project.patternLength;
  return stepLength * 6;
}
