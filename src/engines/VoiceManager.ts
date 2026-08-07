import { type SynthParams } from '../types';
import { tunedNoteToFrequency } from '../constants';
import type { ScaleDefinition } from '../utils/musicTheory';
import { parseWaveform, shapeToOscillatorType, type WaveShape } from '../utils/waveformParser';
import type { WasmOscillator } from './WasmOscillator';
import type { RustOscillator } from './RustOscillator';
import { logEngineFallback, logWaveformSubstitution } from '../utils/engineTelemetry';
import { playbackHealthMonitor } from '../audio/playback/PlaybackHealthMonitor';
import {
    PYODIDE_REF_FREQ,
    generatePyodideLoopBuffer,
    type PyodideLike,
} from '../utils/pyodideBuffers';
import { VoicePool, type PoolableVoice } from './base/VoicePool';
import { getPitchOffsetSemitones, transposeFrequency } from '../utils/pitchOffset';

export interface VoiceEngineDeps {
    wasmEngine?: WasmOscillator | null;
    wgslBuffers?: Partial<Record<WaveShape, AudioBuffer | null>>;
    rustEngine?: RustOscillator | null;
    pyodideEngine?: PyodideLike | null;
    pyodideBuffers?: Partial<Record<WaveShape, AudioBuffer | null>>;
}

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

    // Buffers for wav-based waveforms
    private wavSawBuffer?: AudioBuffer;
    private wavSqrBuffer?: AudioBuffer;

    private cleanupTimer: any = null;
    private globalDelayNode?: DelayNode;
    private globalDelaySendGain?: GainNode;

    private engineDeps?: VoiceEngineDeps;

    updateEngineDeps(deps: Partial<VoiceEngineDeps>): void {
        this.engineDeps = { ...this.engineDeps, ...deps };
    }

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
        const isWav = parsed.engine === 'wav';
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
                const baseFreq = 261.63; // C4
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

            const REF_FREQ = 261.63; // C4 — all pre-rendered buffers use this reference

            if (isWav) {
                // PCM/WAV: use preloaded buffer. If the buffer hasn't loaded yet,
                // warn and fall through to the JS oscillator (avoids silent note).
                const buf = parsed.shape === 'sqr' ? this.wavSqrBuffer : this.wavSawBuffer;
                if (buf) {
                    const src = this.context.createBufferSource();
                    src.buffer = buf;
                    src.loop = true;
                    src.playbackRate.value = freq / REF_FREQ;
                    createdSource = src;
                } else {
                    logEngineFallback('wav', 'pcm', `wav-${parsed.shape} buffer not loaded yet`);
                }
            } else if (parsed.engine === 'wam') {
                // WAM (AssemblyScript/WASM oscillator). Bug fix: was checking 'wasm' but
                // parseWaveform returns 'wam' for wam-* prefixes. Now checks 'wam'.
                if (this.engineDeps?.wasmEngine?.isReady) {
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
                    } else {
                        logEngineFallback('wam', 'wasm', `WasmOscillator.generate() returned empty for wam-${parsed.shape}`);
                    }
                } else {
                    logEngineFallback('wam', 'wasm', `WasmOscillator not ready for wam-${parsed.shape}`);
                }
            } else if (parsed.engine === 'rust') {
                // Rust/WASM oscillator. Supports saw and sqr only; tri/sin are not
                // defined as valid Rust waveforms in types.ts so this is a guard.
                if (this.engineDeps?.rustEngine?.isReady) {
                    // The Rust kernel only implements saw/sqr. Mapping tri/sin onto
                    // saw changes the wave family the user hears, so it is reported
                    // (HUD + telemetry) instead of being applied silently.
                    const needsSubstitution = parsed.shape === 'tri' || parsed.shape === 'sin';
                    const rustShape = needsSubstitution ? 'saw' : (parsed.shape as 'saw' | 'sqr');
                    if (needsSubstitution) {
                        logWaveformSubstitution(
                            'rust',
                            'rust',
                            parsed.shape,
                            rustShape,
                            'Rust oscillator implements saw/sqr only',
                        );
                    }
                    const float = this.engineDeps.rustEngine.generate(
                        REF_FREQ,
                        2.0,
                        this.context.sampleRate,
                        rustShape,
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
                    } else {
                        logEngineFallback('rust', 'wasm', `RustOscillator.generate() returned empty for rust-${parsed.shape}`);
                    }
                } else {
                    logEngineFallback('rust', 'wasm', `RustOscillator not ready for rust-${parsed.shape}`);
                }
            } else if (parsed.engine === 'wgsl') {
                // WebGPU: use pre-rendered buffer. Buffers are only populated when
                // gpuEngine.isSupported; when unavailable we fall through to JS.
                const buf = this.engineDeps?.wgslBuffers?.[parsed.shape];
                if (buf) {
                    const src = this.context.createBufferSource();
                    src.buffer = buf;
                    src.loop = true;
                    src.playbackRate.value = freq / REF_FREQ;
                    createdSource = src;
                } else {
                    logEngineFallback(
                        'webgpu',
                        'webgpu',
                        `wgsl-${parsed.shape} buffer unavailable (GPU unsupported or pre-render pending)`,
                    );
                }
            } else if (parsed.engine === 'pyodide') {
                const pyodide = this.engineDeps?.pyodideEngine;
                if (pyodide) {
                    let buf =
                        this.engineDeps?.pyodideBuffers?.[parsed.shape] ?? null;
                    if (!buf) {
                        buf = generatePyodideLoopBuffer(
                            pyodide,
                            this.context,
                            parsed.shape,
                            params.filterCutoff,
                            params.filterResonance,
                        );
                    }
                    if (buf) {
                        const src = this.context.createBufferSource();
                        src.buffer = buf;
                        src.loop = true;
                        src.playbackRate.value = freq / PYODIDE_REF_FREQ;
                        createdSource = src;
                        this.filter.frequency.setValueAtTime(
                            Math.min(params.filterCutoff, 20000),
                            now,
                        );
                    } else {
                        logEngineFallback(
                            'pyodide',
                            'pyodide',
                            `generate_loop_buffer returned empty for pyodide-${parsed.shape}`,
                        );
                    }
                } else {
                    logEngineFallback(
                        'pyodide',
                        'pyodide',
                        `Pyodide not ready for pyodide-${parsed.shape}`,
                    );
                }
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

export class VoiceManager extends VoicePool<Voice> {
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
        super(polyphony);
        this.monophonic = monophonic;
        this.voices = Array.from({ length: this.maxVoices }, () =>
            new Voice(context, destination, wavSaw, wavSqr, globalDelayNode, engineDeps)
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

    stopAll(time?: number): void {
        // ⚡ Bolt Optimization: Replace forEach with for...of to prevent closure allocations
        for (const v of this.voices) {
            v.stop(time ?? v.context.currentTime);
        }
    }

    updateEngineDeps(deps: Partial<VoiceEngineDeps>): void {
        for (const voice of this.voices) {
            voice.updateEngineDeps(deps);
        }
    }

    /** Prefer idle voices; stop and steal the round-robin victim when saturated. */
    private pickVoice(time: number): Voice {
        // We can optionally clean up `activeIndices` if `voice.isActive` went false externally.
        // E.g., Voice has an internal timeout for release. Let's sync `activeIndices` with real `isActive`.
        for (let i = 0; i < this.voices.length; i++) {
            if (!this.voices[i]!.isActive && this.activeIndices.has(i)) {
                this.markInactive(i);
            }
        }

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