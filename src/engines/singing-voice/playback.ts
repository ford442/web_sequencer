import type { AlignmentResult } from "../rubberband/PhonemeAligner";
import type { PhonemeBufferPool } from "../../services/PhonemeBufferPool";
import { applyMicrotonalTuning } from "../../utils/musicTheory";
import { midiToFreq } from "./pitchUtils";
import { clampStretchRatio, PITCH_RATIO_LIMITS } from "./constants";
import type { PhonemeData } from '../../types';
import type { SingingVoiceHost } from "./host";


export interface SingingVoiceTriggerOptions {
  startTime: number;
  targetMidi: number;
  baseMidi?: number;
  tuning?: import("../../utils/musicTheory").ScaleDefinition | null;
  pitchOffset?: number;
  duration?: number;
  // Legato / portamento
  legato?: boolean;
  slideFromMidi?: number;
  portamento?: number;
  slideType?: 'linear' | 'exponential';
  // Formant (pre-resolved by caller)
  formantShift?: number;
  slideFromFormant?: number;
  reverse?: boolean;
  phonemeData?: PhonemeData; // Added for isVowel check
}

export const PlaybackMixin = {
  trigger(
    this: SingingVoiceHost,
    opts: SingingVoiceTriggerOptions
  ): void {
    const { startTime, targetMidi, duration } = opts;
    const baseMidi = opts.baseMidi ?? this.rootNote;
    const tuning = opts.tuning;

    // 1. Calculate Target Pitch Ratio
    const effectiveCoarse = this.coarseTune;
    const effectiveFine = this.fineTune;
    let finalTargetMidi = applyMicrotonalTuning(targetMidi, tuning);
    const totalSemitoneOffset = effectiveCoarse + effectiveFine / 100 + (opts.pitchOffset ?? 0);
    finalTargetMidi += totalSemitoneOffset;

    const targetFreq = midiToFreq(finalTargetMidi);
    const baseFreq = midiToFreq(baseMidi);
    let targetRatio = targetFreq / baseFreq;
    targetRatio = Math.max(PITCH_RATIO_LIMITS.MIN, Math.min(PITCH_RATIO_LIMITS.MAX, targetRatio));

    // 2. Pitch Glide / Legato Logic
    const glideDur = opts.portamento !== undefined && duration !== undefined
      ? opts.portamento * duration // Or another mapping if needed, portamento is 0-1
      : opts.duration !== undefined ? Math.min(Math.max(opts.duration * 0.5, 0.15), opts.duration) : 0.15;

    // Apply Expressive Note Transitions ONLY if it's a slideFromMidi OR (it's legato AND it's a vowel/voiced phoneme)
    const vowels = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];
    const isVowel = opts.phonemeData ? vowels.includes(opts.phonemeData.symbol.toUpperCase()) : true; // Default to true if no phoneme data provided
    const shouldGlide = opts.slideFromMidi !== undefined || (this.isActive && opts.legato !== false && isVowel);

    if (shouldGlide && glideDur > 0) {
      let fromRatio: number;
      if (opts.slideFromMidi !== undefined) {
          let fromMidi = applyMicrotonalTuning(opts.slideFromMidi, tuning);
          fromMidi += totalSemitoneOffset;
          fromRatio = Math.max(PITCH_RATIO_LIMITS.MIN, Math.min(PITCH_RATIO_LIMITS.MAX, midiToFreq(fromMidi) / baseFreq));
      } else {
          fromRatio = this.currentPitch ?? targetRatio; // Fallback to target if null
      }
      this.glidePitchTo(targetRatio, startTime, glideDur, fromRatio, opts.slideType);
    } else {
      this.setPitchAtTime(targetRatio, startTime);
    }

    // 3. Formant Shift / Glide Logic
    if (opts.slideFromFormant !== undefined && opts.formantShift !== undefined) {
      (this.formantShifter as any)?.setFormantGlide?.(
        opts.slideFromFormant,
        opts.formantShift,
        startTime,
        glideDur
      );
    } else if (opts.formantShift !== undefined) {
      (this.formantShifter as any)?.setFormantShift?.(
        opts.formantShift,
        startTime,
        0
      );
    }

    // 4. Play
    this.play(undefined, undefined, 1.0, opts.reverse);

    // 5. Update State
    this.isActive = true;
    this.currentPitch = targetRatio;
  },

  /**
   * Load audio buffer into the worklet without triggering playback.
   * Useful for pre-loading or glitch effects where multiple triggers share the same buffer.
   * @param audio Float32Array of mono audio samples
   */
  loadBuffer(this: SingingVoiceHost, audio: Float32Array): void {
    if (!this.workletNode) {
      throw new Error(
        "SingingVoice not initialized. Call initWorklet() first.",
      );
    }

    this.workletNode.port.postMessage({
      type: "loadBuffer",
      data: { buffer: audio.buffer }, // Let structured clone handle it natively
    });
    this.isActive = false;
    this.currentPitch = null;
  },

  /**
   * Trigger playback of the currently loaded buffer.
   * @param startSample Optional start sample index
   * @param endSample Optional end sample index
   * @param pitch Optional pitch override (default 1.0)
   * @param reverse Optional reverse playback (default false)
   */
  play(
    this: SingingVoiceHost,
    startSample?: number,
    endSample?: number,
    pitch: number = 1.0,
    reverse: boolean = false,
  ): void {
    if (!this.workletNode) {
      throw new Error(
        "SingingVoice not initialized. Call initWorklet() first.",
      );
    }

    this.workletNode.port.postMessage({
      type: "noteOn",
      data: {
        pitch,
        startSample,
        endSample,
        reverse,
      },
    });
  },

  /**
   * Process audio through the Rubber Band worklet.
   * @param audio Float32Array of mono audio samples
   * @param startSample Optional start sample index for slicing
   * @param endSample Optional end sample index for slicing
   * @returns Promise that resolves when processing is complete
   */
  async process(
    this: SingingVoiceHost,
    audio: Float32Array,
    startSample?: number,
    endSample?: number,
    reverse: boolean = false,
  ): Promise<void> {
    this.loadBuffer(audio);
    this.play(startSample, endSample, 1.0, reverse);
  },

  /**
   * Trigger a specific phoneme slice based on index.
   *
   * When `targetDuration`, `scheduledTime`, and `phonemeId` are provided **and**
   * the pre-stretched buffer pool has a matching buffer, playback goes through an
   * `AudioBufferSourceNode` scheduled with sample-accurate timing (zero onset
   * latency).  Otherwise, the existing Rubber Band worklet path is used as a
   * fall-back.
   *
   * @param audio          Full decoded audio buffer (Float32Array, mono)
   * @param sliceIndex     Index of the phoneme segment in `alignment.phonemes`
   * @param alignment      Alignment result containing phoneme timing info
   * @param pitch          Optional pitch ratio override (default 1.0)
   * @param reverse        Optional reverse playback flag (default false)
   * @param targetDuration Optional target step duration in seconds (for pool lookup)
   * @param scheduledTime  Optional Web Audio `currentTime` at which to schedule playback
   * @param phonemeId      Optional stable ID for pool lookup (e.g. "bank_0_slice_3")
   */
  async triggerSlice(
    this: SingingVoiceHost,
    audio: Float32Array,
    sliceIndex: number,
    alignment: AlignmentResult,
    pitch: number = 1.0,
    reverse: boolean = false,
    targetDuration?: number,
    scheduledTime?: number,
    phonemeId?: string,
  ): Promise<void> {
    if (sliceIndex < 0 || sliceIndex >= alignment.phonemes.length) {
      console.warn(
        `Slice index ${sliceIndex} out of bounds (max ${alignment.phonemes.length - 1})`,
      );
      return;
    }

    const phoneme = alignment.phonemes[sliceIndex];
    const startSample = Math.floor(phoneme.start * alignment.sampleRate);
    const endSample = Math.floor(phoneme.end * alignment.sampleRate);

    // ------------------------------------------------------------------
    // Pool path: sample-accurate AudioBufferSourceNode playback
    // ------------------------------------------------------------------
    if (
      this.bufferPool !== null &&
      targetDuration !== undefined &&
      targetDuration > 0 &&
      phonemeId !== undefined
    ) {
      const targetMs = Math.round(targetDuration * 1000);
      const poolBuffer = this.bufferPool.getNearest(phonemeId, targetMs);

      if (poolBuffer !== null && this.outputDestinations.size > 0) {
        const when =
          scheduledTime !== undefined
            ? scheduledTime
            : this.audioContext.currentTime;
        const source = this.audioContext.createBufferSource();
        source.buffer = poolBuffer;
        // Connect to every output destination the worklet is currently wired to
        this.outputDestinations.forEach((dest) => source.connect(dest));
        source.start(when);
        source.stop(when + targetDuration);
        return;
      }
    }

    // ------------------------------------------------------------------
    // Fall-back: existing Rubber Band worklet path
    // ------------------------------------------------------------------

    // Apply Phoneme-Aware Velocity formatting to amplitude envelope
    let scaledAttack = this.currentAttack;
    let scaledDecay = this.currentDecay;

    switch (phoneme.category) {
      case "plosive":
        scaledAttack = Math.max(0.001, this.currentAttack * 0.1); // Extremely fast attack
        scaledDecay = Math.max(0.001, this.currentDecay * 0.5); // Faster decay
        break;
      case "fricative":
        scaledAttack = Math.max(0.001, this.currentAttack * 0.5); // Fast attack
        break;
      case "liquid":
      case "nasal":
        scaledAttack = Math.min(2.0, this.currentAttack * 1.2); // Smoother attack
        break;
      case "vowel":
        scaledAttack = Math.min(2.0, this.currentAttack * 1.5); // Smooth attack
        scaledDecay = Math.min(2.0, this.currentDecay * 1.2); // Longer decay
        break;
      default:
        break;
    }

    if (this.workletNode) {
      this.workletNode.parameters
        .get("attack")
        ?.setValueAtTime(scaledAttack, this.audioContext.currentTime);
      this.workletNode.parameters
        .get("decay")
        ?.setValueAtTime(scaledDecay, this.audioContext.currentTime);
    }

    this.setPitch(pitch);

    // Apply phoneme-aware time-stretch to fill the target step duration.
    // When targetDuration is supplied, compute the ratio from the phoneme's
    // natural duration; otherwise reset to 1.0 (no stretch).
    if (targetDuration !== undefined && targetDuration > 0) {
      const nativeDuration = phoneme.end - phoneme.start;
      if (nativeDuration > 0) {
        const rawRatio = targetDuration / nativeDuration;
        this.setTimeRatio(clampStretchRatio(rawRatio));
      } else {
        this.setTimeRatio(1.0);
      }
    } else {
      this.setTimeRatio(1.0); // Reset time stretch for slice playback
    }

    await this.process(audio, startSample, endSample, reverse);

    // Reset envelopes immediately after trigger to avoid bleeding onto next normal note processing
    if (this.workletNode) {
      this.workletNode.parameters
        .get("attack")
        ?.setValueAtTime(
          this.currentAttack,
          this.audioContext.currentTime + 0.1,
        );
      this.workletNode.parameters
        .get("decay")
        ?.setValueAtTime(
          this.currentDecay,
          this.audioContext.currentTime + 0.1,
        );
    }
  },

  /**
   * Align phonemes in the given audio (Section 3).
   * Stores the result internally for later use with phoneme-aware stretching.
   *
   * @param audio Audio samples to align
   * @param text Text/lyrics to align
   * @returns Alignment result with phoneme segments
   */
  async alignPhonemes(
    this: SingingVoiceHost,
    audio: Float32Array,
    text: string,
  ): Promise<AlignmentResult | null> {
    if (!this.phonemeAligner) {
      console.warn(
        "PhonemeAligner not enabled. Set enablePhonemeStretching: true in config.",
      );
      return null;
    }

    this.lastAlignment = await this.phonemeAligner.alignPhonemes(
      audio,
      text,
      this.audioContext.sampleRate,
    );

    return this.lastAlignment;
  },

  /**
   * Set the current alignment result manually.
   * Useful for multi-bank setups where alignment is pre-calculated/cached.
   *
   * @param alignment The alignment result to use
   */
  setAlignment(
    this: SingingVoiceHost,
    alignment: AlignmentResult | null,
  ): void {
    this.lastAlignment = alignment;
  },

  /**
   * Get the last phoneme alignment result.
   */
  getLastAlignment(this: SingingVoiceHost): AlignmentResult | null {
    return this.lastAlignment;
  },

  /**
   * Send phoneme boundaries to AudioWorklet for real-time processing (Section 3).
   * Call this after alignPhonemes() to enable phoneme-aware stretching.
   *
   * @param targetDuration Optional target duration for stretch calculation
   */
  schedulePhonemeFormantGlides(
    this: SingingVoiceHost,
    targetDuration: number,
    triggerTime: number,
    baseFormantShift: number,
    userPhonemes?: PhonemeData[],
  ): void {
    if (
      !this.config.enableFormantShifting ||
      !this.lastAlignment ||
      !this.phonemeAligner ||
      !userPhonemes ||
      userPhonemes.length === 0
    ) {
      return;
    }

    const phonemes = this.lastAlignment.phonemes;
    const sampleRate = this.audioContext.sampleRate;

    // We only care if there is any user phoneme with a formant shift
    const hasFormantShift = userPhonemes.some(
      (p) => false,
    );
    if (!hasFormantShift) {
      return;
    }

    // Calculate absolute stretch map
    const ratios = this.phonemeAligner.calculateStretchRatios(
      phonemes,
      targetDuration,
    );

    let currentTimeSeconds = triggerTime;
    let prevShift = baseFormantShift;

    for (let i = 0; i < phonemes.length; i++) {
      const p = phonemes[i];
      const ratio = ratios[i] || 1.0;
      const originalDurationSec = (p.end - p.start) / sampleRate;
      const stretchedDurationSec = originalDurationSec * ratio;

      const userP = userPhonemes[i];
      let targetShift = baseFormantShift;
      if (userP && (userP as any).formantShift !== undefined) {
        targetShift += (userP as any).formantShift;
      }

      if (prevShift !== targetShift) {
        // Ramp duration bounded by the segment length
        // We use a quick ramp, but bounded to the phoneme length so it doesn't bleed too far
        const rampDuration = Math.min(0.05, stretchedDurationSec);

        // Using existing setFormantGlide:
        // Note setFormantGlide ramps from startSemitones to endSemitones over duration.
        // If we want it to glide during this phoneme segment:
        (this.formantShifter as any)?.setFormantGlide?.(
          prevShift,
          targetShift,
          currentTimeSeconds,
          rampDuration
        );
      } else {
        // Ensure we hold the target shift
        (this.formantShifter as any)?.setFormantShift?.(targetShift, currentTimeSeconds, 0);
      }

      prevShift = targetShift;
      currentTimeSeconds += stretchedDurationSec;
    }
  },

  sendPhonemeDataToWorklet(
    this: SingingVoiceHost,
    targetDuration?: number,
    userPhonemes?: PhonemeData[],
  ): void {
    if (!this.lastAlignment || !this.phonemeAligner || !this.workletNode) {
      return;
    }

    const phonemes = this.lastAlignment.phonemes;

    // Calculate stretch ratios if target duration specified
    let ratios: number[] | undefined;
    if (targetDuration !== undefined) {
      ratios = this.phonemeAligner.calculateStretchRatios(
        phonemes,
        targetDuration,
      );
    }

    // Create shared buffer with phoneme data
    const sharedBuffer = this.phonemeAligner.createSharedPhonemeBuffer(
      phonemes,
      this.audioContext.sampleRate,
      userPhonemes,
    );

    // Send to worklet
    this.workletNode.port.postMessage({
      type: "setPhonemeData",
      data: {
        sharedBuffer,
        ratios,
      },
    });
  },

  /**
   * Connect the output of this voice to an audio destination.
   * If formant shifting is enabled, routes through the formant shifter first.
   *
   * @param destination Destination audio node
   */
  connectOutput(this: SingingVoiceHost, destination: AudioNode): void {
    if (!this.workletNode) {
      throw new Error("Voice not initialized. Call initWorklet() first.");
    }

    // Track so the pool playback path can reach the same output chain.
    this.outputDestinations.add(destination);

    if (this.formantShifter && this.config.enableFormantShifting) {
      // Route through formant shifter
      this.formantShifter.connect(this.workletNode, destination);
    } else {
      // Direct connection
      this.workletNode.connect(destination);
    }
  },

  /**
   * Disconnect the output.
   */
  disconnectOutput(this: SingingVoiceHost): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
    }
    if (this.formantShifter) {
      this.formantShifter.disconnect();
    }
    this.outputDestinations.clear();
    this.isActive = false;
    this.currentPitch = null;
  },

  /**
   * Attach (or detach) the pre-stretched buffer pool.
   * Call this once after the pool is initialised so that `triggerSlice`
   * can use sample-accurate `AudioBufferSourceNode` playback when a
   * pre-stretched buffer is available.
   *
   * @param pool Pool instance, or `null` to disable pool playback.
   */
  setPool(this: SingingVoiceHost, pool: PhonemeBufferPool | null): void {
    this.bufferPool = pool;
  },

  /**
   * Get the underlying AudioWorkletNode.
   * @returns The AudioWorkletNode
   */
  getSourceNode(this: SingingVoiceHost): AudioWorkletNode {
    if (this.workletNode) {
      return this.workletNode;
    }
    throw new Error("SingingVoice not initialized. Call initWorklet() first.");
  },

  /**
   * Connect the worklet to an audio destination.
   * @param destination AudioNode to connect to
   */
  connect(this: SingingVoiceHost, destination: AudioNode): void {
    if (this.workletNode) {
      this.workletNode.connect(destination);
    }
  },

  /**
   * Disconnect the worklet.
   * @param destination Optional specific destination to disconnect from
   */
  disconnect(this: SingingVoiceHost, destination?: AudioNode): void {
    if (this.workletNode) {
      if (destination) {
        this.workletNode.disconnect(destination);
      } else {
        this.workletNode.disconnect();
      }
    }
    this.isActive = false;
    this.currentPitch = null;
  },
};
