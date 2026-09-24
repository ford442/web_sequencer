import { type SynthParams } from '../types';
import { tunedNoteToFrequency } from '../constants';
import type { ScaleDefinition } from '../utils/musicTheory';
import { parseWaveform, shapeToOscillatorType, type ParsedWaveform } from '../utils/waveformParser';
import { logEngineFallback, logWaveformSubstitution } from '../utils/engineTelemetry';
import { playbackHealthMonitor } from '../audio/playback/PlaybackHealthMonitor';
import { getOscillatorRegistry } from './backends/BackendRegistry';
import { engineEntry } from './backends/engineCatalog';
import { TABLE_DURATION_SEC, TABLE_REF_FREQ } from './backends/OscillatorBackend';
import { VoicePool, type PoolableVoice } from './base/VoicePool';
import { getPitchOffsetSemitones, transposeFrequency } from '../utils/pitchOffset';

export class Voice implements PoolableVoice {
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

    private cleanupTimer: any = null;
    private globalDelayNode?: DelayNode;
    private globalDelaySendGain?: GainNode;

    /**
     * Legacy waveform ids already reported this note-on onwards, so a saved
     * song full of retired `rust-*`/`cpp-*` notes reports the substitution once
     * rather than flooding the HUD on every note.
     */
    private static reportedLegacy = new Set<string>();

    /** Reference pitch of the table currently loaded in `source`, for slides. */
    private currentBaseFrequency = TABLE_REF_FREQ;

