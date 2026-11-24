import { type SynthParams } from '../types';
import { tunedNoteToFrequency } from '../constants/tuning';
import type { ScaleDefinition } from '../utils/musicTheory';
import { parseWaveform, shapeToOscillatorType, type ParsedWaveform } from '../utils/waveformParser';
import { engineTelemetry, logEngineFallback, logFilterSourceFallback, logWaveformSubstitution } from '../utils/engineTelemetry';
import { engineDegradationStore } from '../stores/engineDegradationStore';
import { playbackHealthMonitor } from '../audio/playback/PlaybackHealthMonitor';
import { getOscillatorRegistry } from './backends/BackendRegistry';
import { engineEntry } from './backends/engineCatalog';
import { TABLE_DURATION_SEC, TABLE_REF_FREQ, type LoopRender, type RealtimeVoice } from './backends/OscillatorBackend';
import type { VoiceSource } from './backends/BackendRegistry';
import {
    FILTER_SOURCE_LABELS,
    biquadTypeFor,
    filterSourceIssueId,
    hostFilterRequest,
    kernelResonance,
    maxFilterCutoff,
    resolveFilterSource,
    resolveFilterType,
} from './backends/filterSource';
import { gpuFilterRefusal, gpuFilterSpec } from './backends/gpuFilter';
import type { WamFilterNode } from './WamFilter';
import { getFilterStage, getGpuFilter, type StagedFilterSource } from './filterStages';
import type { FilterSource, FilterType } from '../types/synth';
import { VoicePool, type PoolableVoice } from './base/VoicePool';
import { getPitchOffsetSemitones, transposeFrequency } from '../utils/pitchOffset';

/** The filter that will sound for one note, after availability checks. */
interface FilterPlan {
    source: FilterSource;
    type: FilterType;
    /** `webgpu` only: the note's table, already filtered on the GPU (the host oscillator is not used). */
    gpuLoop?: LoopRender;
}

export class Voice implements PoolableVoice {
    context: AudioContext;
    destination: AudioNode;

    // Graph
    private source: OscillatorNode | AudioBufferSourceNode | null = null;
    /**
     * Live worklet source (`rust-*`, #1664), kept across notes so a voice does
     * not create a node per note; handed back when the voice switches to a
     * family that renders a table. At most one of `source`/`realtime` sounds.
     */
    private realtime: RealtimeVoice | null = null;
    /**
     * Every source (OscillatorNode, looped table, worklet voice) connects here,
     * once, and never rewires. The bus feeds exactly one filter: the voice's own
     * `filter` (native), `stage` (a wasm filter: WASM OSC #1663, Rust #1672,
     * C++ #1673, DWGS #1674) or — for the WebGPU filter (#1675), whose table
     * is already filtered — nothing: the bus goes straight to the output gain.
     * Swapping filters is a couple of `connect`s on this node, not on every source.
     */
    private filterBus: GainNode;
    private filter: BiquadFilterNode;
    /** The wasm filter node this voice holds (one at a time), wired only while `filterRoute` is its source. */
    private stage: WamFilterNode | null = null;
    /** Which wasm filter `stage` came from. */
    private stageSource: StagedFilterSource | null = null;
    private filterRoute: FilterSource = 'native';
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

    /** Filter-source fallbacks already reported, by source and reason: once per cause, not per note. */
    private static reportedFilterFallback = new Set<string>();

    /** GPU banks whose warm-up was already logged: once per bank, not per note. */
    private static reportedWarmup = new Set<string>();

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
        this.filterBus = context.createGain();
        this.filter = context.createBiquadFilter();
        this.gain = context.createGain();
        this.dryGain = context.createGain();
        this.wetGain = context.createGain();
        this.delay = context.createDelay();
        this.delayGain = context.createGain();
        this.panner = context.createStereoPanner();

        // Connect permanent graph
        this.filterBus.connect(this.filter);
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

        const noteFreq = tunedNoteToFrequency(note, tuning);
        // Not a note name: play nothing rather than a wrong pitch.
        if (noteFreq === null) return;

