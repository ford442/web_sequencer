/// <reference lib="dom" />
/// <reference types="vite/client" />

/**
 * ExpressiveVoiceProcessor — AudioWorkletProcessor for formant-preserving
 * pitch-shift correction on harmony voices.
 *
 * Architecture: voice-level (one instance per harmony voice).
 *
 * DSP algorithm:
 *   Three cascaded IIR biquad peaking-EQ filters (Direct Form II Transposed)
 *   correct the spectral-envelope shift introduced when a harmony voice's
 *   pitch is transposed by AudioBufferSourceNode.playbackRate or rubberband.
 *   When pitch is shifted by N semitones, all formants shift proportionally.
 *   These filters boost or cut at the original formant positions to restore
 *   natural vowel character.
 *
 *   Filter coefficients are recomputed once per 128-sample block (k-rate) —
 *   never inside the per-sample loop.  All working memory is pre-allocated in
 *   the constructor; process() makes zero heap allocations.
 *
 *   A pre-allocated output FIFO (Float32Array ring buffer) ensures exactly
 *   128 frames are delivered per process() call and provides a safe
 *   over/underflow boundary.  No SharedArrayBuffer is used, so Safari
 *   AudioWorkletGlobalScope is fully supported.
 *
 * AudioParam:
 *   pitchShift  (k-rate, semitones)  The semitone offset already applied to
 *               this voice.  Used to compute the inverse formant correction.
 *               Range –24 … +24.  Default 0 (passthrough).
 *
 * Messages (via port):
 *   { type: 'TEARDOWN' }  Zero all state and deactivate the processor.
 *                          Call this when the source voice ends to avoid OOM
 *                          accumulation across many short harmony triggers.
 */

// AudioWorklet global declarations (not available in standard TS lib).
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

declare const globalThis: { sampleRate: number };

// ---------------------------------------------------------------------------
// Constants — all module-level, no runtime allocation.
// ---------------------------------------------------------------------------

/** AudioWorklet standard block size (samples). */
const FRAME_SIZE = 128;

/** Output FIFO capacity (must be ≥ 2 × FRAME_SIZE, power of 2). */
const FIFO_SIZE = 512;
const FIFO_MASK = FIFO_SIZE - 1;

/** Number of formant correction biquad stages. */
const N_FORMANTS = 3;

/** Typical neutral-vowel speech formant centre frequencies (Hz). */
const FORMANT_HZ: [number, number, number] = [500, 1500, 2500];

/** Q values for each formant stage (narrower Q at higher formants). */
const FORMANT_Q: [number, number, number] = [2.0, 3.0, 4.0];

/** Maximum correction gain per formant stage (dB) at ±24 semitone shift. */
const MAX_GAIN_DB = 6.0;

// ---------------------------------------------------------------------------
// ExpressiveVoiceWorkletProcessor
// ---------------------------------------------------------------------------

class ExpressiveVoiceWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'pitchShift',
        defaultValue: 0,
        minValue: -24,
        maxValue: 24,
        automationRate: 'k-rate',
      },
    ];
  }

  // ------------------------------------------------------------------
  // Pre-allocated output FIFO (no SharedArrayBuffer — Safari safe).
  // ------------------------------------------------------------------
  private readonly fifo: Float32Array;
  private fifoWritePos = 0; // monotonically increasing (mod applied on access)
  private fifoReadPos = 0;

  // Per-sample working scratch (used to avoid repeated indexing math).
  private readonly scratch: Float32Array;

  // ------------------------------------------------------------------
  // IIR biquad filter state and coefficients.
  // Layout: [z1_f0, z2_f0,  z1_f1, z2_f1,  z1_f2, z2_f2]
  // Coefficients: [b0, b1, b2, a1, a2] per formant stage.
  // ------------------------------------------------------------------
  private readonly filterState: Float32Array; // N_FORMANTS * 2
  private readonly filterCoeffs: Float32Array; // N_FORMANTS * 5

  // Cache the last applied pitchShift to avoid redundant coefficient updates.
  private lastPitchShift = NaN;

  // Lifecycle flag — set false by TEARDOWN message.
  private alive = true;

  // ---------------------------------------------------------------------------

  constructor() {
    super();

    this.fifo = new Float32Array(FIFO_SIZE);
    this.scratch = new Float32Array(FRAME_SIZE);
    this.filterState = new Float32Array(N_FORMANTS * 2);
    this.filterCoeffs = new Float32Array(N_FORMANTS * 5);

    // Initialise to identity (passthrough) coefficients.
    this._setPassthrough();

    this.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'TEARDOWN') {
        this._teardown();
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers — no dynamic allocation.
  // ---------------------------------------------------------------------------

  /** Load identity (passthrough) coefficients into all filter stages. */
  private _setPassthrough(): void {
    for (let i = 0; i < N_FORMANTS; i++) {
      this.filterCoeffs[i * 5 + 0] = 1; // b0
      this.filterCoeffs[i * 5 + 1] = 0; // b1
      this.filterCoeffs[i * 5 + 2] = 0; // b2
      this.filterCoeffs[i * 5 + 3] = 0; // a1
      this.filterCoeffs[i * 5 + 4] = 0; // a2
    }
  }

  /**
   * Recompute peaking-EQ biquad coefficients for the given pitch shift.
   *
   * For a shift of +N semitones the voice's formants have been moved UP to
   * origF × ratio.  We apply a boost at the ORIGINAL frequency to restore
   * spectral energy to its natural position ("de-chipmunk").
   *
   * For a shift of −N semitones the formants have moved DOWN to origF / ratio.
   * We boost at the SHIFTED (lower) frequency to restore warmth ("de-monster").
   *
   * Coefficients are derived from the Audio EQ Cookbook (R. Bristow-Johnson).
   * Called once per 128-sample block (k-rate) — never per sample.
   */
  private _updateCoefficients(pitchShiftSemitones: number): void {
    if (pitchShiftSemitones === this.lastPitchShift) return;
    this.lastPitchShift = pitchShiftSemitones;

    if (Math.abs(pitchShiftSemitones) < 0.05) {
      this._setPassthrough();
      return;
    }

    const sr = globalThis.sampleRate > 0 ? globalThis.sampleRate : (() => {
      // sampleRate must always be valid in an AudioWorkletGlobalScope.
      // A fallback here indicates a test/mock environment.
      console.warn('[ExpressiveVoiceProcessor] globalThis.sampleRate is not set; defaulting to 44100');
      return 44100;
    })();
    const ratio = Math.pow(2.0, pitchShiftSemitones / 12.0);

    for (let i = 0; i < N_FORMANTS; i++) {
      const origF = FORMANT_HZ[i];
      const Q = FORMANT_Q[i];

      // Scale gain with |pitchShift|: full MAX_GAIN_DB at ±24 semitones.
      const gainDb = Math.min(MAX_GAIN_DB, MAX_GAIN_DB * Math.abs(pitchShiftSemitones) / 24.0);

      // Choose centre frequency: boost at original position for up-shift;
      // boost at shifted (lower) position for down-shift.
      // For down-shift: ratio < 1, so origF * ratio < origF (lower frequency).
      const f0 = pitchShiftSemitones > 0
        ? origF               // formants went UP — pull energy back DOWN to origF
        : origF * ratio;      // formants went DOWN — boost at the lower shifted position

      const f0Clamped = Math.max(20.0, Math.min(sr * 0.45, f0));

      // Peaking EQ (Audio EQ Cookbook).
      const A = Math.pow(10.0, gainDb / 40.0);   // sqrt of linear gain
      const w0 = (2.0 * Math.PI * f0Clamped) / sr;
      const cosW = Math.cos(w0);
      const sinW = Math.sin(w0);
      const alpha = sinW / (2.0 * Q);

      const a0inv = 1.0 / (1.0 + alpha / A);
      this.filterCoeffs[i * 5 + 0] = (1.0 + alpha * A) * a0inv;  // b0 / a0
      this.filterCoeffs[i * 5 + 1] = (-2.0 * cosW) * a0inv;       // b1 / a0
      this.filterCoeffs[i * 5 + 2] = (1.0 - alpha * A) * a0inv;   // b2 / a0
      this.filterCoeffs[i * 5 + 3] = (-2.0 * cosW) * a0inv;       // a1 / a0
      this.filterCoeffs[i * 5 + 4] = (1.0 - alpha / A) * a0inv;   // a2 / a0
    }
  }

  /**
   * Apply N_FORMANTS cascaded peaking-EQ biquad filters in place on `buf[0..len)`.
   * Uses Direct Form II Transposed — numerically stable for audio.
   * No allocation; state is read from / written to `this.filterState`.
   */
  private _applyFilters(buf: Float32Array, len: number): void {
    for (let f = 0; f < N_FORMANTS; f++) {
      const b0 = this.filterCoeffs[f * 5 + 0];
      const b1 = this.filterCoeffs[f * 5 + 1];
      const b2 = this.filterCoeffs[f * 5 + 2];
      const a1 = this.filterCoeffs[f * 5 + 3];
      const a2 = this.filterCoeffs[f * 5 + 4];
      let z1 = this.filterState[f * 2 + 0];
      let z2 = this.filterState[f * 2 + 1];

      for (let n = 0; n < len; n++) {
        const x = buf[n];
        const y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        buf[n] = y;
      }

      this.filterState[f * 2 + 0] = z1;
      this.filterState[f * 2 + 1] = z2;
    }
  }

  /**
   * Zero all state, silence the FIFO, and deactivate the processor.
   * Called when { type: 'TEARDOWN' } is received via the port.
   */
  private _teardown(): void {
    this.alive = false;
    this.fifo.fill(0);
    this.scratch.fill(0);
    this.filterState.fill(0);
    this.fifoWritePos = 0;
    this.fifoReadPos = 0;
  }

  // ---------------------------------------------------------------------------
  // AudioWorkletProcessor.process()
  // ---------------------------------------------------------------------------

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    if (!this.alive) return false;

    // k-rate: update filter coefficients at most once per block.
    // `pitchShift` is a k-rate AudioParam, so parameters.pitchShift always has
    // exactly one value per block.  The guard handles edge cases in test mocks.
    const pitchShift =
      parameters.pitchShift && parameters.pitchShift.length > 0
        ? parameters.pitchShift[0]
        : 0;
    this._updateCoefficients(pitchShift);

    const outputChannels = outputs[0];
    if (!outputChannels || outputChannels.length === 0) return true;

    const nFrames = outputChannels[0]?.length ?? FRAME_SIZE;
    const inputCh = inputs[0]?.[0];

    // --- Step 1: Copy input (or silence) into scratch, apply formant filters ---
    if (inputCh && inputCh.length >= nFrames) {
      for (let n = 0; n < nFrames; n++) {
        this.scratch[n] = inputCh[n];
      }
    } else {
      for (let n = 0; n < nFrames; n++) {
        this.scratch[n] = 0;
      }
    }
    this._applyFilters(this.scratch, nFrames);

    // --- Step 2: Write filtered samples into the output FIFO ---
    for (let n = 0; n < nFrames; n++) {
      this.fifo[(this.fifoWritePos + n) & FIFO_MASK] = this.scratch[n];
    }
    this.fifoWritePos += nFrames;

    // --- Step 3: Read exactly nFrames from FIFO → all output channels ---
    const available = this.fifoWritePos - this.fifoReadPos;
    const nRead = available >= nFrames ? nFrames : available;

    for (let ch = 0; ch < outputChannels.length; ch++) {
      const outCh = outputChannels[ch];
      if (!outCh) continue;
      for (let n = 0; n < nRead; n++) {
        outCh[n] = this.fifo[(this.fifoReadPos + n) & FIFO_MASK];
      }
      // Zero-pad if FIFO underflows (should not happen in steady state).
      for (let n = nRead; n < nFrames; n++) {
        outCh[n] = 0;
      }
    }
    this.fifoReadPos += nRead;

    return true;
  }
}

registerProcessor('expressive-voice-processor', ExpressiveVoiceWorkletProcessor);