    constructor(
        context: AudioContext,
        destination: AudioNode,
        globalDelayNode?: DelayNode,
    ) {
        this.context = context;
        this.destination = destination;
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
        // Module TUNE knob (semitones) transposes the sounding pitch.
        const pitchSemis = getPitchOffsetSemitones(params);
        const freq = transposeFrequency(tunedNoteToFrequency(note, tuning), pitchSemis);
        // Slide source frequencies are computed from the untransposed note, so
        // shift them by the same amount to keep glides in tune.
        const slideFrom = slideFromFreq !== undefined
            ? transposeFrequency(slideFromFreq, pitchSemis)
            : undefined;

        const waveform = params.waveform;
        const parsed = parseWaveform(waveform);
        const canReuse = this.source &&
                        this.isActive &&
                        slideFromFreq !== undefined &&
                        this.currentSourceType === waveform;

        if (canReuse && this.source) {
            // === LEGATO / SLIDE ===
            if (this.source instanceof OscillatorNode) {
                this.source.frequency.cancelScheduledValues(now);
                this.source.frequency.setValueAtTime(slideFrom!, now);
                this.source.frequency.exponentialRampToValueAtTime(freq, now + 0.1);
            } else if (this.source instanceof AudioBufferSourceNode) {
                // The table's own reference pitch, reported by the backend that
                // rendered it — not a hardcoded C4 (Pyodide and the PCM/GPU
                // tables need not agree).
                const baseFreq = this.currentBaseFrequency;
                const startRate = slideFrom! / baseFreq;
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
            let baseFrequency = freq;

            // === ENGINE SELECTION ===
            // One story: the catalog names the backend that owns this waveform
            // family, and BackendRegistry walks the single documented fallback
            // order from there, publishing every step it takes. There are no
            // per-prefix `generate()` + looped-buffer branches here any more.
            const rendered = this.renderLoop(parsed, params);
            if (rendered) {
                const src = this.context.createBufferSource();
                src.buffer = rendered.buffer;
                src.loop = true;
                src.playbackRate.value = freq / rendered.baseFrequency;
                createdSource = src;
                baseFrequency = rendered.baseFrequency;
            }

            // Final fallback: JS oscillator using the correct wave family so the
            // user at least hears the right harmonic character while the engine is absent.
            if (!createdSource) {
                const osc = this.context.createOscillator();
                osc.type = shapeToOscillatorType(parsed.shape);
                osc.frequency.value = freq;
                createdSource = osc;
            }

            this.source = createdSource;
            this.currentBaseFrequency = baseFrequency;

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


    /**
     * Render the looped table for `parsed`, entering `BackendRegistry` at the
     * backend the engine catalog names for that family.
     *
     * Returns null when nothing in the chain could service the request — the
     * caller then builds an `OscillatorNode` of the right wave family, which is
     * the documented terminal step (`js`), not a silent substitution.
     */
    private renderLoop(
        parsed: ParsedWaveform,
        params: SynthParams,
    ): { buffer: AudioBuffer; baseFrequency: number } | null {
        if (parsed.legacyFrom && !Voice.reportedLegacy.has(parsed.legacyFrom)) {
            Voice.reportedLegacy.add(parsed.legacyFrom);
            logWaveformSubstitution(
                'oscillators',
                parsed.engine,
                parsed.shape,
                parsed.shape,
                `"${parsed.legacyFrom}" was retired; rendering on ${engineEntry(parsed.engine).label}`,
            );
        }

        const entry = engineEntry(parsed.engine);
        if (entry.kind === 'native-worklet') {
            // 303 / Prophecy voices live in hyphon_native worklets owned by
            // their managers; Voice is never the right renderer for them. Say
            // so rather than quietly producing an OscillatorNode.
            logEngineFallback(
                parsed.engine,
                'wasm-worklet',
                `${entry.label} voices are owned by ${entry.owner}, not VoiceManager`,
            );
            return null;
        }

        const registry = getOscillatorRegistry();
        if (!registry) {
            logEngineFallback(
                parsed.engine,
                entry.backendId,
                'no oscillator backend registry (audio engine not initialized)',
            );
            return null;
        }

        return registry.renderLoopFrom(entry.backendId, this.context, {
            frequency: TABLE_REF_FREQ,
            duration: TABLE_DURATION_SEC,
            sampleRate: this.context.sampleRate,
            shape: parsed.shape,
            cutoff: Math.max(20, Math.min(this.context.sampleRate / 2.1, params.filterCutoff)),
            resonance: Math.max(0.1, params.filterResonance),
        });
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

export class VoiceManager extends VoicePool<Voice> {
    private monophonic: boolean;

    constructor(
        context: AudioContext,
        destination: AudioNode,
        polyphony: number,
        monophonic: boolean,
        globalDelayNode?: DelayNode,
    ) {
        super(polyphony);
        this.monophonic = monophonic;
        this.voices = Array.from({ length: this.maxVoices }, () =>
            new Voice(context, destination, globalDelayNode)
        );
    }

    protected override onStolen(voice: Voice, index: number, time?: number): void {
        super.onStolen(voice, index, time);
        playbackHealthMonitor.recordVoiceSteal(this.monophonic ? 'voiceManager-monophonic' : 'voiceManager');
    }

    protected override stopVoice(voice: Voice, time?: number): void {
        voice.stop(time ?? voice.context.currentTime);
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

        const voice = this.pickVoice(time);
        voice.play(params, noteStr, time, duration, slideFromFreq);
        return voice;
    }

    noteOn(params: SynthParams, note: string, time: number, slideFromFreq?: number): Voice {
        const voice = this.pickVoice(time);
        voice.startNote(params, note, time, slideFromFreq);
        return voice;
    }

    noteOff(note: string, time: number, params: SynthParams): void {
        for (let i = 0; i < this.voices.length; i++) {
            const voice = this.voices[i]!;
            if (voice.isActive && voice.currentNote === note) {
                voice.stopNote(time, params);
                this.markInactive(i);
                break;
            }
        }
    }

    override stopAll(time?: number): void {
        super.stopAll(time ?? this.voices[0]?.context.currentTime ?? 0);
    }

    /** Prefer idle voices; stop and steal the round-robin victim when saturated. */
    private pickVoice(time: number): Voice {
        if (this.monophonic) {
            const result = this.acquire({ steal: 'round-robin', time });
            // Since it's monophonic, maxVoices is 1, so index is always 0.
            this.markActive(result.index, time);
            return result.voice;
        }

        const result = this.acquire({ steal: 'round-robin', time });
        this.markActive(result.index, time);
        return result.voice;
    }
}