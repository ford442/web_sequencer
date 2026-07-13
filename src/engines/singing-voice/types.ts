import type { WorkletSetupMixin } from "./workletSetup";
import type { PitchControlMixin } from "./pitchControl";
import type { FormantControlMixin } from "./formantControl";
import type { EffectsControlMixin } from "./effectsControl";
import type { PlaybackMixin } from "./playback";
import type { AlignmentResult } from "../rubberband/PhonemeAligner";
import type { PhonemeAligner } from "../rubberband/PhonemeAligner";
import type { SingingVoiceConfig } from "./constants";

/** Mixin-composed public API surface for SingingVoice. */
export type SingingVoiceMixinApi = typeof WorkletSetupMixin &
  typeof PitchControlMixin &
  typeof FormantControlMixin &
  typeof EffectsControlMixin &
  typeof PlaybackMixin;

/** Methods defined directly on the SingingVoice class body. */
export interface SingingVoiceCoreMethods {
  getConfig(): SingingVoiceConfig;
  setConfig(updates: Partial<SingingVoiceConfig>): void;
  readonly outputRingBuffer: null;
  getLatency(): number;
  getLatencySeconds(): number;
  getPhonemeAligner(): PhonemeAligner | null;
}

export interface SingingVoicePublic
  extends SingingVoiceMixinApi,
    SingingVoiceCoreMethods {}
