/**
 * Standard MIDI File (SMF) types.
 *
 * Mirrors the shape of the RBS importer's type split (RawRbsData → HyphonSong)
 * so the rest of the app can treat SMF as a second, independent interchange
 * path: `src/importers/smf/**` never imports from `src/importers/rbs/**`
 * and vice versa.
 */

import type { Pattern, PartSequence } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';

// ============================================================================
// BINARY PARSING TYPES
// ============================================================================

/** Parser error types for granular error handling (mirrors RbsParserError). */
export type SmfParserError =
  | { type: 'INVALID_FORMAT'; message: string }
  | { type: 'UNSUPPORTED_FORMAT'; format: number }
  | { type: 'CORRUPTED_DATA'; section: string; details?: string; offset?: number }
  | { type: 'READ_ERROR'; message: string };

export type SmfParserResult =
  | { success: true; data: ParsedSmf }
  | { success: false; error: SmfParserError };

/** A resolved note (note-on paired with its note-off / sustain release). */
export interface SmfNoteEvent {
  /** Source track index (0-based, order tracks appear in the file). */
  trackIndex: number;
  /** MIDI channel, 0-based (0-15; channel 10 on a keyboard is index 9). */
  channel: number;
  /** MIDI note number, 0-127. */
  note: number;
  /** Note-on velocity, 1-127. */
  velocity: number;
  /** Tick (absolute, from start of track) the note-on fired. */
  startTick: number;
  /** Tick the note actually ends — after sustain (CC64) release if held. */
  endTick: number;
  /** True when the note never received a matching note-off / EOT cutoff cleanly (still reported, not dropped). */
  truncated?: boolean;
}

export interface SmfControlChangeEvent {
  trackIndex: number;
  channel: number;
  controller: number;
  value: number;
  tick: number;
}

export interface SmfProgramChangeEvent {
  trackIndex: number;
  channel: number;
  program: number;
  tick: number;
}

export interface SmfTempoEvent {
  tick: number;
  microsecondsPerQuarter: number;
  bpm: number;
}

export interface SmfTimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface SmfTrackMeta {
  index: number;
  name?: string;
  /** End-of-track tick for this track (its length). */
  endTick: number;
}

/** Output of SmfParser — format-specific, not yet mapped onto Hyphon tracks. */
export interface ParsedSmf {
  /** SMF format: 0 (single track), 1 (multi-track synchronous), 2 (multi-track independent — unsupported). */
  format: 0 | 1 | 2;
  /** Ticks per quarter note (division field, when not SMPTE-based). */
  ppq: number;
  trackCount: number;
  tracks: SmfTrackMeta[];
  /** All resolved notes across all tracks, tagged with their source track/channel. */
  notes: SmfNoteEvent[];
  controlChanges: SmfControlChangeEvent[];
  programChanges: SmfProgramChangeEvent[];
  /** Tempo map (Set Tempo meta events), sorted by tick; always has at least one entry (default 120bpm @ tick 0). */
  tempoMap: SmfTempoEvent[];
  /** Time signature meta events, sorted by tick; always has at least one entry (default 4/4 @ tick 0). */
  timeSignatures: SmfTimeSignatureEvent[];
  /** Highest tick seen across all tracks (end of song). */
  totalTicks: number;
  /** Non-fatal parse warnings (unknown meta events skipped, sysex ignored, etc.). */
  warnings: string[];
}

// ============================================================================
// CHANNEL MAPPING / IMPORT
// ============================================================================

/** Default channel → Hyphon track routing. Channels are 0-based (channel 1 == index 0). */
export interface SmfChannelMapEntry {
  channel: number;
  target: TrackKey | 'extra';
}

export interface SmfImportOptions {
  /** Explicit channel (0-based) → TrackKey routing; channels not listed use DEFAULT_SMF_CHANNEL_MAP / extra-slot fallback. */
  channelMap: Record<number, TrackKey | 'extra'>;
  /** Quantize note start ticks to the nearest 16th-note step (recommended; off preserves raw microtiming only). */
  quantize: boolean;
  /** Import CC74 (filter cutoff) as automation on synth targets. */
  importCC74Automation: boolean;
}

export const DEFAULT_SMF_IMPORT_OPTIONS: SmfImportOptions = {
  channelMap: {},
  quantize: true,
  importCC74Automation: true,
};

/** GM percussion note → Hyphon drum track (channel 10 / index 9 only). */
export const GM_DRUM_NOTE_MAP: Record<number, Exclude<TrackKey, 'sampler' | 'partA' | 'partB' | 'bass2'>> = {
  36: 'kick',
  38: 'snare',
  42: 'closedHat',
  46: 'openHat',
};

/** Default melodic-channel routing (0-based channel index). Channel 9 (=MIDI ch.10) is drums, handled separately. */
export const DEFAULT_SMF_CHANNEL_MAP: Record<number, TrackKey | 'extra'> = {
  0: 'partA',
  1: 'partB',
  2: 'bass2',
};

// ============================================================================
// IMPORT REPORT / RESULT
// ============================================================================

export interface SmfImportReport {
  notesImported: number;
  notesUnmapped: number;
  patternsCreated: number;
  tracksInFile: number;
  channelsUsed: number[];
  tempoChangesAfterBar1: number;
  timeSignatureMismatch: boolean;
  drumGmMisses: number;
  automationLanesConverted: number;
  warnings: string[];
  formatVersion: 0 | 1 | 2;
  ppq: number;
  bpm: number;
}

/**
 * Hyphon-internal representation of an imported SMF song — deliberately
 * shaped like `HyphonSong` from the RBS importer (pattern/params/automation/
 * songArrangement) so `useSongStorage.handleSmfImport` can reuse the same
 * `loadCloudData('song', …)` path, without importing anything from
 * `src/importers/rbs/**`.
 */
export interface HyphonSmfSong {
  version: number;
  metadata: {
    name: string;
    importedFrom: 'smf';
    importedAt: Date;
  };
  tempo: number;
  timeSignature: [number, number];
  /** Primary pattern (first 32-step slot) — always populated so a non-song-mode load works. */
  pattern: Pattern;
  /** Automation lanes converted from CC74 (filter cutoff), in HyphonAutomationLane-compatible shape. */
  automation?: SmfAutomationLane[];
  /** Multi-pattern arrangement, populated whenever the file's notes span more than one 32-step pattern. */
  songArrangement?: {
    trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
    songStructure: Array<Record<TrackKey, number | null>>;
  };
}

/** Automation lane shape compatible with `HyphonAutomationLane` (src/importers/rbs/types.ts) without importing it. */
export interface SmfAutomationLane {
  target: 'synthA' | 'synthB' | 'bass2';
  parameter: string;
  name: string;
  points: [number, number][];
  interpolation: 'step' | 'linear' | 'smooth';
  originalRange: [number, number];
}

export interface SmfImportResult {
  success: true;
  song: HyphonSmfSong;
  report: SmfImportReport;
}
