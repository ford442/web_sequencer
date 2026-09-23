interface Grain {
  phase: number;
  start: number;
  size: number;
  active: boolean;
}

export interface FrozenGrainParams {
  fullSampleBuffer: Float32Array;
  sampleRate: number;
  /** True when playing with phoneme data + ratios (the per-phoneme fields below apply). */
  hasPhonemeContext: boolean;
  /** Phoneme tuple[1]; drives the grain low-pass cutoff. */
  phonemeVolume: number;
  /** Phoneme tuple[5]; -1 = no override. */
  phonemeGrainJitter: number;
  /** Phoneme tuple[6]; -1 = no override. */
  phonemeGrainSizeMs: number;
  currentSamplePtr: number;
  startSamplePtr: number;
  endSamplePtr: number;
  duckingScalar: number;
  envelopeValue: number;
  grainJitterParam: number;
  grainEnvDepth: number;
  windowShape: number;
  grainLfoDepth: number;
  grainPosLfoDepth: number;
  /** Note velocity 0..1; softer notes jitter more. */
  velocity: number;
}

interface GrainGeometry {
  baseGrainSize: number;
  lfoMod: number;
  maxJitterSamples: number;
  posMod: number;
  sliceStart: number;
  sliceEnd: number;
  bufLength: number;
}

/**
 * Spectral granulator used while the sample is frozen: loops a short,
 * windowed, jitterable grain (with 50% overlap between two voices) instead
 * of advancing the streaming pointer. Also owns the grain-triggered stereo
 * pan spread applied post-retrieve.
 *
 * TS oracle / fallback for rb_fx_render_grains in emscripten/rubberband_fx.cpp.
 */
export class GranularEngine {
  private grains: [Grain, Grain] = [
    { phase: 0, start: 0, size: 0, active: false },
    { phase: 0, start: 0, size: 0, active: false }
  ];
  private customWindowShape: Float32Array | null = null;
  private customGrainEnvelope: number[] | null = null;
  private grainLpState = 0;
  private freezeLfoPhase = 0;
  private grainLfoPhase = 0;
  private wasFrozen = false;
  private readonly geometry: GrainGeometry = {
    baseGrainSize: 0, lfoMod: 1, maxJitterSamples: 0, posMod: 0, sliceStart: 0, sliceEnd: 0, bufLength: 0,
  };

