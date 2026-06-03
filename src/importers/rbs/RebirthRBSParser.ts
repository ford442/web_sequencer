/**
 * RebirthRBSParser
 *
 * Version-aware parser for Rebirth RB-338 .rbs song files (v1.5, 2.0, 2.0.1).
 * Follows the technical spec provided for this task.
 *
 * Designed to be the canonical entry point for .rbs import.
 * Uses DataView exclusively for all binary reads (little-endian per spec).
 *
 * Architecture:
 * - Delegates to the existing robust RbsParser for binary extraction.
 * - Exposes the spec-recommended clean API: parseHeader(), parsePatterns(),
 *   parseSynthParameters(synthIndex), parseSongArrangement(), parseAutomation().
 * - Each method returns a fully typed result; no raw `any` in the public API.
 *
 * Notes on real-world format:
 * - The provided spec gives a simplified linear view.
 * - Actual files are often IFF CAT "RB40" containers (see RBS42.txt research).
 * - This class is resilient: RbsParser already handles IFF detection and falls
 *   back to fixed-offset extraction for compatibility.
 */

import type {
  RawRbsData,
  Tb303PatternA,
  Tb303PatternB,
  AutomationLane,
  RbsTrakEvent,
  RbsSongData,
  Tb303Step,
} from './types';
import { TRAK_TRACK_INDEX, TICKS_PER_BAR } from './types';
import { RbsParser } from './RbsParser';
import type { RbsParserError } from './RbsParser';

// ============================================================================
// Public return-type interfaces for each spec method
// ============================================================================

/** Structured header as returned by parseHeader() */
export interface RbsHeaderData {
  /** File magic – "RB338" for authentic files */
  magic: string;
  /** Full version string (e.g. "2.0", "1.5", "2.0.1") */
  version: string;
  /** Major version component */
  versionMajor: number;
  /** Minor version component */
  versionMinor: number;
  /**
   * Patch version component (e.g. 1 for "2.0.1", 0 when absent).
   * Versions like "2.0.1" carry meaningful patch information in ReBirth.
   */
  versionPatch: number;
  /** Tempo in BPM (40-250) */
  bpm: number;
  /** Swing amount (0-100, 50 = no swing) */
  swing: number;
  /** Song / pattern name, null-terminated ASCII from header */
  songName: string;
  /** Number of steps per pattern (typically 16) */
  patternLength: number;
  /** Time-signature numerator */
  timeSignatureNum: number;
  /** Time-signature denominator */
  timeSignatureDen: number;
}

/** Single pattern entry returned by parsePatterns() */
export interface RbsPatternData {
  /** 0-based pattern index within the device */
  patternIndex: number;
  /** Which device this pattern belongs to */
  device: 'tb303A' | 'tb303B' | 'drums';
  /** Step data (Tb303Step array for 303 devices, boolean array for drums) */
  steps: Tb303Step[] | boolean[];
  /** Number of active steps (16 or 32) */
  length: number;
}

/** TB-303 synthesizer parameters returned by parseSynthParameters() */
export interface RbsSynthParameters {
  /** Synth index: 1 = TB-303 A, 2 = TB-303 B */
  synthIndex: 1 | 2;
  /** Cutoff frequency (0-127) */
  cutoff: number;
  /** Resonance amount (0-127) */
  resonance: number;
  /** Envelope modulation amount (0-127) */
  envMod: number;
  /** Decay time (0-127) */
  decay: number;
  /** Accent intensity (0-127) */
  accent: number;
  /** Waveform: 0 = sawtooth, 1 = square */
  waveform: 0 | 1;
  /** Distortion amount (0-127), if present in file */
  distortion?: number;
  /** Delay send (0-127), if present in file */
  delaySend?: number;
  /** Transpose in semitones (-12 to +12); only populated for synthIndex 2 */
  transpose?: number;
}

