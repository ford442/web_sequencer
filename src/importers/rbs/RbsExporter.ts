/**
 * RBS Exporter — write ReBirth RB-338 compatible `.rbs` files from Hyphon songs.
 *
 * Supports IFF CAT RB40 pattern-mode and song-mode (GLOB + DEVL + TRKL/TRAK) export.
 */

import type { HyphonAutomationLane, HyphonSong, RbsTrakEvent } from './types';
import type { PartSequence, ResolvedTrakEvent, SavedSongData, UnifiedAutomationLane } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';
import { resolveTrakEventKind } from './trakControllers';
import { MAX_TRACK_PATTERN_SLOTS } from '../../constants';
import { buildIffRbsFile } from './iffBuilder';
import {
  buildDrumPatternFromHyphon,
  buildDrumPatternsFromTrackStorage,
  collectExportWarnings,
  partSequenceToTb303Steps,
  pcfSettingsToDevlPayload,
  synthParamsToTb303DeviceParams,
} from './rbsEncoders';
import {
  buildSongModeTrakTracks,
  countUsedPatternSlots,
  summarizePatternSelectUsage,
} from './trakExport';
import {
  DEFAULT_RBS_EXPORT_OPTIONS,
  type RbsExportOptions,
  type RbsExportResult,
} from './exporter-types';
import type { Tb303Step, DrumPattern } from './types';

export class RbsExporter {
  private options: RbsExportOptions;

  constructor(options: Partial<RbsExportOptions> = {}) {
    this.options = { ...DEFAULT_RBS_EXPORT_OPTIONS, ...options };
  }

  setOptions(options: Partial<RbsExportOptions>): void {
    this.options = { ...this.options, ...options };
  }

  getOptions(): RbsExportOptions {
    return { ...this.options };
  }

