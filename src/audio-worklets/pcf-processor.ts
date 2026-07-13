// src/audio-worklets/pcf-processor.ts
// Pattern Controlled Filter (PCF) AudioWorklet Processor
// Implements ReBirth-style pattern-driven filter modulation as a real-time audio effect.

declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

/** Clamp a value to the [0, 1] range. */
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
/** Clamp a value to the [0, 127] MIDI range. */
function clampMidi(v: number): number { return v < 0 ? 0 : v > 127 ? 127 : v; }

/** Filter types matching ReBirth PCF */
const PCF_FILTER_LP = 0;
const PCF_FILTER_BP = 1;
const PCF_FILTER_HP = 2;

/** Maximum steps in PCF pattern */
const MAX_PATTERN_STEPS = 32;

/**
 * Payload for the `set-automation` port message.
 *
 * Each field is independently optional; the presence/absence of a key
 * controls whether the corresponding automation override is modified:
 *  - `key present, value is number`  → activate/update that override
 *  - `key present, value is null`    → clear (deactivate) that override
 *  - `key absent`                    → leave the override unchanged
 */
interface PcfAutomationData {
  /** Absolute cutoff frequency in Hz (overrides pattern-driven cutoff). */
  cutoffHz?: number | null;
  /** Resonance as a MIDI value 0–127 (overrides base resonance). */
  resonanceMidi?: number | null;
  /** Envelope amount as a normalised 0–1 value (overrides base envAmount). */
  envAmountNorm?: number | null;
}

/**
 * PCF Processor - Pattern Controlled Filter
 *
 * Implements a biquad filter (LP/BP/HP) whose cutoff frequency is modulated
 * by a step pattern synchronized to transport position. This reproduces the
 * characteristic ReBirth PCF sound: rhythmic filter sweeps driven by a
 * programmable 16-step (or 32-step) modulation pattern.
 *
 * Messages accepted via port:
 *  - { type: 'set-params', data: PcfParams }
 *  - { type: 'set-pattern', data: number[] }  (0-127 per step)
 *  - { type: 'set-transport', data: { playing, bpm, stepIndex } }
 *  - { type: 'set-enabled', data: boolean }
 *  - { type: 'set-automation', data: PcfAutomationData }
 */
class PcfProcessor extends AudioWorkletProcessor {
    // Filter state (Direct Form II Transposed)
    private z1L = 0;
    private z2L = 0;
    private z1R = 0;
    private z2R = 0;

    // Current biquad coefficients
    private b0 = 1;
    private b1 = 0;
    private b2 = 0;
    private a1 = 0;
    private a2 = 0;

    // PCF Parameters (0-127 MIDI-style, converted internally)
    private filterType: number = PCF_FILTER_LP;
    private baseCutoff = 80;       // 0-127
    private resonance = 40;        // 0-127
    private envAmount = 60;        // 0-127
    private decay = 40;            // 0-127

    // Modulation pattern (0-127 per step)
    private pattern: number[] = new Array(16).fill(0);
    private patternLength = 16;

    // Transport state
    private playing = false;
    private bpm = 120;
    private currentStep = 0;

    // Envelope state for decay
    private envelopeLevel = 0;
    private envelopeDecayRate = 0;

    // Smoothing for cutoff changes (avoid zipper noise)
    private targetCutoffHz = 1000;
    private currentCutoffHz = 1000;
    private smoothingCoeff = 0;

    // Sample counter for step timing
    private sampleCounter = 0;
    private samplesPerStep = 0;

    // Enable/disable
    private enabled = true;

