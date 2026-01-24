
interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: any): AudioWorkletProcessor;
};

declare function registerProcessor(name: string, processorCtor: (new (options?: any) => AudioWorkletProcessor)): void;

declare const globalThis: {
  sampleRate: number;
};

// --- LCG (Linear Congruential Generator) Constants ---
// Standard parameters for GC-free pseudo-random number generation
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 0x7FFFFFFF;

class SustainProcessor extends AudioWorkletProcessor {
    private buffer: Float32Array | null = null;

    // Playback State
    private playhead = 0;
    private isPlaying = false;
    private basePitch = 1.0; // The pitch of the sample

    // Arpeggiator State
    private arpCounter = 0;     // Counts samples
    private arpStepIndex = 0;   // Which step of the pattern are we on?
    private arpPattern: number[] = [0, 4, 7, 12]; // Default: Major Triad + Octave (semitones)

    // Parameters
    private loopStart = 0;
    private loopEnd = 0;
    private grainSize = 4410; // Default grain size (~100ms at 44.1kHz)
    private grainOverlap = 0.5; // Overlap factor for smoother stretching

    // Wavetable
    private baseFrequency = 220; // Base Hz before pitch offsets

    // Stretch mode state (for crossfade grains)
    private grainPhase = 0;

    // Pre-computed zero-crossing positions (optional optimization)
    private zeroCrossings: Int32Array | null = null;

    constructor() {
        super();

        // Message handler for receiving buffer and settings
        this.port.onmessage = (event: MessageEvent) => {
            const { type, data } = event.data;

            switch (type) {
                case 'loadBuffer':
                    this.buffer = new Float32Array(data.buffer);
                    this.loopEnd = this.buffer.length;
                    this.loopStart = 0;
                    this.playhead = 0;
                    // Pre-compute zero crossings for this buffer
                    this.zeroCrossings = this.findZeroCrossings(this.buffer);
                    break;

                case 'setLoopPoints':
                    this.loopStart = data.start || 0;
                    this.loopEnd = data.end || (this.buffer ? this.buffer.length : 0);
                    break;

                case 'setArpPattern':
                    this.arpPattern = data.pattern || [0, 4, 7, 12];
                    this.arpStepIndex = 0;
                    break;

                case 'noteOn':
                    this.isPlaying = true;
                    this.playhead = this.loopStart;
                    this.basePitch = data.pitch || 1.0;
                    this.grainPhase = 0;
                    break;

                case 'noteOff':
                    this.isPlaying = false;
                    break;

                case 'setGrainSize':
                    this.grainSize = data.size || 4410;
                    break;
            }
        };
    }

    static get parameterDescriptors() {
        return [
            { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 2 }, // 0=LOOP, 1=STRETCH, 2=WAVETABLE
            { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 300 },
            { name: 'arp', defaultValue: 0, minValue: 0, maxValue: 1 }, // 0 = Off, 1 = On
            { name: 'pitch', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0 },
            { name: 'frequency', defaultValue: 220, minValue: 20, maxValue: 20000 }
        ];
    }

    /**
     * Find zero-crossing positions in the buffer for clean loop points.
     * Uses a simple positive-going zero-crossing detection.
     */
    private findZeroCrossings(buffer: Float32Array): Int32Array {
        // Pre-allocate array (estimate ~sampleRate/100 crossings per second for typical audio)
        const crossings: number[] = [];
        for (let i = 1; i < buffer.length; i++) {
            if (buffer[i] >= 0 && buffer[i - 1] < 0) {
                crossings.push(i);
            }
        }
        return new Int32Array(crossings);
    }