  /** Export HyphonSong to raw `.rbs` bytes. */
  exportToBytes(song: HyphonSong, options?: Partial<RbsExportOptions>): { bytes: Uint8Array; warnings: string[] } {
    const opts = { ...this.options, ...options };
    const warnings = collectExportWarnings(song);

    if (opts.versionTarget === '1.5') {
      warnings.push('v1.5 export uses IFF DEVL with a single TB-303 device.');
    }

    const collapse = opts.collapse32Steps;
    const arrangement = song.songArrangement;
    const isSongExport = opts.mode === 'song' && arrangement?.mode === 'song';

    if (opts.mode === 'song' && !isSongExport) {
      warnings.push('Song-mode export requested but no song arrangement present — writing pattern mode.');
    }

    const drumKit = opts.drumKit === 'auto'
      ? (song.params.drumKit ?? '808')
      : opts.drumKit;

    const include303B = opts.versionTarget === '2.0' && opts.include303B;

    let tb303ASteps: Tb303Step[] | Tb303Step[][] | undefined;
    let tb303BSteps: Tb303Step[] | Tb303Step[][] | undefined;
    let drumPattern: DrumPattern | DrumPattern[] | undefined;

    if (isSongExport && arrangement) {
      const slotCount = Math.min(
        MAX_TRACK_PATTERN_SLOTS,
        countUsedPatternSlots(arrangement.trackStorage),
      );

      if (slotCount > MAX_TRACK_PATTERN_SLOTS) {
        warnings.push(
          `Song uses ${slotCount} pattern slots; Hyphon supports ${MAX_TRACK_PATTERN_SLOTS} per track — exporting first ${MAX_TRACK_PATTERN_SLOTS} slots.`,
        );
      }

      const exportSlots = Math.min(MAX_TRACK_PATTERN_SLOTS, slotCount);

      tb303ASteps = arrangement.trackStorage.partA
        .slice(0, exportSlots)
        .map((seq) => partSequenceToTb303Steps(seq ?? { steps: Array(16).fill(null) }, collapse));

      const partBSource = opts.tb303BSource === 'bass2' ? arrangement.trackStorage.bass2 : arrangement.trackStorage.partB;
      tb303BSteps = include303B
        ? partBSource
          .slice(0, exportSlots)
          .map((seq) => partSequenceToTb303Steps(seq ?? { steps: Array(16).fill(null) }, collapse))
        : undefined;

      drumPattern = buildDrumPatternsFromTrackStorage(
        arrangement.trackStorage,
        exportSlots,
        collapse,
        drumKit,
      );
    } else {
      const partA = this.resolvePartSequence(song, opts.tb303ASource);
      const partB = this.resolvePartSequence(song, opts.tb303BSource);
      tb303ASteps = partSequenceToTb303Steps(partA, collapse);
      tb303BSteps = include303B ? partSequenceToTb303Steps(partB, collapse) : undefined;
      drumPattern = buildDrumPatternFromHyphon(song.pattern, collapse, drumKit);
    }

    const metaA = song.rbsMetadata?.tb303AParams;
    const metaB = song.rbsMetadata?.tb303BParams;

    const tb303AParams = synthParamsToTb303DeviceParams(song.params.synthA, metaA);
    const tb303BParams = synthParamsToTb303DeviceParams(
      song.params.bass2 ?? song.params.synthB,
      metaB,
    );

    let pcfPayload: ReturnType<typeof pcfSettingsToDevlPayload> | undefined;
    if (opts.includePcf) {
      const pcf = song.rbsMetadata?.pcfSettings ?? (song.pcfFilter ? {
        enabled: song.pcfFilter.enabled,
        cutoff: song.pcfFilter.cutoff,
        resonance: song.pcfFilter.resonance,
        envAmount: song.pcfFilter.envAmount,
        decay: song.pcfFilter.decay,
        filterType: song.pcfFilter.filterType === 'lp' ? 'lp' as const : 'bp' as const,
        pattern: [...song.pcfFilter.pattern],
        target: { ...song.pcfFilter.target },
        waveIndex: 1,
      } : undefined);

      if (pcf) {
        pcfPayload = pcfSettingsToDevlPayload(pcf);
      } else {
        warnings.push('PCF filter data not available — exporting disabled PCF chunk.');
        pcfPayload = { enabled: false };
      }
    } else {
      pcfPayload = { enabled: false };
    }

    const headVersion = opts.versionTarget === '1.5'
      ? 'ReBirth RB-338 v1.5'
      : 'ReBirth RB-338 v2.0';

    const playMode: 0 | 1 = isSongExport ? 1 : 0;
    const loopStartBars = isSongExport ? (arrangement!.loopStart ?? 0) : 0;
    const loopEndBars = isSongExport
      ? (arrangement!.loopEnd ?? Math.max(1, arrangement!.songStructure.length))
      : 1;

    const trakTracks = isSongExport
      ? buildSongModeTrakTracks(song)
      : undefined;

    if (isSongExport && arrangement?.trakEvents?.length) {
      const usage = summarizePatternSelectUsage(arrangement.trakEvents);
      if (usage.maxPatternIndex >= MAX_TRACK_PATTERN_SLOTS) {
        warnings.push(
          `Arrangement references pattern index ${usage.maxPatternIndex}; Hyphon maps to ${MAX_TRACK_PATTERN_SLOTS} slots per track.`,
        );
      }
    }

    const bytes = buildIffRbsFile({
      playMode,
      tempoBpm: song.tempo,
      shuffle: Math.round(song.swing ?? 64),
      loopStartBars,
      loopEndBars,
      headVersionString: headVersion,
      songName: opts.songName ?? song.metadata.name,
      devl: {
        tb303ASteps,
        tb303BSteps: include303B ? tb303BSteps : undefined,
        tb303AParams,
        tb303BParams: include303B ? tb303BParams : undefined,
        drumPattern,
        drumKit,
        include303B,
        pcf: pcfPayload,
        mixrPcfId: 0,
      },
      trakTracks,
    });

    return { bytes, warnings };
  }

