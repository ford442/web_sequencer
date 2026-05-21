import { type SynthParams } from '../types';
import { tunedNoteToFrequency } from '../constants';
import type { ScaleDefinition } from '../utils/musicTheory';
import { parseWaveform, shapeToOscillatorType, type WaveShape } from '../utils/waveformParser';
import type { WasmOscillator } from './WasmOscillator';

export interface VoiceEngineDeps {
    wasmEngine?: WasmOscillator | null;
    wgslBuffers?: Partial<Record<WaveShape, AudioBuffer | null>>;
}

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

    private engineDeps?: VoiceEngineDeps;

    constructor(
        context: AudioContext,
        destination: AudioNode,
        wavSaw?: AudioBuffer,
        wavSqr?: AudioBuffer,
        globalDelayNode?: DelayNode,
        engineDeps?: VoiceEngineDeps,
    ) {
        this.context = context;
        this.destination = destination;
        this.wavSawBuffer = wavSaw;
        this.wavSqrBuffer = wavSqr;
        this.globalDelayNode = globalDelayNode;
        this.engineDeps = engineDeps;

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
        const parsed = parseWaveform(waveform);
        const isWav = parsed.engine === 'wav';
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

            let createdSource: OscillatorNode | AudioBufferSourceNode | null = null;

            if (isWav) {
                const src = this.context.createBufferSource();
                src.buffer = (parsed.shape === 'sqr' ? this.wavSqrBuffer : this.wavSawBuffer) ?? null;
                src.loop = true;
                src.playbackRate.value = freq / 261.63; // C4 base
                createdSource = src;
            } else if (parsed.engine === 'wasm' && this.engineDeps?.wasmEngine?.isReady) {
                // Render a ~2s buffer at C4 reference frequency, then retune via playbackRate.
                const REF_FREQ = 261.63;
                const float = this.engineDeps.wasmEngine.generate(
                    REF_FREQ,
                    2.0,
                    this.context.sampleRate,
                    parsed.shape,
                    Math.max(20, Math.min(this.context.sampleRate / 2.1, params.filterCutoff)),
                    Math.max(0.1, params.filterResonance),
                );
                if (float && float.length > 0) {
                    const buf = this.context.createBuffer(1, float.length, this.context.sampleRate);
                    buf.getChannelData(0).set(float);
                    const src = this.context.createBufferSource();
                    src.buffer = buf;
                    src.loop = true;
                    src.playbackRate.value = freq / REF_FREQ;
                    createdSource = src;
                }
            } else if (parsed.engine === 'wgsl') {
                const buf = this.engineDeps?.wgslBuffers?.[parsed.shape];
                if (buf) {
                    const src = this.context.createBufferSource();
                    src.buffer = buf;
                    src.loop = true;
                    // wgsl buffers are pre-rendered at C4 reference
                    src.playbackRate.value = freq / 261.63;
                    createdSource = src;
                }
            }

            // Fallback: JS oscillator using the parsed base shape so the user at
            // least hears the right wave family for engines we haven't wired up
            // (pyodide, wam, rust) or that failed to initialise.
            if (!createdSource) {
                const osc = this.context.createOscillator();
                osc.type = shapeToOscillatorType(parsed.shape);
                osc.frequency.value = freq;
                createdSource = osc;
            }

            this.source = createdSource;

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
        globalDelayNode?: DelayNode,
        engineDeps?: VoiceEngineDeps,
    ) {
        this.monophonic = monophonic;
        this.voices = Array.from({ length: Math.max(1, polyphony) }, () =>
            new Voice(context, destination, wavSaw, wavSqr, globalDelayNode, engineDeps)
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

    noteOn(params: SynthParams, note: string, time: number, slideFromFreq?: number): Voice {
        const voice = this.voices[this.currentIndex]!;
        this.currentIndex = (this.currentIndex + 1) % this.voices.length;
        voice.startNote(params, note, time, slideFromFreq);
        return voice;
    }

    noteOff(note: string, time: number, params: SynthParams): void {
        for (const voice of this.voices) {
            if (voice.isActive && voice.currentNote === note) {
                voice.stopNote(time, params);
                break;
            }
        }
    }

    stopAll(time?: number): void {
        this.voices.forEach(v => v.stop(time ?? v.context.currentTime));
    }
}