    /**
     * Find the nearest zero-crossing to a given position.
     * Uses binary search for efficiency.
     */
    private findNearestZeroCrossing(position: number): number {
        if (!this.zeroCrossings || this.zeroCrossings.length === 0) {
            return Math.floor(position);
        }

        // Binary search for nearest zero crossing
        let low = 0;
        let high = this.zeroCrossings.length - 1;

        while (low < high) {
            const mid = (low + high) >>> 1;
            if (this.zeroCrossings[mid] < position) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        // Check which of the two closest is nearer
        if (low > 0) {
            const prev = this.zeroCrossings[low - 1];
            const curr = this.zeroCrossings[low];
            if (Math.abs(position - prev) < Math.abs(position - curr)) {
                return prev;
            }
        }

        return this.zeroCrossings[low] || Math.floor(position);
    }

    /**
     * Linear Interpolation for high-quality pitch/stretch.
     * Prevents aliasing at non-integer playback rates.
     */
    private getInterpolatedSample(position: number): number {
        if (!this.buffer || this.buffer.length === 0) return 0;

        const indexA = Math.floor(position);
        const indexB = indexA + 1;
        const fraction = position - indexA;

        // Safety check
        if (indexA < 0 || indexA >= this.buffer.length) return 0;

        const valA = this.buffer[indexA];
        const valB = (indexB < this.buffer.length) ? this.buffer[indexB] : 0;

        return valA + (valB - valA) * fraction;
    }

    /**
     * Generate a random position within the grain window for stretch mode.
     * Uses a simple LCG for GC-free random numbers.
     */
    private getStretchJumpPosition(): number {
        // LCG for deterministic randomness without GC
        this.grainPhase = (this.grainPhase * LCG_MULTIPLIER + LCG_INCREMENT) & LCG_MODULUS;
        const randomFactor = (this.grainPhase / LCG_MODULUS);

        // Jump to a position within the grain window
        const windowSize = this.grainSize * this.grainOverlap;
        return this.loopStart + (randomFactor * windowSize);
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const bpmParam = parameters['bpm'];
        const arpParam = parameters['arp'];
        const modeParam = parameters['mode'];
        const pitchParam = parameters['pitch'];
        const freqParam = parameters['frequency'];

        const arpConstant = arpParam.length === 1;
        const modeConstant = modeParam.length === 1;
        const pitchConstant = pitchParam.length === 1;
        const freqConstant = freqParam.length === 1;
        const bpmConstant = bpmParam.length === 1;

        const blockSize = output[0].length;
        // Use global sampleRate or fallback
        const currentSampleRate = globalThis.sampleRate || 44100;

        for (let i = 0; i < blockSize; i++) {
            const arpOn = (arpConstant ? arpParam[0] : arpParam[i]) > 0.5;
            const mode = modeConstant ? modeParam[0] : modeParam[i];
            const currentPitch = pitchConstant ? pitchParam[0] : pitchParam[i];
            const currentFreq = freqConstant ? freqParam[0] : freqParam[i];
            const currentBpm = bpmConstant ? bpmParam[0] : bpmParam[i];

            // --- ARPEGGIATOR LOGIC ---
            if (arpOn && this.buffer) {
                const samplesPerStep = (currentSampleRate * 60) / (currentBpm * 4);
                this.arpCounter++;

                if (this.arpCounter >= samplesPerStep) {
                    this.arpCounter = 0;
                    const semiTone = this.arpPattern[this.arpStepIndex % this.arpPattern.length];
                    this.basePitch = Math.pow(2, semiTone / 12.0);
                    this.playhead = this.loopStart;
                    this.isPlaying = true;
                    this.arpStepIndex++;
                }
            }

            if (!this.buffer || !this.isPlaying) {
                for (let channel = 0; channel < output.length; channel++) {
                    output[channel][i] = 0;
                }
                continue;
            }

            let sampleValue = 0;

            if (mode < 0.5) {
                // --- MODE A: LOOP ---
                sampleValue = this.getInterpolatedSample(this.playhead);
                const speed = arpOn ? this.basePitch : (currentPitch || 1.0);
                this.playhead += speed;

                if (this.playhead >= this.loopEnd) {
                    const alignedStart = this.findNearestZeroCrossing(this.loopStart);
                    this.playhead = alignedStart;
                }
            } else if (mode < 1.5) {
                // --- MODE B: STRETCH (Granular Freeze) ---
                sampleValue = this.getInterpolatedSample(this.playhead);
                const speed = arpOn ? this.basePitch : (currentPitch || 1.0);
                this.playhead += speed;

                const freezeLimit = this.loopStart + this.grainSize;
                if (this.playhead >= freezeLimit) {
                    this.playhead = this.getStretchJumpPosition();
                }
            } else {
                // --- MODE C: WAVETABLE (single-cycle oscillator) ---
                const bufferLength = this.buffer.length;
                const phase = this.playhead % bufferLength;
                sampleValue = this.getInterpolatedSample(phase);

                const pitchRatio = arpOn ? this.basePitch : (currentPitch || 1.0);
                const targetFreq = (currentFreq || this.baseFrequency) * pitchRatio;
                const increment = (targetFreq * bufferLength) / currentSampleRate;
                this.playhead += increment;

                if (this.playhead >= bufferLength) {
                    // Maintain precision by wrapping instead of letting it grow
                    this.playhead = this.playhead % bufferLength;
                }
            }

            for (let channel = 0; channel < output.length; channel++) {
                output[channel][i] = sampleValue;
            }
        }

        return true;
    }
}

registerProcessor('sustain-processor', SustainProcessor);
