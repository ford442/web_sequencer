/**
 * Real-world RBS corpus test utilities (#774).
 * Opt-in via RBS_FIXTURE_DIR — default CI uses synthetic tests only.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RbsParser } from '../../importers/rbs/RbsParser';
import { RbsImporter } from '../../importers/rbs/RbsImporter';
import type { RawRbsData } from '../../importers/rbs/types';
import { buildImportSnapshotSummary } from './fixtures';

export interface CorpusManifestEntry {
  /** Filename within the fixture directory. */
  file: string;
  /** Human-readable label. */
  label: string;
  /** Provenance / license note. */
  provenance: string;
  /** Expected format family. */
  format: 'v1.5-legacy' | 'v2.0-iff' | 'v2.0-iff-song' | 'v2.0-iff-pattern';
  /** Minimum independent invariants asserted before any snapshot. */
  expect: {
    parseSuccess: boolean;
    hasSongData?: boolean;
    playMode?: 0 | 1;
    minTb303APatterns?: number;
    minTrakEvents?: number;
    minTempo?: number;
    maxTempo?: number;
    stepCount?: number;
  };
}

export const CORPUS_MANIFEST: CorpusManifestEntry[] = [
  {
    file: 'generated_v20_song_arrangement.rbs',
    label: 'Generated v2.0 song-mode (DEVL + TRAK)',
    provenance: 'Hyphon synthetic builder — RBS42 struct-accurate, license-clear',
    format: 'v2.0-iff-song',
    expect: {
      parseSuccess: true,
      hasSongData: true,
      playMode: 1,
      minTb303APatterns: 32,
      minTrakEvents: 3,
      minTempo: 100,
      maxTempo: 200,
      stepCount: 16,
    },
  },
  {
    file: 'generated_v20_pattern_mode.rbs',
    label: 'Generated v2.0 pattern-mode',
    provenance: 'Hyphon synthetic builder — RBS42 struct-accurate, license-clear',
    format: 'v2.0-iff-pattern',
    expect: {
      parseSuccess: true,
      hasSongData: true,
      playMode: 0,
      minTb303APatterns: 32,
      stepCount: 16,
    },
  },
  {
    file: 'generated_v15_single_303.rbs',
    label: 'Generated v1.5-style subset (single 303 + 808)',
    provenance: 'Hyphon synthetic builder — single DEVL 303, license-clear',
    format: 'v1.5-legacy',
    expect: {
      parseSuccess: true,
      hasSongData: true,
      minTb303APatterns: 32,
      stepCount: 16,
    },
  },
  {
    file: 'generated_v20_song_multi_pattern.rbs',
    label: 'Generated v2.0 song with multi-pattern TRAK',
    provenance: 'Hyphon synthetic builder — RBS42 struct-accurate, license-clear',
    format: 'v2.0-iff-song',
    expect: {
      parseSuccess: true,
      hasSongData: true,
      playMode: 1,
      minTb303APatterns: 32,
      minTrakEvents: 4,
      stepCount: 16,
    },
  },
  // External corpus (downloaded via scripts/fetch-rbs-corpus.sh — not committed by default)
  {
    file: 'jsynth_ReBirth_1.0_Default_Song.rbs',
    label: 'ReBirth 1.0 default song',
    provenance: 'nsauzede/jsynth reverse-engineering reference — Propellerhead factory default',
    format: 'v2.0-iff',
    expect: {
      parseSuccess: true,
      hasSongData: true,
      minTb303APatterns: 1,
      stepCount: 16,
    },
  },
  {
    file: 'jsynth_Silent_Default_Song.rbs',
    label: 'ReBirth silent default',
    provenance: 'nsauzede/jsynth — Propellerhead factory default',
    format: 'v2.0-iff-pattern',
    expect: {
      parseSuccess: true,
      hasSongData: true,
      stepCount: 16,
    },
  },
  {
    file: 'jsynth_kilo.rbs',
    label: "TGV KiloMix '98",
    provenance: 'nsauzede/jsynth — community song for format validation only',
    format: 'v2.0-iff-song',
    expect: {
      parseSuccess: true,
      hasSongData: true,
      playMode: 1,
      minTrakEvents: 1,
      stepCount: 16,
    },
  },
];

