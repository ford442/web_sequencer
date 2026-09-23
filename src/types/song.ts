import type { Pattern } from './pattern';
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

export interface SavedSongData {
  /** Schema version: 1 = 8 pattern slots, 2 = 32 slots, 3 = 32 slots + session. */
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
  songStructure: unknown[];
  tempo: number;
  /**
   * Time signature as `[numerator, denominator]` (e.g. `[4, 4]`, `[3, 4]`).
   * Optional: songs saved before this field existed load unchanged and are
   * treated as `[4, 4]`.
   */
  timeSignature?: [number, number];
  /**
   * Shuffle amount, 0–100 where 50 = straight (the unit shared by the `.rbs`
   * header and the AI song format). Optional: absent means straight.
   *
   * Storage only for now — the transport's swing input is not yet wired to
   * song state, so loading a song does not change playback feel.
   */
  swing?: number;
  ambianceUrl?: string;
  backgroundImage?: string;
  embeddedSamples?: { [bankIndex: number]: string };
  ttsPhrases?: string[];
  /** Persisted automation lanes (from .rbs import, recordings, or AI) */
  automationLanes?: UnifiedAutomationLane[];
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