    // Automation overrides (external values, bypass pattern/params)
    private automationCutoffHz = -1;      // -1 means no override (Hz)
    private automationResonanceMidi = -1; // -1 means no override (0-127)
    private automationEnvAmountNorm = -1; // -1 means no override (0-1)

    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
        this.updateSamplesPerStep();
        this.updateSmoothingCoeff();
        this.updateEnvelopeDecayRate();
        this.computeCoefficients(this.currentCutoffHz, this.resonance);
    }

    private handleMessage(event: MessageEvent): void {
        const { type, data } = event.data;

        switch (type) {
            case 'set-params': {
                if (data.filterType !== undefined) this.filterType = data.filterType;
                if (data.cutoff !== undefined) this.baseCutoff = clampMidi(data.cutoff);
                if (data.resonance !== undefined) this.resonance = clampMidi(data.resonance);
                if (data.envAmount !== undefined) this.envAmount = clampMidi(data.envAmount);
                if (data.decay !== undefined) {
                    this.decay = clampMidi(data.decay);
                    this.updateEnvelopeDecayRate();
                }
                break;
            }
            case 'set-pattern': {
                if (Array.isArray(data)) {
                    this.pattern = data.slice(0, MAX_PATTERN_STEPS).map(
                        (v: number) => clampMidi(v)
                    );
                    this.patternLength = this.pattern.length;
                }
                break;
            }
            case 'set-transport': {
                if (data.playing !== undefined) this.playing = data.playing;
                if (data.bpm !== undefined) {
                    this.bpm = Math.max(20, Math.min(300, data.bpm));
                    this.updateSamplesPerStep();
                }
                if (data.stepIndex !== undefined) {
                    this.currentStep = data.stepIndex % this.patternLength;
                    this.sampleCounter = 0;
                    this.triggerStep();
                }
                break;
            }
            case 'set-enabled': {
                this.enabled = !!data;
                if (!this.enabled) {
                    // Reset filter state when disabled
                    this.z1L = this.z2L = this.z1R = this.z2R = 0;
                }
                break;
            }
            case 'set-automation': {
                const automation = data as PcfAutomationData | null;
                if (!automation) break;
                if ('cutoffHz' in automation) {
                    this.automationCutoffHz =
                        typeof automation.cutoffHz === 'number' ? automation.cutoffHz : -1;
                }
                if ('resonanceMidi' in automation) {
                    this.automationResonanceMidi =
                        typeof automation.resonanceMidi === 'number'
                            ? clampMidi(automation.resonanceMidi)
                            : -1;
                }
                if ('envAmountNorm' in automation) {
                    this.automationEnvAmountNorm =
                        typeof automation.envAmountNorm === 'number'
                            ? clamp01(automation.envAmountNorm)
                            : -1;
                }
                break;
            }
        }
    }

    /**
     * Convert MIDI-range cutoff (0-127) to frequency in Hz.
     * Uses exponential mapping: 20Hz to 20000Hz.
     */
    private midiToHz(midiValue: number): number {
        // Exponential mapping: 0→20Hz, 127→20000Hz
        const normalized = midiValue / 127;
        return 20 * Math.pow(1000, normalized);
    }

    /**
     * Convert MIDI resonance (0-127) to Q factor.
     * Maps 0→0.5, 127→30 (high resonance for acid sounds).
     */
    private midiToQ(midiResonance: number): number {
        const normalized = midiResonance / 127;
        return 0.5 + normalized * 29.5;
    }

    private updateSamplesPerStep(): void {
        // 16th note duration at current BPM
        // One beat = 60/bpm seconds, one 16th = beat/4
        const secondsPerStep = 60 / (this.bpm * 4);
        this.samplesPerStep = Math.floor(secondsPerStep * sampleRate);
    }

    private updateSmoothingCoeff(): void {
        // ~5ms smoothing time constant
        const smoothTimeMs = 5;
        const smoothTimeSamples = (smoothTimeMs / 1000) * sampleRate;
        this.smoothingCoeff = 1 - Math.exp(-1 / smoothTimeSamples);
    }

    private updateEnvelopeDecayRate(): void {
        // Map decay (0-127) to decay time: 0→5ms, 127→500ms
        const decayNorm = this.decay / 127;
        const decayTimeMs = 5 + decayNorm * 495;
        const decayTimeSamples = (decayTimeMs / 1000) * sampleRate;
        // Exponential decay rate per sample
        this.envelopeDecayRate = Math.exp(-1 / decayTimeSamples);
    }

    /**
     * Trigger a new step: read pattern value and set envelope.
     */
    private triggerStep(): void {
        const stepValue = this.pattern[this.currentStep % this.patternLength] || 0;
        // Envelope amplitude: automation override takes priority over the base envAmount.
        const envScale = this.automationEnvAmountNorm >= 0
            ? this.automationEnvAmountNorm
            : this.envAmount / 127;
        this.envelopeLevel = (stepValue / 127) * envScale;
    }

    /**
     * Compute biquad filter coefficients for the given cutoff and resonance.
     * Uses Robert Bristow-Johnson's Audio EQ Cookbook formulas.
     */
    private computeCoefficients(cutoffHz: number, resonanceMidi: number): void {
        const freq = Math.max(20, Math.min(sampleRate * 0.45, cutoffHz));
        const Q = this.midiToQ(resonanceMidi);

        const w0 = (2 * Math.PI * freq) / sampleRate;
        const cosW0 = Math.cos(w0);
        const sinW0 = Math.sin(w0);
        const alpha = sinW0 / (2 * Q);

        let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

        switch (this.filterType) {
            case PCF_FILTER_BP:
                // Bandpass (constant skirt gain)
                b0 = alpha;
                b1 = 0;
                b2 = -alpha;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
                break;
            case PCF_FILTER_HP:
                // Highpass
                b0 = (1 + cosW0) / 2;
                b1 = -(1 + cosW0);
                b2 = (1 + cosW0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
                break;
            case PCF_FILTER_LP:
            default:
                // Lowpass
                b0 = (1 - cosW0) / 2;
                b1 = 1 - cosW0;
                b2 = (1 - cosW0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
                break;
        }

        // Normalize by a0
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0] || !output || !output[0]) {
            return true;
        }

        const inputL = input[0];
        const inputR = input[1] || input[0];
        const outputL = output[0];
        const outputR = output[1] || output[0];
        const blockSize = inputL.length;

        // Bypass: pass through unmodified
        if (!this.enabled) {
            for (let i = 0; i < blockSize; i++) {
                outputL[i] = inputL[i];
                if (output[1]) outputR[i] = inputR[i];
            }
            return true;
        }

        // Advance transport and compute target cutoff at block rate
        // (recompute coefficients once per block to reduce CPU)
        if (this.playing) {
            this.sampleCounter += blockSize;
            while (this.sampleCounter >= this.samplesPerStep) {
                this.sampleCounter -= this.samplesPerStep;
                this.currentStep = (this.currentStep + 1) % this.patternLength;
                this.triggerStep();
            }
        }

        // Apply envelope decay for block duration
        this.envelopeLevel *= Math.pow(this.envelopeDecayRate, blockSize);

        // Calculate target cutoff for this block
        let targetHz: number;
        if (this.automationCutoffHz >= 0) {
            targetHz = this.automationCutoffHz;
        } else {
            const baseHz = this.midiToHz(this.baseCutoff);
            const maxHz = this.midiToHz(127);
            const modRange = (maxHz - baseHz) * this.envelopeLevel;
            targetHz = baseHz + modRange;
        }

        // Smooth cutoff and recompute coefficients once per block
        this.currentCutoffHz += (targetHz - this.currentCutoffHz) * this.smoothingCoeff * blockSize;
        if (Math.abs(this.currentCutoffHz - this.targetCutoffHz) > 0.5) {
            this.targetCutoffHz = this.currentCutoffHz;
            // Use automation resonance override when active, else the base resonance.
            const resonanceForCoeffs = this.automationResonanceMidi >= 0
                ? this.automationResonanceMidi
                : this.resonance;
            this.computeCoefficients(this.currentCutoffHz, resonanceForCoeffs);
        }

        // Apply biquad filter (Direct Form II Transposed)
        for (let i = 0; i < blockSize; i++) {
            // Left channel
            const xL = inputL[i];
            const yL = this.b0 * xL + this.z1L;
            this.z1L = this.b1 * xL - this.a1 * yL + this.z2L;
            this.z2L = this.b2 * xL - this.a2 * yL;
            outputL[i] = yL;

            // Right channel
            const xR = inputR[i];
            const yR = this.b0 * xR + this.z1R;
            this.z1R = this.b1 * xR - this.a1 * yR + this.z2R;
            this.z2R = this.b2 * xR - this.a2 * yR;
            if (output[1]) outputR[i] = yR;
        }

        return true;
    }
}

registerProcessor('pcf-processor', PcfProcessor);
