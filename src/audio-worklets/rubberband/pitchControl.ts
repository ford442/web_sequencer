/**
 * Per-block pitch scale for the Rubber Band stretcher: note pitch × pitch
 * envelope × granular shift × phoneme bend / microtonal variance, then the
 * two auto-tune stages (input-side period detector and output-side
 * zero-crossing tracker) or granular pitch quantisation.
 *
 * Extracted from rubberband-processor.ts unchanged in behaviour; it owns the
 * detector state so the processor only schedules.
 */

/** Read-only view of the processor state the pitch stages depend on. */
export interface PitchContext {
  /** A note is streaming from the loaded sample. */
  playing: boolean;
  basePitch: number;
  targetHz: number;
  sampleRate: number;
  envelopeValue: number;
  pitchEnvelopeValue: number;
  fullSampleBuffer: Float32Array | null;
  currentSamplePtr: number;
  /** Phoneme tuple at the read position, or null without phoneme data. */
  phoneme: Float32Array | null;
}

const param = (parameters: Record<string, Float32Array>, name: string, fallback: number): number =>
  parameters[name] ? parameters[name][0] : fallback;

export class PitchController {
  private readonly detect = {
    lastSample: 0,
    lastCrossIndex: 0,
    periods: new Float32Array(5),
    periodIndex: 0,
    lastValidF0: 0,
    smoothCorr: 1.0,
  };

  private outLastSign = 0;
  private outSamplesSinceZero = 0;
  private outSmoothedPeriod = 0;

  compute(ctx: PitchContext, parameters: Record<string, Float32Array>): number {
    const pitch = parameters.pitchScale[0];
    let finalPitch = ctx.playing ? ctx.basePitch * pitch : pitch;

    // Pitch envelope (amount in semitones, envelope 0..1)
    const pitchAmount = param(parameters, 'pitchAmount', 0.0);
    if (pitchAmount !== 0.0 && ctx.pitchEnvelopeValue > 0.0) {
      finalPitch *= Math.pow(2.0, (pitchAmount * ctx.pitchEnvelopeValue) / 12.0);
    }

    // Granular pitch shift, plus its envelope (maps 0..1 to up to 24 st)
    let granularPitchShift = param(parameters, 'granularPitchShift', 0.0);
    const grainPitchEnvDepth = param(parameters, 'grainPitchEnvDepth', 0.0);
    if (grainPitchEnvDepth !== 0.0 && ctx.pitchEnvelopeValue > 0.0) {
      granularPitchShift += 24.0 * grainPitchEnvDepth * ctx.pitchEnvelopeValue;
    }
    if (granularPitchShift !== 0.0) {
      finalPitch *= Math.pow(2.0, granularPitchShift / 12.0);
    }

    // Phoneme pitch bend and per-phoneme microtonal variance
    if (ctx.playing && ctx.phoneme) {
      const pBend = ctx.phoneme[2];
      if (pBend !== 0.0) {
        finalPitch *= Math.pow(2.0, pBend / 1200.0);
      }

      const microtonalVariance = param(parameters, 'microtonalVariance', 0.0);
      const phonemeIndex = ctx.phoneme[8];
      if (microtonalVariance > 0.0 && phonemeIndex !== -1.0) {
        // Stable pseudo-random value in [-1, 1] per phoneme index
        let variation = Math.sin(phonemeIndex * 12.9898 + 78.233) * 43758.5453;
        variation = variation - Math.floor(variation);
        variation = (variation * 2.0) - 1.0;
        finalPitch *= Math.pow(2.0, (variation * microtonalVariance) / 1200.0);
      }
    }

    const autoTune = param(parameters, 'autoTune', 0.0);
    finalPitch *= this.inputCorrection(ctx, autoTune);

    if (!(autoTune > 0.0 && ctx.playing && ctx.targetHz > 0)) {
      // Granular pitch quantisation, only without auto-tune (they would fight)
      const grainPitchQuantize = param(parameters, 'grainPitchQuantize', 0.0);
      if (grainPitchQuantize > 0.0 && finalPitch > 0.0) {
        const semitones = 12.0 * Math.log2(finalPitch);
        finalPitch = Math.pow(2.0, (Math.round(semitones / grainPitchQuantize) * grainPitchQuantize) / 12.0);
      }
    }

    // Output-side auto-tune: snap the previous block's detected pitch to the nearest note
    if (autoTune > 0.0 && this.outSmoothedPeriod > 0) {
      const detectedFreq = ctx.sampleRate / this.outSmoothedPeriod;
      if (detectedFreq > 20 && detectedFreq < 20000) {
        const nearestMidiNote = Math.round(12.0 * Math.log2(detectedFreq / 440.0) + 69.0);
        const targetFreq = 440.0 * Math.pow(2.0, (nearestMidiNote - 69.0) / 12.0);
        finalPitch *= (1.0 - autoTune) + (autoTune * (targetFreq / detectedFreq));
      }
    }

    return finalPitch;
  }

