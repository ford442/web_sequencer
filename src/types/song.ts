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

/** Fields every arrangement clip has, pattern or audio. */
interface ClipBase {
  /** Stable within the song (`clip-N`). */
  id: string;
  /** Song-timeline position of the left edge, in 16th steps. */
  startStep: number;
  /** Steps the clip occupies; may be shorter (trim) or longer (loop) than its source. */
  lengthSteps: number;
  /**
   * Steps of the source skipped at the left edge. A head trim moves
   * `startStep` and bumps this, so the content stays where it was. Absent = 0.
   */
  offsetSteps?: number;
}

/**
 * One region on the linear arrangement timeline that references a pattern
 * slot in `trackStorage` — it never copies notes (same rule as session clips).
 */
export interface PatternClip extends ClipBase {
  /** Absent on every clip saved before v6; absent = 'pattern'. */
  kind?: 'pattern';
  track: TrackKey;
  /** `trackStorage[track][patternSlot]`. */
  patternSlot: number;
  /** Repeat the pattern to fill `lengthSteps`; false = play it once, then rest. */
  loop: boolean;
  /**
   * Clip-local automation (#1494). Same lane shape as the song lanes, but a
   * point's `step` is the clip-local position: 0 is the clip's left edge and
   * `lengthSteps` its right edge. Where the clip sounds, a clip lane wins
   * over a song lane on the same `target:parameter`. Absent = none.
   */
  lanes?: UnifiedAutomationLane[];
}

/** An audio track of the song: `audio-1` … `audio-N` (see `AUDIO_TRACK_KEYS`). */
export type AudioTrackKey = `audio-${number}`;

/** How an audio clip follows the song tempo. P1 plays `off` only. */
export type AudioClipWarp = 'off' | 'repitch' | 'stretch';

/**
 * One region of recorded or imported audio on an audio track (#1629, v6).
 *
 * The source is media in the content-addressed media store (`mediaId` is the
 * SHA-256 of the stored file). With `warp: 'off'` it plays at its own rate:
 * the clip is anchored `offsetSteps` before its left edge, where source frame
 * `offsetFrames` sounds, and the source then runs in real time. A head trim
 * or a split moves `offsetSteps` only, so the two halves of a split stay
 * aligned at any tempo.
 */
export interface AudioClip extends ClipBase {
  kind: 'audio';
  track: AudioTrackKey;
  /** SHA-256 (hex) of the media file; `SavedSongData.media` describes it. */
  mediaId: string;
  /** Source frame at the anchor (slip, sample-accurate). */
  offsetFrames: number;
  /** Clip gain in dB. */
  gainDb: number;
  /** Linear fade at the left edge, in source frames. Absent = 0. */
  fadeInFrames?: number;
  /** Linear fade at the right edge, in source frames. Absent = 0. */
  fadeOutFrames?: number;
  warp: AudioClipWarp;
  /** Tempo the source was played at (a `stretch` / `repitch` clip needs it). */
  sourceBpm?: number;
}

/** A clip on the arrangement timeline, discriminated on `kind`. */
export type ArrangementClip = PatternClip | AudioClip;

/** An audio track's mixer strip (v6). Mute / solo stay runtime-only, like the pattern tracks'. */
export interface AudioTrack {
  id: AudioTrackKey;
  name: string;
  /** Fader, in dB (0 = unity). */
  gainDb: number;
  /** -1 (left) … 1 (right). */
  pan: number;
}

/** What the song knows about one piece of media, so it can name and size it without the file. */
export interface MediaRef {
  /** Name of the file it was imported from (display only). */
  name: string;
  sampleRate: number;
  channels: number;
  /** Length in frames. */
  frames: number;
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
   * 6 = audio clips on the arrangement, `audioTracks` and `media`; a v5 song
   *     is a valid v6 song with no audio tracks (the migration is the identity).
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
  /** Audio tracks (v6), in lane order. Absent = none. */
  audioTracks?: AudioTrack[];
  /**
   * Media the audio clips reference (v6), by media id. The audio itself is in
   * the media store (`media/<id>.f32`), never in the song. Absent = none.
   */
  media?: Record<string, MediaRef>;
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
