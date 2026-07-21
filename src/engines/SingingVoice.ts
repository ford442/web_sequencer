import {
  PhonemeAligner,
  type AlignmentResult,
} from "./rubberband/PhonemeAligner";
import {
  FormantShifter,
} from "./rubberband/FormantShifter";
import type { PhonemeBufferPool } from "../services/PhonemeBufferPool";
import {
  type PitchCache,
  type SingingVoiceConfig,
  REFERENCE_FREQUENCIES,
  PITCH_RATIO_LIMITS,
  STRETCH_RATIO_LIMITS,
  clampStretchRatio,
} from "./singing-voice/constants";
import { midiToFreq, freqToMidi } from "./singing-voice/pitchUtils";
import type { SingingVoiceHost } from "./singing-voice/host";
import type { SingingVoicePublic } from "./singing-voice/types";
import { WorkletSetupMixin } from "./singing-voice/workletSetup";
import { PitchControlMixin } from "./singing-voice/pitchControl";
import { FormantControlMixin } from "./singing-voice/formantControl";
import { EffectsControlMixin } from "./singing-voice/effectsControl";
import { PlaybackMixin } from "./singing-voice/playback";

// Re-export public constants, types, and utilities
export type { PitchCache, SingingVoiceConfig };
export {
  REFERENCE_FREQUENCIES,
  PITCH_RATIO_LIMITS,
  STRETCH_RATIO_LIMITS,
  clampStretchRatio,
};
export { midiToFreq, freqToMidi };

/**
 * SingingVoice - High-fidelity vocal synthesis engine
 *
 * Part of the RUBBERBAND_ENHANCEMENT_PLAN implementation.
 * Integrates Supertonic TTS with Rubber Band for singing synthesis.
 *
 * Key features:
 * - Multi-resolution pitch caching (Section 2): Pre-render at multiple base pitches
 * - Formant preservation: Avoids "chipmunk effect"
 * - Latency compensation for MIDI sync (Section 9)
 * - Phoneme-aware time stretching (Section 3): Selective vowel/consonant stretching
 * - Formant shifting (Section 4): Independent vocal character control
 */

// Mixin methods are applied via Object.assign below; this interface exposes them on the class type.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface SingingVoice extends SingingVoicePublic {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class SingingVoice implements SingingVoicePublic {
  audioContext: AudioContext;
  workletNode: AudioWorkletNode | null = null;
  config: SingingVoiceConfig;

  /** Latency of the Rubber Band processor in samples */
  processorLatency: number = 0;

  /** Cache for pre-rendered TTS at different base pitches (Section 2) */
  pitchCache: PitchCache = {
    low: null,
    mid: null,
    high: null,
  };

  /** Voice pitch parameters for sampler playback */
  rootNote: number = 60; // Base MIDI note (C4 default)
  coarseTune: number = 0; // Coarse tuning in semitones (-24 to +24)
  fineTune: number = 0; // Fine tuning in cents (-50 to +50)
  pitchAttack: number = 0; // Pitch envelope attack time (0-1)
  pitchDecay: number = 0; // Pitch envelope decay time (0-1)
  pitchAmount: number = 0; // Pitch envelope amount (-24 to 24)

  /** Envelope Baseline Tracker for Phoneme-Aware Velocity */
  currentAttack: number = 0.05;
  currentDecay: number = 0.1;

  /** Phoneme aligner for Section 3 implementation */
  phonemeAligner: PhonemeAligner | null = null;

  /** Formant shifter for Section 4 implementation */
  formantShifter: FormantShifter | null = null;

  /** Last alignment result for current audio */
  lastAlignment: AlignmentResult | null = null;

  /** Pre-stretched buffer pool for phoneme-aware time stretching */
  bufferPool: PhonemeBufferPool | null = null;

  /**
   * Tracks the AudioNode destinations that the worklet is currently wired to.
   * Used so AudioBufferSourceNode (pool playback path) can be connected to the
   * same output chain without re-routing through the Rubber Band worklet.
   */
  outputDestinations: Set<AudioNode> = new Set();

  constructor(audioContext: AudioContext, config: SingingVoiceConfig = {}) {
    this.audioContext = audioContext;
    this.config = {
      useHighQuality: config.useHighQuality ?? false,
      preserveFormants: config.preserveFormants ?? true,
      channels: config.channels ?? 1,
      bufferSize: config.bufferSize ?? 16384,
      enablePhonemeStretching: config.enablePhonemeStretching ?? false,
      enableFormantShifting: config.enableFormantShifting ?? false,
      voiceCharacter: config.voiceCharacter ?? "default",
      phonemeAlignerUrl: config.phonemeAlignerUrl,
    };

    // Initialize phoneme aligner if enabled
    if (this.config.enablePhonemeStretching) {
      this.phonemeAligner = new PhonemeAligner({
        alignerServiceUrl: this.config.phonemeAlignerUrl,
        useLocalAlignment: !this.config.phonemeAlignerUrl,
      });
    }

    // Initialize formant shifter if enabled
    if (this.config.enableFormantShifting) {
      this.formantShifter = new FormantShifter({
        audioContext: this.audioContext,
      });
    }
  }

  /**
   * Get the current configuration.
   * Useful for checking quality settings and other parameters.
   */
  getConfig(): SingingVoiceConfig {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime.
   * Note: Some settings may require re-initialization to take effect.
   */
  setConfig(updates: Partial<SingingVoiceConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get the output ring buffer instance.
   * Useful for visualizing output or analyzing processed audio on the main thread.
   * @deprecated RingBuffer access removed - use standard AudioWorklet output instead
   */
  get outputRingBuffer(): null {
    return null;
  }

  /**
   * Get the current processor latency in samples.
   * @returns Latency in samples
   */
  getLatency(): number {
    return this.processorLatency;
  }

  /**
   * Get latency in seconds.
   * Useful for MIDI synchronization (Section 9).
   */
  getLatencySeconds(): number {
    return this.processorLatency / this.audioContext.sampleRate;
  }

  /**
   * Get the phoneme aligner for advanced control.
   * Returns null if phoneme stretching is not enabled.
   */
  getPhonemeAligner(): PhonemeAligner | null {
    return this.phonemeAligner;
  }
}

Object.assign(
  SingingVoice.prototype,
  WorkletSetupMixin,
  PitchControlMixin,
  FormantControlMixin,
  EffectsControlMixin,
  PlaybackMixin,
);
