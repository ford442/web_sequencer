import type { Pattern, TrackKey } from './pattern';
import type { SynthParams, Bass2Params } from './synth';
import type { KickParams, SnareParams, HatParams } from './drums';
import type { SamplerParams } from './sampler';
import type { UnifiedAutomationLane, ResolvedTrakEvent } from './automation';

export interface SongStep {
  patternIndex: number;
}

export interface SongStructure {
  length: number;
  steps: SongStep[];
  currentSongStep: number;
}

/**
 * One region on the linear arrangement timeline. Clips reference a pattern
 * slot in `trackStorage` — they never copy notes (same rule as session clips).
 */
export interface ArrangementClip {
  /** Stable within the song (`clip-N`). */
  id: string;
  track: TrackKey;
  /** `trackStorage[track][patternSlot]`. */
  patternSlot: number;
  /** Song-timeline position of the left edge, in 16th steps. */
  startStep: number;
  /** Steps the clip occupies; may be shorter (trim) or longer (loop) than the pattern. */
  lengthSteps: number;
  /** Repeat the pattern to fill `lengthSteps`; false = play it once, then rest. */
  loop: boolean;
  /**
   * Pattern step heard at the left edge. A head trim moves `startStep` and
   * bumps this, so the notes stay where they were. Absent = 0.
   */
  offsetSteps?: number;
}

/**
 * The linear arrangement (#1342): the song's record, played by the one
 * worklet clock. Song Mode's `songStructure` is a projection of this.
 */
export interface Arrangement {
  clips: ArrangementClip[];
  /** Loop point of the song in 16th steps (at least the last clip's end). */
  lengthSteps: number;
}

export interface SavedSongData {
  /**
   * Schema version: 1 = 8 pattern slots, 2 = 32 slots, 3 = 32 slots + session,
   * 4 = song meter (`stepCount`, `timeSignature`, `trackLengths`, `swing` are
   * written and honoured). v1–v3 load as 32 steps, 4/4, straight.
   * 5 = `arrangement` (timeline clips); v1–v4 derive it from `songStructure`.
   */
  version?: number;
  pattern: Pattern;
  params: {
    synthA: SynthParams;
    synthB: SynthParams;
    bass2?: Bass2Params;
    kick: KickParams;
    snare: SnareParams;
    closedHat: HatParams;
    openHat: HatParams;
    sampler: SamplerParams;
  };
  trackStorage: Record<string, unknown>;
  activeTrackSlots: Record<string, number>;
  /** Song Mode measures. From v5 a projection of `arrangement`, kept for old readers. */
  songStructure: unknown[];
  /** Linear arrangement (v5+). Absent = derived from `songStructure` on load. */
  arrangement?: Arrangement;
  tempo: number;
  /**
   * Time signature as `[numerator, denominator]` (e.g. `[4, 4]`, `[3, 4]`).
   * Optional: songs saved before this field existed load unchanged and are
   * treated as `[4, 4]`.
   */
  timeSignature?: [number, number];
  /**
   * Shuffle amount, 0–100 where 50 = straight (MPC-style percent of the step
   * pair given to the on-beat; 66.7 = triplet, 75 = hardest the clock plays).
   * Shared unit with the AI song format; `.rbs` shuffle is converted on import.
   * Optional: absent means straight. Drives the transport clock on load.
   */
  swing?: number;
  /**
   * Master pattern length in 16th-note steps (1–64). Song-wide: every pattern
   * and Song Mode measure has this length. Absent = 32.
   */
  stepCount?: number;
  /** Per-track loop lengths (polyrhythm). Absent key = follow `stepCount`. */
  trackLengths?: Partial<Record<TrackKey, number>>;
  ambianceUrl?: string;
  backgroundImage?: string;
  embeddedSamples?: { [bankIndex: number]: string };
  ttsPhrases?: string[];
  /** Persisted automation lanes (from .rbs import, recordings, or AI) */
  automationLanes?: UnifiedAutomationLane[];
  /**
   * Per-track note FX chains (#1345): arp / ratchet / chord / euclid /
   * humanize. Absent = no chains; validated on load (`normalizeSongNoteFx`).
   */
  noteFx?: import('../sequencer/noteFx/types').SongNoteFx;
  /** GLOB loop start bar from an imported .rbs (0-based). */
  rbsLoopStart?: number;
  /** GLOB loop end bar from an imported .rbs (0-based). */
  rbsLoopEnd?: number;
  /** PCF filter snapshot from an imported .rbs (re-export + PcfEffect). */
  pcfFilter?: {
    enabled: boolean;
    filterType: 'lp' | 'bp' | 'hp';
    cutoff: number;
    resonance: number;
    envAmount: number;
    decay: number;
    pattern: number[];
    target: { tb303A: boolean; tb303B: boolean; drums: boolean };
  };
  /** Per-slot TB-303 knobs from DEVL banks (song-mode pattern recall). */
  trackParamStorage?: {
    synthA: (Partial<SynthParams> | null)[];
    synthB: (Partial<SynthParams> | null)[];
    bass2: (Partial<Bass2Params> | null)[];
  };
  /** Preserved TRAK events for .rbs re-export. */
  rbsTrakEvents?: ResolvedTrakEvent[];
  /** Per-song MIDI CC / note → control mappings */
  midiMappings?: import('./midi').MidiBinding[];
  /** WAM2 plugin slots (identity, version, param/plugin state). */
  wam2?: import('../audio/wam').Wam2SongPayload;
  /** Session / clip launcher document (v3+). Absent on v1/v2 songs — migrated on load. */
  session?: import('../session/types').SessionDocument;
  /**
   * Patch bay routing. Holds only the preset id when the routing is stock, so
   * songs that never touched the patch bay do not grow.
   */
  audioGraph?: import('../audio/graph').SerializedAudioGraph;
}
