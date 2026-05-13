import { type SynthParams } from '../types';
import { tunedNoteToFrequency } from '../constants';
import type { ScaleDefinition } from '../utils/musicTheory';

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

    constructor(
        context: AudioContext,
        destination: AudioNode,
        wavSaw?: AudioBuffer,
        wavSqr?: AudioBuffer,
        globalDelayNode?: DelayNode
    ) {
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
        this.filter.connect(this.gain);
        this.gain.connect(this.dryGain);
        this.gain.connect(this.delay);
        this.delay.connect(this.delayGain);
        this.delayGain.connect(this.delay); // feedback
        this.delay.connect(this.wetGain);
        this.dryGain.connect(this.panner);
        this.wetGain.connect(this.panner);
        this.panner.connect(destination);

        // Optional global delay send
        if (this.globalDelayNode) {
            this.globalDelaySendGain = context.createGain();
            this.globalDelaySendGain.gain.value = 0;
            this.gain.connect(this.globalDelaySendGain);
            this.globalDelaySendGain.connect(this.globalDelayNode);
        }

        this.gain.gain.value = 0; // start silent
    }

    /**
     * Start a note (attack + sustain) — supports legato sliding
     */
    startNote(
        params: SynthParams,
        note: string,
        time: number,
        slideFromFreq?: number,
        tuning: ScaleDefinition | null = null
    ): void {
        if (params.pan !== undefined) {
            this.panner.pan.setValueAtTime(params.pan, time);
        }

        // Clear any pending cleanup
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        const now = time;
        const freq = tunedNoteToFrequency(note, tuning);

        const waveform = params.waveform;
        const isWav = waveform.startsWith('wav-');
        const canReuse = this.source &&
                        this.isActive &&
                        slideFromFreq !== undefined &&
                        this.currentSourceType === waveform;

        if (canReuse && this.source) {
            // === LEGATO / SLIDE ===
            if (this.source instanceof OscillatorNode) {
                this.source.frequency.cancelScheduledValues(now);
                this.source.frequency.setValueAtTime(slideFromFreq!, now);
                this.source.frequency.exponentialRampToValueAtTime(freq, now + 0.1);
            } else if (this.source instanceof AudioBufferSourceNode) {
                const baseFreq = 261.63; // C4
                const startRate = slideFromFreq! / baseFreq;
                const endRate = freq / baseFreq;
                this.source.playbackRate.cancelScheduledValues(now);
                this.source.playbackRate.setValueAtTime(startRate, now);
                this.source.playbackRate.exponentialRampToValueAtTime(endRate, now + 0.1);
            }

            // Sustain level
            this.gain.gain.cancelScheduledValues(now);
            this.gain.gain.linearRampToValueAtTime(
                Math.max(0.001, params.volume * params.sustain),
                now + 0.05
            );
        } else {
            // === FULL NEW NOTE ===
            this.stop(now);

            if (isWav) {
                const src = this.context.createBufferSource();
                src.buffer = (waveform === 'wav-sqr' ? this.wavSqrBuffer : this.wavSawBuffer) ?? null;
                src.loop = true;
                src.playbackRate.value = freq / 261.63; // C4 base
                this.source = src;
            } else {
                const osc = this.context.createOscillator();
                osc.type = (['sawtooth', 'square', 'triangle', 'sine'] as const).includes(
                    waveform as any
                ) ? (waveform as OscillatorType) : 'sawtooth';
                osc.frequency.value = freq;
                this.source = osc;
            }

            this.currentSourceType = waveform;
            this.source.connect(this.filter);
            this.source.start(now);

            // Filter settings
            this.filter.type = 'lowpass';
            this.filter.frequency.setValueAtTime(params.filterCutoff, now);
            this.filter.Q.value = params.filterResonance;

            // ADSR Attack + Decay
            const attackEnd = now + params.attack;
            const decayEnd = attackEnd + params.decay;

            this.gain.gain.cancelScheduledValues(now);
            this.gain.gain.setValueAtTime(0, now);
            this.gain.gain.linearRampToValueAtTime(params.volume, attackEnd);
            this.gain.gain.exponentialRampToValueAtTime(
                Math.max(0.001, params.volume * params.sustain),
                decayEnd
            );
        }

        // Delay settings
        this.delay.delayTime.value = params.delayTime;
        this.delayGain.gain.value = params.delayFeedback;
        this.wetGain.gain.value = params.delayMix;
        this.dryGain.gain.value = 1 - params.delayMix;

        this.isActive = true;
        this.currentNote = note;
    }

    setDelaySend(amount: number, time?: number): void {
        if (this.globalDelaySendGain) {
            this.globalDelaySendGain.gain.setValueAtTime(
                amount,
                time ?? this.context.currentTime
            );
        }
    }

    stopNote(time: number, params: SynthParams): void {
        if (!this.isActive) return;
        this.scheduleRelease(params, time);
    }

    play(
        params: SynthParams,
        note: string,
        time: number,
        duration: number,
        slideFromFreq?: number,
        tuning: ScaleDefinition | null = null
    ): void {
        this.startNote(params, note, time, slideFromFreq, tuning);
        this.stopNote(time + duration, params);
    }

    private scheduleRelease(params: SynthParams, releaseStart: number): void {
        const releaseEnd = releaseStart + params.release;
        const sustainLevel = Math.max(0.001, params.volume * params.sustain);

        this.gain.gain.cancelScheduledValues(releaseStart);
        this.gain.gain.setValueAtTime(sustainLevel, releaseStart);
        this.gain.gain.exponentialRampToValueAtTime(0.001, releaseEnd);

        if (this.source) {
            try {
                this.source.stop(releaseEnd + 0.1);
            } catch {}
        }

        this.cleanupTimer = setTimeout(() => {
            this.isActive = false;
            this.cleanupTimer = null;
        }, (releaseEnd - this.context.currentTime + 0.2) * 1000);
    }

    stop(time: number): void {
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        if (this.source) {
            try {
                this.source.stop(time);
                this.source.disconnect();
            } catch {}
            this.source = null;
        }
        this.isActive = false;
    }
}

export class VoiceManager {
    private voices: Voice[];
    private currentIndex: number = 0;
    private monophonic: boolean;

    constructor(
        context: AudioContext,
        destination: AudioNode,
        polyphony: number,
        monophonic: boolean,
        wavSaw?: AudioBuffer,
        wavSqr?: AudioBuffer,
        globalDelayNode?: DelayNode
    ) {
        this.monophonic = monophonic;
        this.voices = Array.from({ length: Math.max(1, polyphony) }, () =>
            new Voice(context, destination, wavSaw, wavSqr, globalDelayNode)
        );
    }

    playNote(
        params: SynthParams,
        note: string | string[],
        time: number,
        duration: number,
        slideFromFreq?: number
    ): Voice {
        const noteStr = Array.isArray(note) ? note[0] ?? 'C4' : note;

        if (this.monophonic) {
            const voice = this.voices[0]!;
            voice.play(params, noteStr, time, duration, slideFromFreq);
            return voice;
        }

        const voice = this.voices[this.currentIndex]!;
        this.currentIndex = (this.currentIndex + 1) % this.voices.length;
        voice.play(params, noteStr, time, duration, slideFromFreq);
        return voice;
    }

    stopAll(time: number): void {
        this.voices.forEach(v => v.stop(time));
    }
}