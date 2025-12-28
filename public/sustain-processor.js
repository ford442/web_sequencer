/**
 * SustainProcessor - AudioWorklet for sample playback with arpeggiator
 * Features:
 * - Linear interpolation for smooth pitch shifting (prevents aliasing)
 * - Mode A (Loop): Standard pointer wrap-around with zero-crossing alignment
 * - Mode B (Stretch): Granular "freeze" with randomized grain positions
 * - Built-in arpeggiator with sample-perfect timing
 * - Garbage-collection free render loop
 */

// --- LCG (Linear Congruential Generator) Constants ---
// Standard parameters for GC-free pseudo-random number generation
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 0x7FFFFFFF;

class SustainProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = null;

        // Playback State
        this.playhead = 0;
        this.isPlaying = false;
        this.basePitch = 1.0; // The pitch of the sample

        // Arpeggiator State
        this.arpEnabled = false;
        this.arpCounter = 0;     // Counts samples
        this.arpStepIndex = 0;   // Which step of the pattern are we on?
        this.arpPattern = [0, 4, 7, 12]; // Default: Major Triad + Octave (semitones)

        // Parameters
        this.mode = 0;         // 0=LOOP, 1=STRETCH, 2=WAVETABLE
        this.loopStart = 0;
        this.loopEnd = 0;
        this.grainSize = 4410; // Default grain size (~100ms at 44.1kHz)
        this.grainOverlap = 0.5; // Overlap factor for smoother stretching

        // Wavetable
        this.baseFrequency = 220; // Base Hz before pitch offsets

        // Stretch mode state (for crossfade grains)
        this.grainPhase = 0;
        this.grainFadeLength = 441; // ~10ms fade for smooth transitions

        // Pre-computed zero-crossing positions (optional optimization)
        this.zeroCrossings = null;

        // Message handler for receiving buffer and settings
        this.port.onmessage = (event) => {
            const { type, data } = event.data;

            switch (type) {
                case 'loadBuffer':
                    this.buffer = new Float32Array(data.buffer);
                    this.loopEnd = this.buffer.length;
                    this.loopStart = 0;
                    this.playhead = 0;
                    // Pre-compute zero crossings for this buffer
                    this.zeroCrossings = this.findZeroCrossings(this.buffer);
                    // Accept optional mode in loadBuffer message
                    if (data.mode !== undefined) {
                        this.mode = data.mode;
                    }
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
                    // Accept mode in noteOn message (optional, falls back to current mode)
                    if (data.mode !== undefined) {
                        this.mode = data.mode;
                    }
                    break;

                case 'noteOff':
                    this.isPlaying = false;
                    break;

                case 'setGrainSize':
                    this.grainSize = data.size || 4410;
                    break;

                case 'setMode':
                    this.mode = data.mode || 0;
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
     * @param {Float32Array} buffer - Audio buffer
     * @returns {Int32Array} Array of zero-crossing indices
     */
    findZeroCrossings(buffer) {
        // Pre-allocate array (estimate ~sampleRate/100 crossings per second for typical audio)
        const crossings = [];
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
     * @param {number} position - Target position
     * @returns {number} Nearest zero-crossing index
     */
    findNearestZeroCrossing(position) {
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
     * @param {number} position - Fractional sample position
     * @returns {number} Interpolated sample value
     */
    getInterpolatedSample(position) {
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
     * @returns {number} Random offset within grain
     */
    getStretchJumpPosition() {
        // LCG for deterministic randomness without GC
        this.grainPhase = (this.grainPhase * LCG_MULTIPLIER + LCG_INCREMENT) & LCG_MODULUS;
        const randomFactor = (this.grainPhase / LCG_MODULUS);

        // Jump to a position within the grain window
        const windowSize = this.grainSize * this.grainOverlap;
        return this.loopStart + (randomFactor * windowSize);
    }

    process(inputs, outputs, parameters) {
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

        for (let i = 0; i < blockSize; i++) {
            const arpOn = (arpConstant ? arpParam[0] : arpParam[i]) > 0.5;
            const mode = modeConstant ? modeParam[0] : modeParam[i];
            const currentPitch = pitchConstant ? pitchParam[0] : pitchParam[i];
            const currentFreq = freqConstant ? freqParam[0] : freqParam[i];
            const currentBpm = bpmConstant ? bpmParam[0] : bpmParam[i];

            // --- ARPEGGIATOR LOGIC ---
            if (arpOn && this.buffer) {
                const samplesPerStep = (sampleRate * 60) / (currentBpm * 4);
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
                const increment = (targetFreq * bufferLength) / sampleRate;
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