/** Song arrangement data returned by parseSongArrangement() */
export interface RbsSongArrangement {
  /** Play mode detected from file ("pattern" single-pattern loop, "song" multi-pattern) */
  mode: 'pattern' | 'song';
  /** Ordered list of pattern slots in the arrangement (may be empty for pattern mode) */
  patternSlots: Array<{ patternIndex: number; repeats: number }>;
  /** Loop start pattern slot index (undefined when not set) */
  loopStart?: number;
  /** Loop end pattern slot index (undefined when not set) */
  loopEnd?: number;
}

/** Automation lane data returned by parseAutomation() */
export interface RbsAutomationData {
  /** Parameter identifier string (e.g. "tb303Acutoff") */
  parameter: string;
  /** Human-readable display name */
  name: string;
  /** Automation points: [stepIndex, value] */
  points: [number, number][];
  /** Value interpolation type */
  interpolation: 'step' | 'linear' | 'smooth';
  /** Expected value range [min, max] */
  range: [number, number];
}

/** Top-level result from parseFile() */
export interface RebirthParseResult {
  success: boolean;
  /** Full raw RBS data tree (populated on success) */
  data?: RawRbsData;
  /** Error message (populated on failure) */
  error?: string;
  /** Version string detected from the file */
  versionDetected?: string;
  /** Structured header (populated on success) */
  header?: RbsHeaderData;
  /** Synth A parameters (populated on success) */
  synthA?: RbsSynthParameters;
  /** Synth B parameters (populated on success) */
  synthB?: RbsSynthParameters;
  /** All patterns for all devices (populated on success) */
  patterns?: RbsPatternData[];
  /** Song arrangement info (populated on success) */
  arrangement?: RbsSongArrangement;
  /** Automation lanes (populated on success) */
  automationLanes?: RbsAutomationData[];
}

// ============================================================================
// Module-level helpers
// ============================================================================

/**
 * Convert a typed RbsParserError into a human-readable string.
 * Each variant of the discriminated union carries different fields.
 */
function extractErrorMessage(err: RbsParserError): string {
  switch (err.type) {
    case 'INVALID_FORMAT':
    case 'READ_ERROR':
      return err.message;
    case 'UNSUPPORTED_VERSION':
      return `Unsupported version "${err.version}" (supported: ${err.supported.join(', ')})`;
    case 'CORRUPTED_DATA':
      return `Corrupted data in section "${err.section}"${err.details ? `: ${err.details}` : ''}`;
    default:
      // Exhaustiveness guard – should never be reached with current error types
      return JSON.stringify(err);
  }
}

// ============================================================================
// RebirthRBSParser class
// ============================================================================

export class RebirthRBSParser {
  /** Underlying engine – carries out the real binary extraction */
  private engine: RbsParser;

  /** Cached raw data from the last successful parseFile() call */
  private rawData: RawRbsData | null = null;

  constructor() {
    this.engine = new RbsParser();
  }

  /**
   * Main entry-point.  Reads the file, runs the full parse pipeline, and
   * returns a rich result object including all sub-section data.
   */
  async parseFile(file: File): Promise<RebirthParseResult> {
    if (!file.name.toLowerCase().endsWith('.rbs')) {
      return { success: false, error: 'File must have .rbs extension' };
    }

    // Delegate binary extraction to the existing robust parser
    const engineResult = await this.engine.parseRbsFile(file);
    if (!engineResult.success) {
      return { success: false, error: extractErrorMessage(engineResult.error) };
    }

    this.rawData = engineResult.data;
    const raw = this.rawData;

    // Build the full result using the spec-recommended method calls
    const header = this.parseHeader();
    const synthA = this.parseSynthParameters(1);
    const synthB = this.parseSynthParameters(2);
    const patterns = this.parsePatterns();
    const arrangement = this.parseSongArrangement();
    const automationLanes = this.parseAutomation();

    console.log(
      `[RebirthRBSParser] Parsed "${file.name}" – version ${header.version}, ` +
      `${patterns.length} pattern entries, ${automationLanes.length} automation lane(s).`
    );

    return {
      success: true,
      versionDetected: header.version,
      data: raw,
      header,
      synthA,
      synthB,
      patterns,
      arrangement,
      automationLanes,
    };
  }

  // ============================================================================
  // Spec-recommended public methods
  // ============================================================================

