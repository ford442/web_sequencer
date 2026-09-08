import { getPhonemeDataAtSample } from "./phonemeData";

interface Grain {
  phase: number;
  start: number;
  size: number;
  active: boolean;
}

export interface FrozenGrainParams {
  rubberBand: any;
  ensureHeapSize: (frames: number) => void;
  getInputHeapPtr: () => number;
  fullSampleBuffer: Float32Array;
  sampleRate: number;
  phonemeData: Float32Array | null;
  phonemeRatios: number[] | null;
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
  samplesRequired: number;
}

/**
 * Spectral granulator used while the sample is frozen: loops a short,
 * windowed, jitterable grain (with 50% overlap between two voices) instead
 * of advancing the streaming pointer. Also owns the grain-triggered stereo
 * pan spread applied post-retrieve.
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

  grainWrapPending = false;
  grainPanL: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2];
  grainPanR: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2];

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

  /** Returns true if this call represents a frozen -> unfrozen transition. */
  exitFreeze(): boolean {
    this.grains[0].active = false;
    this.grains[1].active = false; // Reset phase when unfreezing
    if (this.wasFrozen) {
      this.grainWrapPending = false;
      this.wasFrozen = false;
      // Restore dual-mono on unfreeze
      this.grainPanL.fill(Math.SQRT1_2);
      this.grainPanR.fill(Math.SQRT1_2);
      return true;
    }
    return false;
  }

  updateGrainPan(grainPanSpread: number, isVowel: number): void {
    if (grainPanSpread > 0 && this.grainWrapPending) {
      this.grainWrapPending = false;
      const finalPanSpread = isVowel > 0 ? grainPanSpread : grainPanSpread * 0.3;

      for (let b = 0; b < 3; b++) {
        const spreadMod = b === 0 ? 0.4 : b === 1 ? 0.8 : 1.2;
        const pan = (Math.random() * 2 - 1) * Math.min(1.0, finalPanSpread * spreadMod);
        const angle = ((pan + 1.0) * 0.5) * Math.PI / 2;
        this.grainPanL[b] = Math.cos(angle);
        this.grainPanR[b] = Math.sin(angle);
      }
    } else if (grainPanSpread === 0) {
      this.grainPanL.fill(Math.SQRT1_2);
      this.grainPanR.fill(Math.SQRT1_2);
    }
  }

  renderFrozenBlock(p: FrozenGrainParams): void {
    if (p.samplesRequired <= 0) {
      return;
    }

    const samplesToFeed = p.samplesRequired;
    p.ensureHeapSize(samplesToFeed);

    const heap = p.rubberBand.module.HEAPF32;
    const ptr = p.getInputHeapPtr() >> 2;
    const buf = p.fullSampleBuffer;
    const sRate = p.sampleRate;

    // Define grain size: ~100ms
    let baseGrainSize = Math.floor(sRate * 0.1);
    let grainJitter = p.grainJitterParam;

    // Check for per-phoneme overrides
    if (p.phonemeData && p.phonemeRatios) {
      const pData = getPhonemeDataAtSample(p.phonemeData, p.phonemeRatios, p.currentSamplePtr);
      const pGrainJitter = pData[5];
      const pGrainSize = pData[6];
      if (pGrainJitter !== -1.0) {
        grainJitter = pGrainJitter;
      }
      if (pGrainSize !== -1.0) {
        baseGrainSize = Math.floor(sRate * (pGrainSize / 1000));
      }
    }

    const grainLfoValue = Math.sin(this.grainLfoPhase);
    // Apply unipolar LFO modulation to grain size (reduces size)
    const lfoMod = 1.0 - (p.grainLfoDepth * ((grainLfoValue + 1) * 0.5));

    // Position oscillation based on bipolar grainLfoValue
    const maxPosScanSamples = Math.floor(0.25 * sRate); // Max scan +/-250ms
    const hasActiveSlice = p.endSamplePtr > p.startSamplePtr;
    const sliceStart = hasActiveSlice ? p.startSamplePtr : 0;
    const sliceEnd = hasActiveSlice ? p.endSamplePtr : buf.length;
    const sliceLengthSamples = Math.max(0, sliceEnd - sliceStart);
    const allowedScanSamples = Math.min(maxPosScanSamples, Math.floor(sliceLengthSamples * 0.5));
    const posMod = Math.floor(grainLfoValue * p.grainPosLfoDepth * allowedScanSamples);

    const maxJitterSamples = Math.floor(0.05 * sRate * grainJitter);

    const initGrain = (g: Grain) => {
      const duckedGrainSize = baseGrainSize * (1.0 - (p.duckingScalar * 0.5));
      const grainSizeSamplesActive = Math.max(100, Math.floor(duckedGrainSize * lfoMod * (1.0 - p.grainEnvDepth * p.envelopeValue)));
      const jitterOffsetActive = maxJitterSamples > 0 ? Math.floor((Math.random() * 2 - 1) * maxJitterSamples) : 0;
      const rawCenter = p.currentSamplePtr + jitterOffsetActive + posMod;
      const clampedCenter = Math.max(
        sliceStart + Math.floor(grainSizeSamplesActive / 2),
        Math.min(sliceEnd - Math.floor(grainSizeSamplesActive / 2), rawCenter)
      );
      const grainCenterActive = clampedCenter;
      g.start = Math.max(0, Math.min(buf.length - grainSizeSamplesActive, grainCenterActive - Math.floor(grainSizeSamplesActive / 2)));
      g.size = Math.min(buf.length, g.start + grainSizeSamplesActive) - g.start;
      g.phase = 0;
      g.active = g.size > 0;
    };

    // Ensure at least one grain is active
    if (!this.grains[0].active && !this.grains[1].active) {
      initGrain(this.grains[0]);
    }

    const hasActiveGrain = this.grains[0].active || this.grains[1].active;

    if (hasActiveGrain) {
      // Map TTS syllable volume directly to filter cutoff in the granular engine
      let cutoff = 20000; // default bypassed
      if (p.phonemeData && p.phonemeRatios) {
        const pData = getPhonemeDataAtSample(p.phonemeData, p.phonemeRatios, p.currentSamplePtr);
        const pVol = pData[1];
        if (pVol < 1.0) {
          // Map volume [0, 1] to cutoff frequency [200, 20000] exponentially
          cutoff = 200 * Math.pow(100, pVol);
        }
      }

      // 1-pole IIR lowpass coefficients
      const dt = 1.0 / sRate;
      const rc = 1.0 / (2.0 * Math.PI * cutoff);
      const alpha = dt / (rc + dt);

      for (let i = 0; i < samplesToFeed; i++) {
        let sampleVal = 0;
        for (let gIdx = 0; gIdx < 2; gIdx++) {
          const g = this.grains[gIdx];
          if (g.active) {
            const phase = g.phase / (g.size - 1);
            let windowVal = 1.0;

            if (this.customWindowShape && this.customWindowShape.length > 0) {
              const index = phase * (this.customWindowShape.length - 1);
              const lower = Math.floor(index);
              const upper = Math.ceil(index);
              const weight = index - lower;
              windowVal = this.customWindowShape[lower] * (1 - weight) + this.customWindowShape[upper] * weight;
            } else if (this.customGrainEnvelope && this.customGrainEnvelope.length > 0) {
              const idx = phase * (this.customGrainEnvelope.length - 1);
              const lowerIdx = Math.floor(idx);
              const upperIdx = Math.ceil(idx);
              const fraction = idx - lowerIdx;

              const lowerVal = this.customGrainEnvelope[lowerIdx];
              const upperVal = this.customGrainEnvelope[upperIdx];

              windowVal = lowerVal + (upperVal - lowerVal) * fraction;
            } else {
              // 0: Hann, 1: Hamming, 2: Blackman, 3: Rectangular (None), 4: Gaussian, 5: Sharp Exponential
              if (p.windowShape < 0.5) {
                windowVal = 0.5 * (1 - Math.cos(2 * Math.PI * phase));
              } else if (p.windowShape < 1.5) {
                windowVal = 0.54 - 0.46 * Math.cos(2 * Math.PI * phase);
              } else if (p.windowShape < 2.5) {
                windowVal = 0.42 - 0.5 * Math.cos(2 * Math.PI * phase) + 0.08 * Math.cos(4 * Math.PI * phase);
              } else if (p.windowShape < 3.5) {
                windowVal = 1.0;
              } else if (p.windowShape < 4.5) {
                windowVal = Math.exp(-0.5 * Math.pow((phase - 0.5) / 0.15, 2));
              } else {
                windowVal = Math.pow(Math.sin(Math.PI * phase), 4);
              }
            }

            sampleVal += buf[g.start + g.phase] * windowVal;
            g.phase++;

            // Check if we should start the other grain (50% overlap)
            const otherIdx = gIdx === 0 ? 1 : 0;
            const otherG = this.grains[otherIdx];
            if (g.phase === Math.floor(g.size / 2) && !otherG.active) {
              initGrain(otherG);
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
        }

        // Apply 1-pole lowpass filter to the combined grain signal
        this.grainLpState += alpha * (sampleVal - this.grainLpState);
        heap[ptr + i] = this.grainLpState;
      }
      p.rubberBand.process(p.getInputHeapPtr(), samplesToFeed, false);
    } else {
      // Fallback if grain is empty
      p.rubberBand.process(p.getInputHeapPtr(), 0, false);
    }
  }
}
