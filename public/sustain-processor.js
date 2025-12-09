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
        this.mode = 0;         // 0=LOOP, 1=STRETCH
        this.loopStart = 0;
        this.loopEnd = 0;
        this.grainSize = 4410; // Default grain size (~100ms at 44.1kHz)
        this.grainOverlap = 0.5; // Overlap factor for smoother stretching

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

                case 'setMode':
                    this.mode = data.mode || 0;
                    break;
            }
        };
    }

    static get parameterDescriptors() {
        return [
            { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 1 }, // 0=LOOP, 1=STRETCH
            { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 300 },
            { name: 'arp', defaultValue: 0, minValue: 0, maxValue: 1 }, // 0 = Off, 1 = On
            { name: 'pitch', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0 }
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

        const bpm = parameters['bpm'].length > 1 ? parameters['bpm'] : parameters['bpm'][0];
        const arpOn = (parameters['arp'].length > 1 ? parameters['arp'][0] : parameters['arp'][0]) > 0.5;
        const mode = parameters['mode'].length > 1 ? parameters['mode'][0] : parameters['mode'][0];
        const pitchParam = parameters['pitch'].length > 1 ? parameters['pitch'][0] : parameters['pitch'][0];

        // --- ARPEGGIATOR LOGIC ---
        if (arpOn && this.buffer) {
            // Calculate samples per 16th note: (SampleRate * 60) / (BPM * 4)
            const currentBpm = typeof bpm === 'number' ? bpm : bpm[0];
            const samplesPerStep = (sampleRate * 60) / (currentBpm * 4);

            this.arpCounter++;

            if (this.arpCounter >= samplesPerStep) {
                // Trigger Next Step
                this.arpCounter = 0;
                const semiTone = this.arpPattern[this.arpStepIndex % this.arpPattern.length];

                // Convert Semitone to Playback Rate (Pitch)
                // rate = 2 ^ (semitones / 12)
                this.basePitch = Math.pow(2, semiTone / 12.0);

                // Reset playhead for the new note attack
                this.playhead = this.loopStart;
                this.isPlaying = true;
                this.arpStepIndex++;
            }
        }

        // --- AUDIO GENERATION ---
        if (!this.buffer || !this.isPlaying) {
            // Output silence
            for (let channel = 0; channel < output.length; channel++) {
                output[channel].fill(0);
            }
            return true;
        }

        const blockSize = output[0].length;

        for (let i = 0; i < blockSize; i++) {
            // 1. Get Sample (Interpolated for anti-aliasing)
            const sampleValue = this.getInterpolatedSample(this.playhead);

            // 2. Write to Output (Mono to Stereo)
            for (let channel = 0; channel < output.length; channel++) {
                output[channel][i] = sampleValue;
            }

            // 3. Advance Playhead
            // If Arp is on, we play at the pitch determined by the Arp logic.
            // Otherwise use the pitch parameter or base pitch
            const speed = arpOn ? this.basePitch : (pitchParam || 1.0);
            this.playhead += speed;

            // 4. Sustain / Loop Logic
            if (mode < 0.5) {
                // --- MODE A: LOOP ---
                // Standard pointer wrap-around with optional zero-crossing alignment
                if (this.playhead >= this.loopEnd) {
                    // Find nearest zero crossing for click-free looping
                    const alignedStart = this.findNearestZeroCrossing(this.loopStart);
                    this.playhead = alignedStart;
                }
            } else {
                // --- MODE B: STRETCH (Granular Freeze) ---
                // Jump playhead back to create infinite sustain texture
                const freezeLimit = this.loopStart + this.grainSize;
                if (this.playhead >= freezeLimit) {
                    // Use random position for natural texture without rhythmic repetition
                    this.playhead = this.getStretchJumpPosition();
                }
            }
        }

        return true;
    }
}

registerProcessor('sustain-processor', SustainProcessor);