  /**
   * Return structured header information.
   * Reads from the cached rawData populated by parseFile(); call parseFile() first.
   */
  parseHeader(): RbsHeaderData {
    const raw = this.requireRawData('parseHeader');
    const rh = raw.rawHeader;

    // Use rawHeader when available (populated by RbsParser); fall back to project fields.
    const magic = rh?.magic ?? 'RB338';
    const version = rh?.version ?? raw.version;

    // Parse all three version components to avoid losing the patch part (e.g. "2.0.1" → 2, 0, 1).
    const versionParts = version.split('.');
    const versionMajor = parseInt(versionParts[0] ?? '2', 10);
    const versionMinor = parseInt(versionParts[1] ?? '0', 10);
    const versionPatch = parseInt(versionParts[2] ?? '0', 10);

    return {
      magic,
      version,
      versionMajor,
      versionMinor,
      versionPatch,
      bpm: rh?.tempo ?? raw.project.tempo,
      swing: rh?.swing ?? raw.project.swing,
      songName: rh?.songName ?? raw.project.name,
      patternLength: rh?.patternLength ?? raw.project.patternLength,
      timeSignatureNum: rh?.timeSignatureNum ?? raw.project.timeSignatureNum,
      timeSignatureDen: rh?.timeSignatureDen ?? raw.project.timeSignatureDen,
    };
  }

  /**
   * Return all pattern data blocks for all devices.
   * When songData is present (full IFF file), returns patterns from all banks.
   * Otherwise returns the single pattern from legacy extraction.
   */
  parsePatterns(): RbsPatternData[] {
    const raw = this.requireRawData('parsePatterns');
    const results: RbsPatternData[] = [];

    if (raw.songData) {
      // Multi-pattern: return all patterns from banks
      const { patternBanks } = raw.songData;
      
      for (let i = 0; i < patternBanks.tb303A.length; i++) {
        results.push({
          patternIndex: i,
          device: 'tb303A',
          steps: patternBanks.tb303A[i].steps,
          length: patternBanks.tb303A[i].steps.length,
        });
      }

      for (let i = 0; i < patternBanks.tb303B.length; i++) {
        results.push({
          patternIndex: i,
          device: 'tb303B',
          steps: patternBanks.tb303B[i].steps,
          length: patternBanks.tb303B[i].steps.length,
        });
      }

      const drumBank = patternBanks.drums808.length > 0 ? patternBanks.drums808 : patternBanks.drums909;
      for (let i = 0; i < drumBank.length; i++) {
        results.push({
          patternIndex: i,
          device: 'drums',
          steps: drumBank[i].kick,
          length: drumBank[i].kick.length,
        });
      }

      return results;
    }

    // Legacy single-pattern mode
    // TB-303 A
    results.push({
      patternIndex: 0,
      device: 'tb303A',
      steps: raw.tb303PatternA.steps,
      length: raw.tb303PatternA.steps.length,
    });

    // TB-303 B
    results.push({
      patternIndex: 0,
      device: 'tb303B',
      steps: raw.tb303PatternB.steps,
      length: raw.tb303PatternB.steps.length,
    });

    // Drums (kick as representative)
    results.push({
      patternIndex: 0,
      device: 'drums',
      steps: raw.drums.kick,
      length: raw.drums.kick.length,
    });

    return results;
  }

  /**
   * Return synthesizer parameters for a given synth index.
   *
   * @param synthIndex 1 for TB-303 A (lead/bass), 2 for TB-303 B (counter-melody)
   */
  parseSynthParameters(synthIndex: 1 | 2): RbsSynthParameters {
    const raw = this.requireRawData('parseSynthParameters');

    if (synthIndex === 1) {
      const a: Tb303PatternA = raw.tb303PatternA;
      return {
        synthIndex: 1,
        cutoff: a.cutoff,
        resonance: a.resonance,
        envMod: a.envMod,
        decay: a.decay,
        accent: a.accent,
        waveform: a.waveform,
        distortion: a.distortion,
        delaySend: a.delaySend,
      };
    }

    const b: Tb303PatternB = raw.tb303PatternB;
    return {
      synthIndex: 2,
      cutoff: b.cutoff,
      resonance: b.resonance,
      envMod: b.envMod,
      decay: b.decay,
      accent: b.accent,
      waveform: b.waveform,
      distortion: b.distortion,
      delaySend: b.delaySend,
      transpose: b.transpose,
    };
  }

