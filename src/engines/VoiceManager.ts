import { type SynthParams } from '../types';
import { noteToFrequency } from '../constants';

export class Voice {
    context: AudioContext;
    destination: AudioNode;

    // Graph
    private source: OscillatorNode | AudioBufferSourceNode | null = null;
    private filter: BiquadFilterNode;
    private gain: GainNode;
    private dryGain: GainNode;
    private wetGain: GainNode;
    private delay: DelayNode;
    private delayGain: GainNode;
    private panner: StereoPannerNode;

    // State
    isActive: boolean = false;
    currentNote: string = '';
    currentSourceType: string = '';

    // Buffers for wav-based waveforms
    private wavSawBuffer?: AudioBuffer;
    private wavSqrBuffer?: AudioBuffer;

    private cleanupTimer: any = null;

    private globalDelayNode?: DelayNode;
    private globalDelaySendGain?: GainNode;

    constructor(context: AudioContext, destination: AudioNode, wavSaw?: AudioBuffer, wavSqr?: AudioBuffer, globalDelayNode?: DelayNode) {
        this.context = context;
        this.destination = destination;
        this.wavSawBuffer = wavSaw;
        this.wavSqrBuffer = wavSqr;
        this.globalDelayNode = globalDelayNode;

        // Create permanent nodes
        this.filter = context.createBiquadFilter();
        this.gain = context.createGain();
        this.dryGain = context.createGain();
        this.wetGain = context.createGain();
        this.delay = context.createDelay();
        this.delayGain = context.createGain();

        this.panner = context.createStereoPanner();

        // Connect permanent graph
        // Source -> Filter (connected in play)
        this.filter.connect(this.gain);
        this.gain.connect(this.dryGain);
        this.gain.connect(this.delay);

        this.delay.connect(this.delayGain);
        this.delayGain.connect(this.delay);
        this.delay.connect(this.wetGain);

        this.dryGain.connect(this.panner);
        this.wetGain.connect(this.panner);
        this.panner.connect(destination);

        if (this.globalDelayNode) {
            this.globalDelaySendGain = context.createGain();
            this.globalDelaySendGain.gain.value = 0;
            this.gain.connect(this.globalDelaySendGain);
            this.globalDelaySendGain.connect(this.globalDelayNode);
        }

        // Initial silence
        this.gain.gain.value = 0;
    }

    // New method for starting a note (Attack + Sustain) without scheduling release
    startNote(params: SynthParams, note: string, time: number, slideFromFreq?: number) {
        if (params.pan !== undefined) {
            this.panner.pan.setValueAtTime(params.pan, time);
        }
        // Clear cleanup
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        const now = time;
        const freq = noteToFrequency(note);
        const waveform = params.waveform;
        const isWav = waveform.startsWith('wav-');

        const canReuse = this.source && this.isActive && slideFromFreq !== undefined && this.currentSourceType === waveform;

        if (canReuse && this.source) {
            // LEGATO UPDATE
            if (this.source instanceof OscillatorNode) {
                this.source.frequency.cancelScheduledValues(now);
                this.source.frequency.setValueAtTime(slideFromFreq!, now);
                this.source.frequency.exponentialRampToValueAtTime(freq, now + 0.1);
            } else if (this.source instanceof AudioBufferSourceNode) {
                const baseFreq = 261.63;
                const startRate = slideFromFreq! / baseFreq;
                const endRate = freq / baseFreq;
                this.source.playbackRate.cancelScheduledValues(now);
                this.source.playbackRate.setValueAtTime(startRate, now);
                this.source.playbackRate.exponentialRampToValueAtTime(endRate, now + 0.1);
            }

            // Sustain
            this.gain.gain.cancelScheduledValues(now);
            this.gain.gain.linearRampToValueAtTime(Math.max(0.001, params.volume * params.sustain), now + 0.05);

        } else {
            // FULL TRIGGER
            this.stop(now);

            if (isWav) {
                const src = this.context.createBufferSource();
                src.buffer = (waveform === 'wav-sqr' ? this.wavSqrBuffer : this.wavSawBuffer) ?? null;
                src.loop = true;
                const baseFreq = 261.63;
                src.playbackRate.value = freq / baseFreq;
                this.source = src;
            } else {
                const osc = this.context.createOscillator();
                // @ts-ignore
                osc.type = ['sawtooth', 'square', 'triangle', 'sine'].includes(waveform) ? waveform : 'sawtooth';
                osc.frequency.value = freq;
                this.source = osc;
            }
            this.currentSourceType = waveform;
            this.source.connect(this.filter);
            this.source.start(now);

            this.filter.type = 'lowpass';
            this.filter.frequency.setValueAtTime(params.filterCutoff, now);
            this.filter.Q.value = params.filterResonance;

            const attackEnd = now + params.attack;
            const decayEnd = attackEnd + params.decay;

            this.gain.gain.cancelScheduledValues(now);
            this.gain.gain.setValueAtTime(0, now);
            this.gain.gain.linearRampToValueAtTime(params.volume, attackEnd);
            this.gain.gain.exponentialRampToValueAtTime(Math.max(0.001, params.volume * params.sustain), decayEnd);
        }

        this.delay.delayTime.value = params.delayTime;
        this.delayGain.gain.value = params.delayFeedback;
        this.wetGain.gain.value = params.delayMix;
        this.dryGain.gain.value = 1 - params.delayMix;

        this.isActive = true;
        this.currentNote = note;
    }