  exportToBlob(song: HyphonSong, options?: Partial<RbsExportOptions>): RbsExportResult {
    try {
      const { bytes, warnings } = this.exportToBytes(song, options);
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
      return { success: true, blob, bytes, warnings };
    } catch (err) {
      return {
        success: false,
        warnings: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private resolvePartSequence(song: HyphonSong, track: TrackKey) {
    const pattern = song.pattern;
    if (track === 'sampler') {
      return { steps: Array(16).fill(null) };
    }
    const seq = pattern[track];
    if (Array.isArray(seq)) {
      return seq[0] ?? { steps: Array(16).fill(null) };
    }
    return seq ?? { steps: Array(16).fill(null) };
  }
}

/** Export HyphonSong as a downloadable `.rbs` Blob. */
export function exportRbsFile(
  song: HyphonSong,
  options?: Partial<RbsExportOptions>,
): Blob {
  const exporter = new RbsExporter(options);
  const result = exporter.exportToBlob(song);
  if (!result.success || !result.blob) {
    throw new Error(result.error ?? 'RBS export failed');
  }
  return result.blob;
}

const HYPHON_LANE_TARGETS = new Set<HyphonAutomationLane['target']>([
  'synthA', 'synthB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'master',
]);

function asPartSlots(raw: unknown): (PartSequence | null)[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((slot) => {
    if (slot && typeof slot === 'object' && 'steps' in slot) {
      return slot as PartSequence;
    }
    return null;
  });
}

function unifiedLanesToHyphon(lanes?: UnifiedAutomationLane[]): HyphonAutomationLane[] | undefined {
  if (!lanes?.length) return undefined;
  const converted: HyphonAutomationLane[] = [];
  for (const lane of lanes) {
    if (!HYPHON_LANE_TARGETS.has(lane.target as HyphonAutomationLane['target'])) continue;
    converted.push({
      target: lane.target as HyphonAutomationLane['target'],
      parameter: lane.parameter,
      name: lane.name,
      points: lane.points.map((p) => [p.step, p.value]),
      interpolation: lane.interpolation,
      originalRange: lane.originalRange ?? [0, 1],
    });
  }
  return converted.length > 0 ? converted : undefined;
}

export function resolvedTrakToRbsEvents(events: ResolvedTrakEvent[]): RbsTrakEvent[] {
  return events.map((ev) => ({
    deltaTicks: 0,
    absoluteTicks: ev.tick,
    trackIndex: ev.trackIndex,
    controllerId: ev.ctrlId,
    value: ev.value,
    eventKind: ev.eventKind ?? resolveTrakEventKind(ev.trackIndex, ev.ctrlId),
  }));
}

/** True when song mode is active or the arrangement uses more than slot 0. */
export function shouldExportRbsSongMode(
  data: SavedSongData,
  isSongModeActive?: boolean,
): boolean {
  if (isSongModeActive) return true;
  const structure = data.songStructure as Array<Record<string, number | null>> | undefined;
  if (!structure?.length) return false;
  for (const measure of structure) {
    if (!measure) continue;
    for (const value of Object.values(measure)) {
      if (typeof value === 'number' && value > 0) return true;
    }
  }
  return false;
}

export interface HyphonSongFromSavedExtras {
  trakEvents?: ResolvedTrakEvent[] | null;
  isSongModeActive?: boolean;
}

/** Build a HyphonSong from saved project data for export (includes arrangement when present). */
export function hyphonSongFromSavedData(
  data: SavedSongData,
  extras: HyphonSongFromSavedExtras = {},
): HyphonSong {
  const ts = data.trackStorage as Record<string, unknown> | undefined;
  const structure = (data.songStructure ?? []) as Array<Record<string, number | null>>;
  const trakFromData = data.rbsTrakEvents?.length
    ? resolvedTrakToRbsEvents(data.rbsTrakEvents)
    : undefined;
  const trakFromRef = extras.trakEvents?.length
    ? resolvedTrakToRbsEvents(extras.trakEvents)
    : undefined;
  const trakEvents = trakFromRef ?? trakFromData;

  const isSong = shouldExportRbsSongMode(data, extras.isSongModeActive);

  const song: HyphonSong = {
    version: 1,
    metadata: {
      name: data.pattern ? 'Hyphon Song' : 'Untitled',
      importedFrom: 'rbs',
      importedAt: new Date(),
    },
    tempo: data.tempo,
    timeSignature: [4, 4],
    swing: 64,
    pattern: data.pattern,
    params: {
      synthA: data.params.synthA,
      synthB: data.params.synthB,
      bass2: data.params.bass2,
      kick: data.params.kick,
      snare: data.params.snare,
      closedHat: data.params.closedHat,
      openHat: data.params.openHat,
      drumKit: data.params.kick ? '808' : undefined,
    },
    automation: unifiedLanesToHyphon(data.automationLanes),
    pcfFilter: data.pcfFilter,
  };

  if (ts && structure.length > 0) {
    song.songArrangement = {
      mode: isSong ? 'song' : 'pattern',
      trackStorage: {
        partA: asPartSlots(ts.partA),
        partB: asPartSlots(ts.partB),
        bass2: asPartSlots(ts.bass2),
        kick: asPartSlots(ts.kick),
        snare: asPartSlots(ts.snare),
        closedHat: asPartSlots(ts.closedHat),
        openHat: asPartSlots(ts.openHat),
      },
      songStructure: structure,
      activeTrackSlots: data.activeTrackSlots,
      loopStart: data.rbsLoopStart,
      loopEnd: data.rbsLoopEnd,
      trakEvents,
      trackParamStorage: data.trackParamStorage,
    };
  }

  return song;
}

export default RbsExporter;