  /**
   * Return song arrangement information.
   *
   * When the file contains full IFF CAT RB40 GLOB + TRKL data (songData present),
   * this returns the actual arrangement with pattern slots derived from TRAK events.
   * Otherwise returns a safe pattern-mode placeholder for single-pattern files.
   */
  parseSongArrangement(): RbsSongArrangement {
    const raw = this.requireRawData('parseSongArrangement');

    // If songData is present, extract real arrangement from GLOB + TRAK events
    if (raw.songData) {
      const { glob, tracks } = raw.songData;
      const mode: 'pattern' | 'song' = glob.playMode === 1 ? 'song' : 'pattern';

      // Extract pattern slots from TRAK events (controller 0 = pattern select)
      const patternSlots: Array<{ patternIndex: number; repeats: number }> = [];
      
      // Look at TB-303 #1 track for pattern changes (representative track)
      const mainTrack = tracks.find(t => t.trackIndex === TRAK_TRACK_INDEX.TB303_1) || tracks[0];
      if (mainTrack) {
        let lastPattern = 0;
        let lastTick = 0;
        
        for (const evt of mainTrack.events) {
          if (evt.controllerId === 0) { // pattern select
            // If there's a gap, the previous pattern was playing for that duration
            if (patternSlots.length > 0 || evt.absoluteTicks > 0) {
              const durationTicks = evt.absoluteTicks - lastTick;
              const repeats = Math.max(1, Math.round(durationTicks / TICKS_PER_BAR));
              if (patternSlots.length === 0 && evt.absoluteTicks > 0) {
                // There was an initial pattern playing before first change
                patternSlots.push({ patternIndex: lastPattern, repeats });
              } else if (patternSlots.length > 0) {
                patternSlots[patternSlots.length - 1].repeats = repeats;
              }
            }
            lastPattern = evt.value;
            lastTick = evt.absoluteTicks;
            patternSlots.push({ patternIndex: evt.value, repeats: 1 });
          }
        }

        // If no pattern select events found, use pattern 0
        if (patternSlots.length === 0) {
          patternSlots.push({ patternIndex: 0, repeats: 1 });
        }
      } else {
        patternSlots.push({ patternIndex: 0, repeats: 1 });
      }

      return {
        mode,
        patternSlots,
        loopStart: glob.loopStart || undefined,
        loopEnd: glob.loopEnd || undefined,
      };
    }

    // Placeholder: single-pattern arrangement (pattern 0, plays once).
    return {
      mode: 'pattern',
      patternSlots: [{ patternIndex: 0, repeats: 1 }],
    };
  }

  /**
   * Return automation lane data extracted from the file.
   * Maps directly to the AutomationLane entries produced by RbsParser.
   */
  parseAutomation(): RbsAutomationData[] {
    const raw = this.requireRawData('parseAutomation');

    return raw.automation.map((lane: AutomationLane): RbsAutomationData => ({
      parameter: lane.parameter,
      name: lane.name,
      points: lane.points,
      interpolation: lane.interpolation,
      range: lane.range,
    }));
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Assert that rawData is populated (i.e. parseFile() succeeded) and return it.
   * Throws a descriptive error if called before a successful parseFile().
   */
  private requireRawData(callerName: string): RawRbsData {
    if (!this.rawData) {
      throw new Error(
        `[RebirthRBSParser] ${callerName}() called before a successful parseFile(). ` +
        'Call parseFile(file) first and check result.success.'
      );
    }
    return this.rawData;
  }
}

// ============================================================================
// Convenience export
// ============================================================================

export async function parseRebirthRBSFile(file: File): Promise<RebirthParseResult> {
  const parser = new RebirthRBSParser();
  return parser.parseFile(file);
}
