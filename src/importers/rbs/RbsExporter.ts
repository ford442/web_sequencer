/**
 * RBS Exporter — write ReBirth RB-338 compatible `.rbs` files from Hyphon songs.
 *
 * Phase 1: IFF CAT RB40 pattern-mode export (HEAD + GLOB + DEVL + minimal TRKL).
 */

import type { HyphonSong } from './types';
import type { SavedSongData } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';
import { buildIffRbsFile } from './iffBuilder';
import {
  buildDrumPatternFromHyphon,
  collectExportWarnings,
  partSequenceToTb303Steps,
  pcfSettingsToDevlPayload,
  synthParamsToTb303DeviceParams,
} from './rbsEncoders';
import {
  DEFAULT_RBS_EXPORT_OPTIONS,
  type RbsExportOptions,
  type RbsExportResult,
} from './exporter-types';

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

    if (opts.mode === 'song') {
      warnings.push('Song-mode TRAK export is not yet implemented — writing pattern mode.');
    }

    if (opts.versionTarget === '1.5') {
      warnings.push('v1.5 export uses IFF DEVL with a single TB-303 device.');
    }

    const collapse = opts.collapse32Steps;
    const partA = this.resolvePartSequence(song, opts.tb303ASource);
    const partB = this.resolvePartSequence(song, opts.tb303BSource);

    const tb303ASteps = partSequenceToTb303Steps(partA, collapse);
    const tb303BSteps = partSequenceToTb303Steps(partB, collapse);

    const metaA = song.rbsMetadata?.tb303AParams;
    const metaB = song.rbsMetadata?.tb303BParams;

    const tb303AParams = synthParamsToTb303DeviceParams(song.params.synthA, metaA);
    const tb303BParams = synthParamsToTb303DeviceParams(
      song.params.bass2 ?? song.params.synthB,
      metaB,
    );

    const drumKit = opts.drumKit === 'auto'
      ? (song.params.drumKit ?? '808')
      : opts.drumKit;

    const drumPattern = buildDrumPatternFromHyphon(song.pattern, collapse, drumKit);

    const include303B = opts.versionTarget === '2.0' && opts.include303B;

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

    const bytes = buildIffRbsFile({
      playMode: 0,
      tempoBpm: song.tempo,
      shuffle: Math.round(song.swing ?? 64),
      loopStartBars: 0,
      loopEndBars: 1,
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
      trakTracks: Array.from({ length: 6 }, () => ({ events: [] })),
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

/** Build a minimal HyphonSong from saved project data for export. */
export function hyphonSongFromSavedData(data: SavedSongData): HyphonSong {
  return {
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
  };
}

export default RbsExporter;