  grainWrapPending = false;
  grainPanL: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2];
  grainPanR: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2];

  private readonly random: () => number;

  /** `random` is injectable so tests can replay the native RNG sequence. */
  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  setCustomWindowShape(shape: Float32Array | null): void {
    this.customWindowShape = shape;
  }

  setCustomGrainEnvelope(shape: number[] | null): void {
    this.customGrainEnvelope = shape;
  }

  advanceLfoPhases(freezeLfoRate: number, grainLfoRate: number, sampleRate: number, framesInBlock: number): void {
    this.freezeLfoPhase += (2 * Math.PI * freezeLfoRate * framesInBlock) / sampleRate;
    if (this.freezeLfoPhase > 2 * Math.PI) {
      this.freezeLfoPhase -= 2 * Math.PI;
    }

    this.grainLfoPhase += (2 * Math.PI * grainLfoRate * framesInBlock) / sampleRate;
    if (this.grainLfoPhase > 2 * Math.PI) {
      this.grainLfoPhase -= 2 * Math.PI;
    }
  }

  getFreezeLfoValue(): number {
    return Math.sin(this.freezeLfoPhase);
  }

  enterFreeze(): void {
    if (!this.wasFrozen) {
      this.grainWrapPending = true;
    }
    this.wasFrozen = true;
  }

  exitFreeze(): void {
    this.grains[0].active = false;
    this.grains[1].active = false; // Reset phase when unfreezing
    if (this.wasFrozen) {
      this.grainWrapPending = false;
      this.wasFrozen = false;
      // Restore dual-mono on unfreeze
      this.grainPanL.fill(Math.SQRT1_2);
      this.grainPanR.fill(Math.SQRT1_2);
    }
  }

  updateGrainPan(grainPanSpread: number, isVowel: number): void {
    if (grainPanSpread > 0 && this.grainWrapPending) {
      this.grainWrapPending = false;
      const finalPanSpread = isVowel > 0 ? grainPanSpread : grainPanSpread * 0.3;

      // Pseudo-spiral LFO path mixed with random jitter for spectral bands:
      // band 0 follows cos(phase), band 1 sin(phase), band 2 is offset 45°.
      const lfoPhase = this.grainLfoPhase;
      for (let b = 0; b < 3; b++) {
        const spreadMod = b === 0 ? 0.4 : b === 1 ? 0.8 : 1.2;
        const phase = b === 0 ? lfoPhase : b === 1 ? lfoPhase - Math.PI / 2 : lfoPhase + Math.PI / 4;
        const jitter = (this.random() * 2 - 1) * 0.2;
        const pos = Math.max(-1.0, Math.min(1.0, Math.cos(phase) + jitter));
        const pan = pos * Math.min(1.0, finalPanSpread * spreadMod);

        const angle = ((pan + 1.0) * 0.5) * Math.PI / 2;
        this.grainPanL[b] = Math.cos(angle);
        this.grainPanR[b] = Math.sin(angle);
      }
    } else if (grainPanSpread === 0) {
      this.grainPanL.fill(Math.SQRT1_2);
      this.grainPanR.fill(Math.SQRT1_2);
    }
  }

  private initGrain(g: Grain, p: FrozenGrainParams, geo: GrainGeometry): void {
    const duckedGrainSize = geo.baseGrainSize * (1.0 - (p.duckingScalar * 0.5));
    const grainSizeSamplesActive = Math.max(100, Math.floor(duckedGrainSize * geo.lfoMod * (1.0 - p.grainEnvDepth * p.envelopeValue)));
    const jitterOffsetActive = geo.maxJitterSamples > 0 ? Math.floor((this.random() * 2 - 1) * geo.maxJitterSamples) : 0;
    const rawCenter = p.currentSamplePtr + jitterOffsetActive + geo.posMod;
    const clampedCenter = Math.max(
      geo.sliceStart + Math.floor(grainSizeSamplesActive / 2),
      Math.min(geo.sliceEnd - Math.floor(grainSizeSamplesActive / 2), rawCenter)
    );
    g.start = Math.max(0, Math.min(geo.bufLength - grainSizeSamplesActive, clampedCenter - Math.floor(grainSizeSamplesActive / 2)));
    g.size = Math.min(geo.bufLength, g.start + grainSizeSamplesActive) - g.start;
    g.phase = 0;
    g.active = g.size > 0;
  }

  private windowValue(phase: number, windowShape: number): number {
    if (this.customWindowShape && this.customWindowShape.length > 0) {
      const index = phase * (this.customWindowShape.length - 1);
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const weight = index - lower;
      return this.customWindowShape[lower] * (1 - weight) + this.customWindowShape[upper] * weight;
    }
    if (this.customGrainEnvelope && this.customGrainEnvelope.length > 0) {
      const idx = phase * (this.customGrainEnvelope.length - 1);
      const lowerIdx = Math.floor(idx);
      const upperIdx = Math.ceil(idx);
      const fraction = idx - lowerIdx;
      const lowerVal = this.customGrainEnvelope[lowerIdx];
      const upperVal = this.customGrainEnvelope[upperIdx];
      return lowerVal + (upperVal - lowerVal) * fraction;
    }
    // 0: Hann, 1: Hamming, 2: Blackman, 3: Rectangular (None), 4: Gaussian, 5: Sharp Exponential
    if (windowShape < 0.5) return 0.5 * (1 - Math.cos(2 * Math.PI * phase));
    if (windowShape < 1.5) return 0.54 - 0.46 * Math.cos(2 * Math.PI * phase);
    if (windowShape < 2.5) return 0.42 - 0.5 * Math.cos(2 * Math.PI * phase) + 0.08 * Math.cos(4 * Math.PI * phase);
    if (windowShape < 3.5) return 1.0;
    if (windowShape < 4.5) return Math.exp(-0.5 * Math.pow((phase - 0.5) / 0.15, 2));
    return Math.pow(Math.sin(Math.PI * phase), 4);
  }

  /**
   * Writes `frames` granulated samples into out[offset..]. Returns the frame
   * count to feed the stretcher, 0 when no grain could start (feed 0), or -1
   * when frames <= 0 (do not call the stretcher at all).
   */
  renderGrains(p: FrozenGrainParams, out: Float32Array, offset: number, frames: number): number {
    if (frames <= 0) {
      return -1;
    }

    const buf = p.fullSampleBuffer;
    const sRate = p.sampleRate;

    // Define grain size: ~100ms
    let baseGrainSize = Math.floor(sRate * 0.1);

    // Scale grain jitter based on note velocity:
    // Lower velocity = more jitter, higher velocity = less jitter.
    // Velocity of 1.0 = normal jitter. Velocity < 1.0 increases it.
    const velocityJitterScale = Math.max(1.0, 1.5 - p.velocity * 0.5);
    let grainJitter = Math.min(1.0, p.grainJitterParam * velocityJitterScale);

    // Check for per-phoneme overrides
    if (p.hasPhonemeContext) {
      if (p.phonemeGrainJitter !== -1.0) {
        grainJitter = Math.min(1.0, p.phonemeGrainJitter * velocityJitterScale);
      }
      if (p.phonemeGrainSizeMs !== -1.0) {
        baseGrainSize = Math.floor(sRate * (p.phonemeGrainSizeMs / 1000));
      }
    }

    const grainLfoValue = Math.sin(this.grainLfoPhase);
    const geo = this.geometry;
    geo.baseGrainSize = baseGrainSize;
    // Apply unipolar LFO modulation to grain size (reduces size)
    geo.lfoMod = 1.0 - (p.grainLfoDepth * ((grainLfoValue + 1) * 0.5));

    // Position oscillation based on bipolar grainLfoValue
    const maxPosScanSamples = Math.floor(0.25 * sRate); // Max scan +/-250ms
    const hasActiveSlice = p.endSamplePtr > p.startSamplePtr;
    geo.sliceStart = hasActiveSlice ? p.startSamplePtr : 0;
    geo.sliceEnd = hasActiveSlice ? p.endSamplePtr : buf.length;
    const sliceLengthSamples = Math.max(0, geo.sliceEnd - geo.sliceStart);
    const allowedScanSamples = Math.min(maxPosScanSamples, Math.floor(sliceLengthSamples * 0.5));
    geo.posMod = Math.floor(grainLfoValue * p.grainPosLfoDepth * allowedScanSamples);
    geo.maxJitterSamples = Math.floor(0.05 * sRate * grainJitter);
    geo.bufLength = buf.length;

    // Ensure at least one grain is active
    if (!this.grains[0].active && !this.grains[1].active) {
      this.initGrain(this.grains[0], p, geo);
    }

    if (!this.grains[0].active && !this.grains[1].active) {
      // No grain could start (empty buffer): feed the stretcher nothing.
      return 0;
    }

    // Map TTS syllable volume directly to filter cutoff in the granular engine
    let cutoff = 20000; // default bypassed
    if (p.hasPhonemeContext && p.phonemeVolume < 1.0) {
      // Map volume [0, 1] to cutoff frequency [200, 20000] exponentially
      cutoff = 200 * Math.pow(100, p.phonemeVolume);
    }

    // 1-pole IIR lowpass coefficients
    const dt = 1.0 / sRate;
    const rc = 1.0 / (2.0 * Math.PI * cutoff);
    const alpha = dt / (rc + dt);

    for (let i = 0; i < frames; i++) {
      let sampleVal = 0;
      for (let gIdx = 0; gIdx < 2; gIdx++) {
        const g = this.grains[gIdx];
        if (!g.active) continue;
        const phase = g.phase / (g.size - 1);
        sampleVal += buf[g.start + g.phase] * this.windowValue(phase, p.windowShape);
        g.phase++;

        // Check if we should start the other grain (50% overlap)
        const otherG = this.grains[gIdx === 0 ? 1 : 0];
        if (g.phase === Math.floor(g.size / 2) && !otherG.active) {
          this.initGrain(otherG, p, geo);
        }

        if (g.phase >= g.size) {
          g.active = false;
          if (gIdx === 0) {
            // Only trigger grain wrap panning when the primary grain finishes
            // to avoid double triggers that flutter the stereo field too much
            this.grainWrapPending = true;
          }
        }
      }

      // Apply 1-pole lowpass filter to the combined grain signal
      this.grainLpState += alpha * (sampleVal - this.grainLpState);
      out[offset + i] = this.grainLpState;
    }
    return frames;
  }
}
