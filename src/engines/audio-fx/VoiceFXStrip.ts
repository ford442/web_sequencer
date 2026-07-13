export class VoiceFXStrip {
    private context: AudioContext;
    public input: GainNode;
    public output: GainNode;

    // Filter
    private filter: BiquadFilterNode;

    // Spectral Panning
    private lowBand: BiquadFilterNode;
    private midBand: BiquadFilterNode;
    private highBand: BiquadFilterNode;
    private lowPanner: StereoPannerNode;
    private midPanner: StereoPannerNode;
    private highPanner: StereoPannerNode;
    private lowGain: GainNode;
    private midGain: GainNode;
    private highGain: GainNode;
    private lowLfo: OscillatorNode;
    private midLfo: OscillatorNode;
    private highLfo: OscillatorNode;
    private dryGain: GainNode;
    private wetGain: GainNode;

    // Reverb Send
    private reverbGain: GainNode;
    private reverbEq: BiquadFilterNode;
    private reverbLfo: OscillatorNode;
    private reverbLfoDepthGain: GainNode;

    // Delay Send
    private delayGain: GainNode;

    constructor(context: AudioContext) {
        this.context = context;
        this.input = context.createGain();
        this.output = context.createGain();

        // 1. Filter
        this.filter = context.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 20000;
        this.filter.Q.value = 0;

        // 2. Spectral Panning
        this.lowBand = context.createBiquadFilter();
        this.lowBand.type = 'lowpass';
        this.lowBand.frequency.value = 400;

        this.midBand = context.createBiquadFilter();
        this.midBand.type = 'bandpass';
        this.midBand.frequency.value = 1500;
        this.midBand.Q.value = 1;

        this.highBand = context.createBiquadFilter();
        this.highBand.type = 'highpass';
        this.highBand.frequency.value = 4000;

        this.lowPanner = context.createStereoPanner();
        this.midPanner = context.createStereoPanner();
        this.highPanner = context.createStereoPanner();

        this.lowGain = context.createGain();
        this.midGain = context.createGain();
        this.highGain = context.createGain();

        this.lowLfo = context.createOscillator();
        this.lowLfo.type = 'sine';
        this.midLfo = context.createOscillator();
        this.midLfo.type = 'sine';
        this.highLfo = context.createOscillator();
        this.highLfo.type = 'sine';

        this.dryGain = context.createGain();
        this.wetGain = context.createGain();

        // Start LFOs immediately
        this.lowLfo.start();
        this.midLfo.start();
        this.highLfo.start();

        // Connect Spectral Panning LFOs
        this.lowLfo.connect(this.lowGain);
        this.lowGain.connect(this.lowPanner.pan);

        this.midLfo.connect(this.midGain);
        this.midGain.connect(this.midPanner.pan);

        this.highLfo.connect(this.highGain);
        this.highGain.connect(this.highPanner.pan);

        // Routing Spectral Panning
        this.filter.connect(this.dryGain);
        this.filter.connect(this.wetGain);

        this.wetGain.connect(this.lowBand);
        this.wetGain.connect(this.midBand);
        this.wetGain.connect(this.highBand);

        this.lowBand.connect(this.lowPanner);
        this.midBand.connect(this.midPanner);
        this.highBand.connect(this.highPanner);

        this.lowPanner.connect(this.output);
        this.midPanner.connect(this.output);
        this.highPanner.connect(this.output);
        this.dryGain.connect(this.output);

        // 3. Reverb Send
        this.reverbGain = context.createGain();
        this.reverbGain.gain.value = 0;
        this.reverbEq = context.createBiquadFilter();
        this.reverbEq.type = 'lowpass';
        this.reverbEq.frequency.value = 6000;
        this.reverbEq.Q.value = 0.5;

        this.reverbLfo = context.createOscillator();
        this.reverbLfo.type = 'sine';
        this.reverbLfoDepthGain = context.createGain();
        this.reverbLfoDepthGain.gain.value = 0;

        this.reverbLfo.start();
        this.reverbLfo.connect(this.reverbLfoDepthGain);
        this.reverbLfoDepthGain.connect(this.reverbGain.gain);

        this.output.connect(this.reverbGain);
        this.reverbGain.connect(this.reverbEq);

        // 4. Delay Send
        this.delayGain = context.createGain();
        this.delayGain.gain.value = 0;
        this.output.connect(this.delayGain);

        // Initial connection
        this.input.connect(this.filter);
    }

    updateFilter(cutoff: number, resonance: number, time: number) {
        this.filter.frequency.setValueAtTime(cutoff, time);
        this.filter.Q.setValueAtTime(resonance, time);
    }

    updateSpectralPanning(depth: number, rateHz: number, time: number) {
        this.dryGain.gain.setValueAtTime(1.0 - depth, time);
        this.wetGain.gain.setValueAtTime(depth, time);

        if (depth > 0) {
            this.lowGain.gain.setValueAtTime(depth, time);
            this.midGain.gain.setValueAtTime(depth * 0.8, time);
            this.highGain.gain.setValueAtTime(depth * 1.2, time);

            this.lowLfo.frequency.setValueAtTime(rateHz * 0.5, time);
            this.midLfo.frequency.setValueAtTime(rateHz * 0.75, time);
            this.highLfo.frequency.setValueAtTime(rateHz, time);
        } else {
             this.lowGain.gain.setValueAtTime(0, time);
             this.midGain.gain.setValueAtTime(0, time);
             this.highGain.gain.setValueAtTime(0, time);
        }
    }

    updateReverbSend(sendAmount: number, lfoRate: number, lfoDepth: number, eqCutoff: number, time: number) {
        this.reverbEq.frequency.setValueAtTime(eqCutoff, time);

        if (lfoDepth > 0 && lfoRate > 0) {
            const minGain = Math.max(0, sendAmount * (1 - lfoDepth));
            const maxGain = sendAmount;
            const midGain = (maxGain + minGain) / 2;
            const amplitude = (maxGain - minGain) / 2;

            this.reverbGain.gain.setValueAtTime(midGain, time);
            this.reverbLfo.frequency.setValueAtTime(lfoRate, time);
            this.reverbLfoDepthGain.gain.setValueAtTime(amplitude, time);
        } else {
            this.reverbGain.gain.setValueAtTime(sendAmount, time);
            this.reverbLfoDepthGain.gain.setValueAtTime(0, time);
        }
    }

    connectReverb(destination: AudioNode | null) {
        this.reverbEq.disconnect();
        if (destination) {
            this.reverbEq.connect(destination);
        }
    }

    updateDelaySend(sendAmount: number, time: number) {
        this.delayGain.gain.setValueAtTime(sendAmount, time);
    }

    connectDelay(destination: AudioNode | null) {
        this.delayGain.disconnect();
        if (destination) {
            this.delayGain.connect(destination);
        }
    }

    disconnect() {
        this.input.disconnect();
        this.output.disconnect();
        this.reverbEq.disconnect();
        this.delayGain.disconnect();
    }
}