export interface CorpusParseSummary {
  file: string;
  label: string;
  version: string;
  tempo: number;
  playMode: number | null;
  hasSongData: boolean;
  tb303APatternCount: number;
  tb303BPatternCount: number;
  drums808PatternCount: number;
  trakEventCount: number;
  songLengthBars: number;
  usedPatternCount: number;
  partAActiveSteps: number;
  partBActiveSteps: number;
  kickActiveSteps: number;
  automationLaneNames: string[];
  automationTargets: string[];
}

const DEFAULT_GENERATED_DIR = resolve(process.cwd(), 'test-fixtures/rbs/generated');
const DEFAULT_CORPUS_DIR = resolve(process.cwd(), 'test-fixtures/rbs/corpus');

/** Resolve fixture directory: RBS_FIXTURE_DIR env, or generated + corpus merge. */
export function resolveCorpusDirs(): string[] {
  const envDir = process.env.RBS_FIXTURE_DIR;
  if (envDir) {
    return [resolve(envDir)];
  }
  const dirs: string[] = [];
  if (existsSync(DEFAULT_GENERATED_DIR)) dirs.push(DEFAULT_GENERATED_DIR);
  if (existsSync(DEFAULT_CORPUS_DIR)) dirs.push(DEFAULT_CORPUS_DIR);
  return dirs;
}

export function isGeneratedCorpusEnabled(): boolean {
  return (
    existsSync(DEFAULT_GENERATED_DIR) &&
    readdirSync(DEFAULT_GENERATED_DIR).some((f) => f.startsWith('generated_') && f.endsWith('.rbs'))
  );
}

export function isExternalCorpusEnabled(): boolean {
  if (process.env.RBS_FIXTURE_DIR) return true;
  if (!existsSync(DEFAULT_CORPUS_DIR)) return false;
  return readdirSync(DEFAULT_CORPUS_DIR).some((f) => f.endsWith('.rbs'));
}

export function isCorpusTestingEnabled(): boolean {
  return isGeneratedCorpusEnabled() || isExternalCorpusEnabled();
}

export function findCorpusFile(filename: string): string | null {
  for (const dir of resolveCorpusDirs()) {
    const path = join(dir, filename);
    if (existsSync(path)) return path;
  }
  return null;
}

export function listAvailableCorpusEntries(kind?: 'generated' | 'external'): CorpusManifestEntry[] {
  const available = CORPUS_MANIFEST.filter((entry) => findCorpusFile(entry.file) !== null);
  if (!kind) return available;
  if (kind === 'generated') return available.filter((e) => e.file.startsWith('generated_'));
  return available.filter((e) => !e.file.startsWith('generated_'));
}

export async function parseCorpusFile(filepath: string): Promise<ReturnType<RbsParser['parseBytes']>> {
  const bytes = new Uint8Array(readFileSync(filepath));
  const parser = new RbsParser();
  return parser.parseBytes(bytes, {
    filename: filepath.split('/').pop() ?? 'fixture.rbs',
    requireExtension: false,
  });
}