  /** Zero-crossing period tracker on the retrieved block (output-side auto-tune). */
  trackOutput(output: Float32Array, autoTune: number): void {
    if (!(autoTune > 0.0)) return;
    for (let i = 0; i < output.length; i++) {
      const currentSign = output[i] >= 0 ? 1 : -1;
      this.outSamplesSinceZero++;
      if (currentSign !== this.outLastSign) {
        if (currentSign === 1) {
          // Filter out very high frequency noise (> ~4 kHz)
          if (this.outSamplesSinceZero > 10) {
            const period = this.outSamplesSinceZero;
            this.outSmoothedPeriod = this.outSmoothedPeriod === 0
              ? period
              : this.outSmoothedPeriod * 0.9 + period * 0.1;
          }
          this.outSamplesSinceZero = 0;
        }
        this.outLastSign = currentSign;
      }
    }
  }

  /**
   * Input-side auto-tune: a zero-crossing period detector on the source
   * sample (vowels only), smoothed toward targetHz; decays to 1 when idle.
   */
  private inputCorrection(ctx: PitchContext, autoTune: number): number {
    const s = this.detect;
    const buf = ctx.fullSampleBuffer;
    if (!(autoTune > 0.0 && ctx.playing && buf && ctx.targetHz > 0)) {
      s.smoothCorr = s.smoothCorr * 0.8 + 1.0 * 0.2;
      return s.smoothCorr;
    }

    const isVowel = (ctx.phoneme ? ctx.phoneme[7] : 0.0) > 0;
    if (isVowel && ctx.envelopeValue > 0.01) {
      const searchFrames = Math.min(1024, buf.length - ctx.currentSamplePtr);
      const minPeriod = Math.floor(ctx.sampleRate / 400); // 400 Hz max
      const maxPeriod = Math.floor(ctx.sampleRate / 70);  // 70 Hz min
      let crosses = 0;
      for (let i = 0; i < searchFrames; i++) {
        const idx = ctx.currentSamplePtr + i;
        const x = buf[idx];
        // Hysteresis threshold to avoid noise false triggers
        if (x > 0.02 && s.lastSample <= 0.02) {
          if (s.lastCrossIndex > 0) {
            const period = idx - s.lastCrossIndex;
            if (period >= minPeriod && period <= maxPeriod) {
              s.periods[s.periodIndex] = period;
              s.periodIndex = (s.periodIndex + 1) % 5;
              crosses++;
              if (crosses >= 2) break;
            }
          }
          s.lastCrossIndex = idx;
        }
        s.lastSample = x;
      }

      let validPeriods = 0;
      let sum = 0;
      for (let i = 0; i < 5; i++) {
        if (s.periods[i] > 0) {
          validPeriods++;
          sum += s.periods[i];
        }
      }
      if (validPeriods > 0) {
        s.lastValidF0 = ctx.sampleRate / (sum / validPeriods);
      }
    }

    // Correct toward the last valid F0 (held through consonants)
    let corr = 1.0;
    if (s.lastValidF0 > 0) {
      const rawCorr = Math.max(0.5, Math.min(2.0, ctx.targetHz / s.lastValidF0));
      corr = 1.0 + autoTune * (rawCorr - 1.0);
    }
    s.smoothCorr = s.smoothCorr * 0.8 + corr * 0.2;
    return s.smoothCorr;
  }
}