    setDelaySend(amount: number, time?: number) {
        if (this.globalDelaySendGain) {
            const t = time || this.context.currentTime;
            this.globalDelaySendGain.gain.setValueAtTime(amount, t);
        }
    }

    stopNote(time: number, params: SynthParams) {
        if (!this.isActive) return;
        this.scheduleRelease(params, time);
    }

    play(params: SynthParams, note: string, time: number, duration: number, slideFromFreq?: number) {
        this.startNote(params, note, time, slideFromFreq);
        this.stopNote(time + duration, params);
    }

    private scheduleRelease(params: SynthParams, releaseStart: number) {
        const releaseEnd = releaseStart + params.release;

        this.gain.gain.cancelScheduledValues(releaseStart);
        // Explicitly set value to sustain level to ensure ramp starts correctly
        // We use Math.max(0.001, ...) because exponentialRampToValueAtTime cannot start from 0
        const sustainLevel = Math.max(0.001, params.volume * params.sustain);
        this.gain.gain.setValueAtTime(sustainLevel, releaseStart);
        this.gain.gain.exponentialRampToValueAtTime(0.001, releaseEnd);

        if (this.source) {
            try {
                this.source.stop(releaseEnd + 0.1);
            } catch (e) { }
        }

        this.cleanupTimer = setTimeout(() => {
            this.isActive = false;
            this.cleanupTimer = null;
        }, (releaseEnd - this.context.currentTime + 0.2) * 1000);
    }

    stop(time: number) {
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        if (this.source) {
            try {
                this.source.stop(time);
                this.source.disconnect();
            } catch (e) { }
            this.source = null;
        }
        this.isActive = false;
    }
}

export class VoiceManager {
    private voices: Voice[] = [];
    private maxVoices: number;
    private context: AudioContext;
    private destination: AudioNode;
    private isMonophonic: boolean;
    private globalDelayNode?: DelayNode;

    // Buffers
    private wavSaw?: AudioBuffer;
    private wavSqr?: AudioBuffer;

    public delayNode?: DelayNode;
    public delayFeedback?: GainNode;

    constructor(context: AudioContext, destination: AudioNode, maxVoices: number, isMonophonic: boolean, wavSaw?: AudioBuffer, wavSqr?: AudioBuffer, delayNode?: DelayNode, delayFeedback?: GainNode, globalDelayNode?: DelayNode) {
        this.context = context;
        this.destination = destination;
        this.maxVoices = maxVoices;
        this.isMonophonic = isMonophonic;
        this.wavSaw = wavSaw;
        this.wavSqr = wavSqr;
        this.delayNode = delayNode;
        this.delayFeedback = delayFeedback;
        this.globalDelayNode = globalDelayNode;
    }

    private getVoice(_note: string): Voice {
        // Find free
        const free = this.voices.find(v => !v.isActive);
        if (free) return free;

        // Create new if below limit
        if (this.voices.length < this.maxVoices) {
            const v = new Voice(this.context, this.destination, this.wavSaw, this.wavSqr, this.globalDelayNode);
            this.voices.push(v);
            return v;
        }

        // Steal (Simple FIFO for now)
        return this.voices[0];
    }

    playNote(params: SynthParams, notes: string | string[], time: number, duration: number, slideFromFreq?: number): Voice | null {
        const noteArray = Array.isArray(notes) ? notes : [notes];

        if (this.isMonophonic) {
            // Mono: Always use voice 0
            const note = noteArray[0];
            if (!note) return null;

            let voice = this.voices[0];
            if (!voice) {
                voice = new Voice(this.context, this.destination, this.wavSaw, this.wavSqr, this.globalDelayNode);
                this.voices.push(voice);
            }
            voice.play(params, note, time, duration, slideFromFreq);
            return voice;
        } else {
            // Poly: Trigger voice for each note
            let lastVoice: Voice | null = null;
            noteArray.forEach((note, idx) => {
                const slide = idx === 0 ? slideFromFreq : undefined;
                const voice = this.getVoice(note);
                voice.play(params, note, time, duration, slide);
                lastVoice = voice;

                // Rotate used voice to end of list (LRU approximation)
                const vIdx = this.voices.indexOf(voice);
                if (vIdx > -1) {
                    this.voices.splice(vIdx, 1);
                    this.voices.push(voice);
                }
            });
            return lastVoice;
        }
    }

    noteOn(params: SynthParams, note: string, time: number): Voice | null {
        if (this.isMonophonic) {
            let voice = this.voices[0];
            if (!voice) {
                voice = new Voice(this.context, this.destination, this.wavSaw, this.wavSqr, this.globalDelayNode);
                this.voices.push(voice);
            }
            voice.startNote(params, note, time);
            return voice;
        } else {
            const voice = this.getVoice(note);
            voice.startNote(params, note, time);

            const vIdx = this.voices.indexOf(voice);
            if (vIdx > -1) {
                this.voices.splice(vIdx, 1);
                this.voices.push(voice);
            }
            return voice;
        }
    }

    noteOff(note: string, time: number, params: SynthParams) {
        if (this.isMonophonic) {
            const voice = this.voices[0];
            if (voice && voice.isActive && voice.currentNote === note) {
                voice.stopNote(time, params);
            }
        } else {
            // Find active voice for note
            const voice = this.voices.find(v => v.currentNote === note && v.isActive);
            if (voice) {
                voice.stopNote(time, params);
            }
        }
    }

    stopAll() {
        this.voices.forEach(v => v.stop(this.context.currentTime));
    }
}
