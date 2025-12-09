/**
 * SustainProcessor - AudioWorklet for sample playback with arpeggiator
 * Features:
 * - Linear interpolation for smooth pitch shifting
 * - Loop and Stretch modes
 * - Built-in arpeggiator with sample-perfect timing
 */
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
        this.grainSize = 2000;

        // Message handler for receiving buffer and settings
        this.port.onmessage = (event) => {
            const { type, data } = event.data;

            switch (type) {
                case 'loadBuffer':
                    this.buffer = new Float32Array(data.buffer);
                    this.loopEnd = this.buffer.length;
                    this.loopStart = 0;
                    this.playhead = 0;
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
                    break;

                case 'noteOff':
                    this.isPlaying = false;
                    break;

                case 'setGrainSize':
                    this.grainSize = data.size || 2000;
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

    // Helper: Linear Interpolation for high-quality pitch/stretch
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
            // 1. Get Sample (Interpolated)
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
                // Loop Mode
                if (this.playhead >= this.loopEnd) {
                    this.playhead = this.loopStart;
                }
            } else {
                // Stretch Mode (Granular-ish sustain)
                const freezeLimit = this.loopStart + this.grainSize;
                if (this.playhead >= freezeLimit) {
                    // Randomize position within grain for natural texture
                    this.playhead = this.loopStart + (Math.random() * (this.grainSize / 2));
                }
            }
        }

        return true;
    }
}

registerProcessor('sustain-processor', SustainProcessor);