        const now = time;
        // Module TUNE knob (semitones) transposes the sounding pitch.
        const pitchSemis = getPitchOffsetSemitones(params);
        const freq = transposeFrequency(noteFreq, pitchSemis);
        // Slide source frequencies are computed from the untransposed note, so
        // shift them by the same amount to keep glides in tune.
        const slideFrom = slideFromFreq !== undefined
            ? transposeFrequency(slideFromFreq, pitchSemis)
            : undefined;

        const waveform = params.waveform;
        const parsed = parseWaveform(waveform);
        const canReuse = (this.source || this.realtime) &&
                        this.isActive &&
                        slideFromFreq !== undefined &&
                        this.currentSourceType === waveform;

        if (canReuse) {
            // === LEGATO / SLIDE ===
            // A live worklet source and an OscillatorNode both take Hz on an
            // a-rate `frequency`, so a slide is scheduled the same way on either.
            const hzParam = this.realtime?.frequency
                ?? (this.source instanceof OscillatorNode ? this.source.frequency : null);
            if (hzParam) {
                hzParam.cancelScheduledValues(now);
                hzParam.setValueAtTime(slideFrom!, now);
                hzParam.exponentialRampToValueAtTime(freq, now + 0.1);
                // The previous note may have scheduled its gate to close after
                // its release (scheduleRelease); a slid note must not inherit
                // that. The gate is already open, so this resets no phase.
                this.realtime?.start(now, parsed.shape, parsed.variant);
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
            this.reportLegacyWaveform(parsed);
            const plan = this.planFilter(params, parsed, freq);
            // The WebGPU filter plays its own filtered table; every other filter sits behind the host engine.
            const chosen: VoiceSource | null = plan.gpuLoop
                ? { kind: 'loop', render: plan.gpuLoop }
                : this.chooseSource(parsed, params, plan);
            if (chosen?.kind === 'realtime') {
                // Worklet-resident engine: the same node as last note when it
                // was ours, else a pooled one. Gate + pitch are scheduled at
                // `now`, so the note is sample accurate like an OscillatorNode.
                const live = chosen.voice;
                if (live !== this.realtime) {
                    this.releaseRealtime();
                    live.output.connect(this.filterBus);
                    this.realtime = live;
                }
                live.frequency.cancelScheduledValues(now);
                live.frequency.setValueAtTime(freq, now);
                live.start(now, parsed.shape, parsed.variant);
            } else {
                this.releaseRealtime();
                if (chosen?.kind === 'loop') {
                    const rendered = chosen.render;
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
                this.source.connect(this.filterBus);
                this.source.start(now);
            }
            this.currentBaseFrequency = baseFrequency;
            this.currentSourceType = waveform;

            // Filter settings
            this.applyFilter(plan, params, now);

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
        // The live source stays this voice's; only its gate closes.
        this.realtime?.stop(releaseEnd + 0.1);

        this.cleanupTimer = setTimeout(() => {
            this.isActive = false;
            this.cleanupTimer = null;
        }, (releaseEnd - this.context.currentTime + 0.2) * 1000);
    }


    /** A retired waveform id is reported the first time it plays, whichever filter follows it. */
    private reportLegacyWaveform(parsed: ParsedWaveform): void {
        if (!parsed.legacyFrom || Voice.reportedLegacy.has(parsed.legacyFrom)) return;
        Voice.reportedLegacy.add(parsed.legacyFrom);
        logWaveformSubstitution(
            'oscillators',
            parsed.engine,
            parsed.shape,
            parsed.shape,
            `"${parsed.legacyFrom}" was retired; rendering on ${engineEntry(parsed.engine).label}`,
        );
    }

    /**
     * The source for `parsed`, entering `BackendRegistry` at the backend the
     * engine catalog names for that family: a live worklet voice or a looped
     * table, whichever that backend (or the first one below it) provides.
     *
     * Returns null when nothing in the chain could service the request — the
     * caller then builds an `OscillatorNode` of the right wave family, which is
     * the documented terminal step (`js`), not a silent substitution.
     */
    private chooseSource(
        parsed: ParsedWaveform,
        params: SynthParams,
        plan: FilterPlan,
    ): VoiceSource | null {
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

        return registry.sourceFrom(
            entry.backendId,
            this.context,
            {
                frequency: TABLE_REF_FREQ,
                duration: TABLE_DURATION_SEC,
                sampleRate: this.context.sampleRate,
                shape: parsed.shape,
                // What the host bakes into its table depends on the filter that
                // will actually run after it (see hostFilterRequest).
                ...hostFilterRequest(params, plan, this.context.sampleRate),
            },
            this.realtime,
        );
    }

    /**
     * Decide which filter shapes this note: the one the params ask for, or — when
     * a wasm filter was asked for and cannot run — the native one, *said out
     * loud*. The result is the filter that will actually sound, which is also
     * what the host oscillator is asked to bake (`hostFilterRequest`).
     */
    private planFilter(params: SynthParams, parsed: ParsedWaveform, freq: number): FilterPlan {
        const type = resolveFilterType(params.filterType);
        const requested = resolveFilterSource(params.filterSource);
        if (requested === 'native') return { source: 'native', type };
        if (requested === 'webgpu') return this.planGpuFilter(params, parsed, freq, type);
        const stage = getFilterStage(requested);
        const reason = stage
            ? stage.unavailableReason(this.context)
            : 'audio engine not initialized';
        if (reason) return this.filterFallback(requested, type, reason);
        // A node of the other wasm filter: hand it back before taking this one.
        if (this.stage && this.stageSource !== requested) this.routeFilter('native');
        if (!this.stage) {
            this.stage = stage!.acquire(this.context);
            if (!this.stage) return this.filterFallback(requested, type, stage!.failure ?? 'could not create a filter node');
            this.stageSource = requested;
        }
        this.filterWorks(requested);
        return { source: requested, type };
    }

    /**
     * The WebGPU filter (#1675): a looped table of the part's basic shape,
     * rendered on the GPU with the filter in every harmonic. It has no host
     * oscillator behind it — a GPU cannot sit after one — so the part's wave
     * *family* is kept and its engine is not (a `rust-saw` note plays the GPU's
     * saw). Anything it cannot serve plays through the native filter instead,
     * said out loud — except a bank still being baked, which is a warm-up:
     * the native filter is the same response, so it is logged but not raised
     * as a degradation.
     */
    private planGpuFilter(params: SynthParams, parsed: ParsedWaveform, freq: number, type: FilterType): FilterPlan {
        // 303 / Prophecy / Macro own their filters; Voice never plays them (chooseSource says so).
        if (engineEntry(parsed.engine).kind === 'native-worklet') return { source: 'native', type };
        const refusal = gpuFilterRefusal(parsed);
        if (refusal) return this.filterFallback('webgpu', type, refusal);
        const gpu = getGpuFilter();
        if (!gpu) return this.filterFallback('webgpu', type, 'audio engine not initialized');

        const spec = gpuFilterSpec(type, params.filterCutoff, params.filterResonance, this.context.sampleRate);
        const found = gpu.lookup(this.context, parsed.shape, spec, freq);
        if (found.kind === 'unavailable') return this.filterFallback('webgpu', type, found.reason);
        if (found.kind === 'warming') {
            this.reportWarmup(found.key);
            return { source: 'native', type };
        }
        this.filterWorks('webgpu');
        return { source: 'webgpu', type, gpuLoop: found.render };
    }

    /** An earlier fallback report for `source` is stale now that it works, and a later failure is news again. */
    private filterWorks(source: FilterSource): void {
        const prefix = `${source}:`;
        const stale = [...Voice.reportedFilterFallback].filter((key) => key.startsWith(prefix));
        if (stale.length === 0) return;
        for (const key of stale) Voice.reportedFilterFallback.delete(key);
        engineDegradationStore.resolve(filterSourceIssueId(source));
    }

    /** A note that used the native filter because its GPU bank was not baked yet: once per bank, telemetry only. */
    private reportWarmup(bankKey: string): void {
        if (Voice.reportedWarmup.has(bankKey)) return;
        Voice.reportedWarmup.add(bankKey);
        const detail = `WebGPU filter bank "${bankKey}" is being rendered; notes until it is ready use the native filter (same response)`;
        try {
            engineTelemetry.recordDegradation('filter-webgpu-warmup', true, detail);
        } catch {
            /* telemetry must never break audio */
        }
    }

    private filterFallback(requested: FilterSource, type: FilterType, reason: string): FilterPlan {
        const key = `${requested}:${reason}`;
        if (!Voice.reportedFilterFallback.has(key)) {
            Voice.reportedFilterFallback.add(key);
            logFilterSourceFallback(
                FILTER_SOURCE_LABELS[requested],
                FILTER_SOURCE_LABELS.native,
                reason,
                filterSourceIssueId(requested),
            );
        }
        return { source: 'native', type };
    }

    /** Wire and set the planned filter at `now`; the other one is parked (disconnected). */
    private applyFilter(plan: FilterPlan, params: SynthParams, now: number): void {
        const sampleRate = this.context.sampleRate;
        const cutoff = Math.max(20, Math.min(maxFilterCutoff(sampleRate), params.filterCutoff));
        this.routeFilter(plan.source);
        // The WebGPU table is already filtered: nothing sits between the bus and the output gain.
        if (plan.source === 'webgpu') return;
        if (plan.source !== 'native' && this.stage) {
            this.stage.set(now, {
                cutoff,
                resonance: kernelResonance(plan.type, params.filterResonance),
                type: plan.type,
            });
            return;
        }
        this.filter.type = biquadTypeFor(plan.type);
        this.filter.frequency.setValueAtTime(params.filterCutoff, now);
        this.filter.Q.value = params.filterResonance;
    }

    /**
     * Point `filterBus` at one filter: the native biquad, the held wasm node, or
     * (WebGPU) straight at the output gain. A no-op when it already does.
     */
    private routeFilter(to: FilterSource): void {
        const stage = this.stage;
        const wantsStage = to !== 'native' && to !== 'webgpu' && !!stage && this.stageSource === to;
        const want: FilterSource = to === 'webgpu' ? 'webgpu' : wantsStage ? to : 'native';
        // A wasm node the wanted route does not use is not a no-op to leave: hand it back.
        const stranded = !!stage && !wantsStage;
        if (want === this.filterRoute && !stranded) return;
        const from = this.filterRoute;
        try {
            // Out of the current route…
            if (from === 'native') {
                if (want !== 'native') this.filterBus.disconnect(this.filter);
            } else if (from === 'webgpu') {
                this.filterBus.disconnect(this.gain);
            } else if (stage) {
                this.filterBus.disconnect(stage.input);
            }
            // …into the new one…
            if (want === 'native') {
                if (from !== 'native') this.filterBus.connect(this.filter);
            } else if (want === 'webgpu') {
                this.filterBus.connect(this.gain);
            } else if (stage) {
                this.filterBus.connect(stage.input);
                stage.output.connect(this.gain);
            }
            // …and a node it does not use goes back to the pool (this disconnects its output too).
            if (stage && !wantsStage) {
                stage.release();
                this.stage = null;
                this.stageSource = null;
            }
        } catch (e) {
            // A rewire that throws would leave the voice with no filter path at all.
            console.error('[Voice] filter rewire failed; restoring the native filter', e);
            try { this.filterBus.disconnect(); } catch { /* nothing connected */ }
            this.filterBus.connect(this.filter);
            if (this.stage) {
                this.stage.release();
                this.stage = null;
                this.stageSource = null;
            }
            this.filterRoute = 'native';
            return;
        }
        this.filterRoute = want;
    }

    /** Hand the live source back to its backend (disconnects it from this voice). */
    private releaseRealtime(): void {
        if (!this.realtime) return;
        const live = this.realtime;
        this.realtime = null;
        try {
            live.release();
        } catch {
            /* teardown must not throw on the note path */
        }
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
        // Keep the live source (the next note very likely reuses it); just gate it.
        this.realtime?.stop(time);
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