export function assertCorpusInvariants(data: RawRbsData, entry: CorpusManifestEntry): void {
  const { expect: exp } = entry;

  if (exp.minTempo !== undefined) {
    if (data.project.tempo < exp.minTempo) {
      throw new Error(`tempo ${data.project.tempo} < min ${exp.minTempo}`);
    }
  }
  if (exp.maxTempo !== undefined) {
    if (data.project.tempo > exp.maxTempo) {
      throw new Error(`tempo ${data.project.tempo} > max ${exp.maxTempo}`);
    }
  }

  if (exp.stepCount !== undefined) {
    if (data.tb303PatternA.steps.length !== exp.stepCount) {
      throw new Error(`tb303A steps ${data.tb303PatternA.steps.length} !== ${exp.stepCount}`);
    }
    if (data.tb303PatternB.steps.length !== exp.stepCount) {
      throw new Error(`tb303B steps ${data.tb303PatternB.steps.length} !== ${exp.stepCount}`);
    }
  }

  if (exp.hasSongData && !data.songData) {
    throw new Error('expected songData to be populated');
  }

  if (data.songData) {
    if (exp.playMode !== undefined && data.songData.glob.playMode !== exp.playMode) {
      throw new Error(`playMode ${data.songData.glob.playMode} !== ${exp.playMode}`);
    }
    if (exp.minTb303APatterns !== undefined && data.songData.patternBanks.tb303A.length < exp.minTb303APatterns) {
      throw new Error(
        `tb303A bank count ${data.songData.patternBanks.tb303A.length} < ${exp.minTb303APatterns}`,
      );
    }
    if (exp.minTrakEvents !== undefined) {
      const total = data.songData.tracks.reduce((n, t) => n + t.eventCount, 0);
      if (total < exp.minTrakEvents) {
        throw new Error(`TRAK events ${total} < ${exp.minTrakEvents}`);
      }
    }
  }
}

export function buildCorpusParseSummary(
  entry: CorpusManifestEntry,
  data: RawRbsData,
  importedSummary: ReturnType<typeof buildImportSnapshotSummary>,
): CorpusParseSummary {
  const sd = data.songData;
  return {
    file: entry.file,
    label: entry.label,
    version: data.version,
    tempo: data.project.tempo,
    playMode: sd?.glob.playMode ?? null,
    hasSongData: !!sd,
    tb303APatternCount: sd?.patternBanks.tb303A.length ?? 0,
    tb303BPatternCount: sd?.patternBanks.tb303B.length ?? 0,
    drums808PatternCount: sd?.patternBanks.drums808.length ?? 0,
    trakEventCount: sd?.tracks.reduce((n, t) => n + t.eventCount, 0) ?? 0,
    songLengthBars: sd?.totalLengthBars ?? 0,
    usedPatternCount: sd?.usedPatternCount ?? 0,
    partAActiveSteps: importedSummary.patternStepCounts.partAActive,
    partBActiveSteps: 0, // filled by caller if needed
    kickActiveSteps: importedSummary.patternStepCounts.kick,
    automationLaneNames: importedSummary.automationLaneNames,
    automationTargets: importedSummary.automationTargets,
  };
}

export async function parseAndSummarizeCorpusEntry(entry: CorpusManifestEntry) {
  const path = findCorpusFile(entry.file);
  if (!path) return null;

  const result = await parseCorpusFile(path);
  if (!result.success) {
    return { entry, path, result, error: result.error };
  }

  assertCorpusInvariants(result.data, entry);

  const importer = new RbsImporter({ expandTo32Steps: true });
  const converted = importer.convertToHyphonSong(result.data);
  if (!converted.success) {
    throw new Error(`import failed for ${entry.file}`);
  }

  const importSummary = buildImportSnapshotSummary(converted.song);
  const summary = buildCorpusParseSummary(entry, result.data, importSummary);

  return { entry, path, result, converted, importSummary, summary };
}

/** Narrow golden summary for corpus regression (stable fields only). */
export function buildCorpusGoldenSummary(summary: CorpusParseSummary) {
  return {
    file: summary.file,
    version: summary.version,
    tempo: Math.round(summary.tempo),
    playMode: summary.playMode,
    hasSongData: summary.hasSongData,
    tb303APatternCount: summary.tb303APatternCount,
    trakEventCount: summary.trakEventCount,
    songLengthBars: summary.songLengthBars,
    usedPatternCount: summary.usedPatternCount,
    partAActiveSteps: summary.partAActiveSteps,
    automationLaneCount: summary.automationLaneNames.length,
    automationTargets: summary.automationTargets.sort(),
  };
}
