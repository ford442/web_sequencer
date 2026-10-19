/**
 * MacroManager.ts
 *
 * The macro engine family (Plaits DSP, MIT) on the two synth parts:
 *   - partA: SYNTH A
 *   - partB: SYNTH B
 *
 * Mirrors ProphecyManager, with three differences:
 *   - every note and param carries its AudioContext time (sample-accurate
 *     scheduling in the worklet; nothing goes through setTimeout)
 *   - parts are polyphonic: chords are just several noteOns on one time
 *   - a part that is not ready never goes silent: `substitute()` names the
 *     JS waveform to play instead and reports the substitution to the Engine
 *     HUD (once per part + model), so a song using `macro-*` opened on a build
 *     without the engine still sounds and says why it sounds different
 */

import { MacroOscillator, type MacroNoteOptions } from './MacroOscillator';
import { logWaveformSubstitution } from '../utils/engineTelemetry';
import type { SynthParams, Waveform } from '../types';
import { getPitchOffsetSemitones } from '../utils/pitchOffset';
import {
    MACRO_AUTOMATION_TARGETS,
    MacroParam,
    macroControlValue,
    macroEngineForWaveform,
    macroNativeParams,
    resolveMacroParams,
    type MacroAutomationParam,
    type MacroEngineInfo,
} from './MacroParams';
import { findEngineVoice } from '../audio/graph/engineVoices';
import type { CompiledAudioGraph } from '../audio/graph/types';

export type MacroPart = 'partA' | 'partB';

/** "part:waveform" pairs whose substitution was already reported this session. */
const reportedSubstitutions = new Set<string>();

/**
 * The waveform to play instead of a `macro-*` one that cannot be rendered,
 * reported to the Engine HUD the first time per part + model. `manager` may be
 * null (the engine never initialised). Undefined when `waveform` is not a
 * macro model.
 */
export function substituteMacroWaveform(
    part: MacroPart,
    waveform: Waveform,
    manager: MacroManager | null | undefined,
    reason?: string,
): Waveform | undefined {
    const engine = macroEngineForWaveform(waveform);
    if (!engine) return undefined;
    const key = `${part}:${waveform}`;
    if (!reportedSubstitutions.has(key)) {
        reportedSubstitutions.add(key);
        logWaveformSubstitution('macro', part, waveform, engine.fallback, reason ?? manager?.unavailableReason(part, engine) ?? 'macro engine not initialised');
    }
    return engine.fallback;
}

/** Test hook: forget which substitutions were reported. */
export function resetMacroSubstitutionReports(): void {
    reportedSubstitutions.clear();
}

export class MacroManager {
    private partA: MacroOscillator | null = null;
    private partB: MacroOscillator | null = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /** Boot both parts. `true` when at least one is ready. */
    async init(audioContext: AudioContext, workletUrl: string): Promise<boolean> {
        this.partA = new MacroOscillator();
        this.partB = new MacroOscillator();
        const [a, b] = await Promise.allSettled([
            this.partA.init(audioContext, workletUrl, 'partA (SYNTH A)'),
            this.partB.init(audioContext, workletUrl, 'partB (SYNTH B)'),
        ]);
        const aReady = a.status === 'fulfilled' && a.value;
        const bReady = b.status === 'fulfilled' && b.value;
        return aReady || bReady;
    }

    /**
     * Plug partA / partB into their `macroVoice` nodes in the compiled patch.
     * A part the patch has no node for falls back to its track bus (when
     * given), so it is never silent; returns the parts that fell back.
     */
    attachToGraph(
        graph: CompiledAudioGraph,
        fallback: { partA?: AudioNode; partB?: AudioNode } = {},
    ): MacroPart[] {
        const missing: MacroPart[] = [];
        for (const part of ['partA', 'partB'] as const) {
            const osc = this.osc(part);
            if (!osc) continue;
            const socket = findEngineVoice(graph, 'macroVoice', part);
            if (socket) {
                socket.attach(osc);
                continue;
            }
            missing.push(part);
            const dest = fallback[part];
            if (dest) osc.connect(dest);
            console.warn(`[MacroManager] patch has no ${part} macro voice node; routed to its track bus`);
        }
        return missing;
    }

    connectBuses(partADest: AudioNode, partBDest: AudioNode): void {
        this.partA?.connect(partADest);
        this.partB?.connect(partBDest);
    }

    disconnect(): void {
        this.partA?.disconnect();
        this.partB?.disconnect();
    }

    // ── Readiness ─────────────────────────────────────────────────────────────

    isPartReady(part: MacroPart): boolean {
        return this.osc(part)?.isReady ?? false;
    }

    isPartAReady(): boolean { return this.isPartReady('partA'); }
    isPartBReady(): boolean { return this.isPartReady('partB'); }

    /**
     * True when `part` can render `engine`: the worklet is up and the loaded
     * wasm knows that many models (a newer catalog on an older wasm must not
     * send an index the native side would clamp onto another model).
     */
    canPlay(part: MacroPart, engine: MacroEngineInfo): boolean {
        const osc = this.osc(part);
        return !!osc?.isReady && engine.index < osc.engineCount;
    }

    /** Why `part` cannot play `engine` (for the substitution report). */
    unavailableReason(part: MacroPart, engine: MacroEngineInfo): string {
        const osc = this.osc(part);
        if (!osc) return 'macro engine not initialised';
        if (!osc.isReady) return 'macro worklet unavailable (this build or browser cannot load it)';
        return `loaded hyphon_native has ${osc.engineCount} macro models; ${engine.label} is #${engine.index}`;
    }

    // ── Parameters ────────────────────────────────────────────────────────────

    /**
     * Apply a part's SynthParams (model from the waveform, knobs from
     * `params.macro`, TUNE as the native transpose) at `audioTime`. Only the
     * values that changed since the last apply are sent.
     */
    applyParams(part: MacroPart, params: SynthParams, engine: MacroEngineInfo, audioTime?: number): void {
        const osc = this.osc(part);
        if (!osc?.isReady) return;
        const native = macroNativeParams(engine, resolveMacroParams(params.macro), params.volume);
        native.push([MacroParam.TRANSPOSE, getPitchOffsetSemitones(params)]);
        osc.setParams(native, audioTime);
    }

    /**
     * The same patch as {@link applyParams}, in effect now: what a knob move
     * or a model switch on the panel calls. Changed values only.
     */
    applyParamsNow(part: MacroPart, params: SynthParams, engine: MacroEngineInfo): void {
        const osc = this.osc(part);
        if (!osc?.isReady) return;
        const native = macroNativeParams(engine, resolveMacroParams(params.macro), params.volume);
        native.push([MacroParam.TRANSPOSE, getPitchOffsetSemitones(params)]);
        osc.setParamsNow(native);
    }

    /** Automation lane value (normalized 0–1) at an AudioContext time — lands on its frame. */
    scheduleParamAtTime(part: MacroPart, param: MacroAutomationParam, value: number, audioTime: number): void {
        const target = MACRO_AUTOMATION_TARGETS[param];
        if (!target || !Number.isFinite(value)) return;
        this.osc(part)?.setParam(target.paramId, macroControlValue(param, value), audioTime);
    }

    // ── Notes ─────────────────────────────────────────────────────────────────

    /** @param velocity 0–1. */
    noteOn(part: MacroPart, midiNote: number, velocity: number, audioTime?: number, opts?: MacroNoteOptions): void {
        this.osc(part)?.noteOn(midiNote, velocity, audioTime, opts);
    }

    noteOff(part: MacroPart, midiNote: number, audioTime?: number): void {
        this.osc(part)?.noteOff(midiNote, audioTime);
    }

    /** Transport stop on one part: scheduled notes dropped, 2 ms fade. */
    allNotesOff(part?: MacroPart): void {
        if (!part || part === 'partA') this.partA?.allNotesOff();
        if (!part || part === 'partB') this.partB?.allNotesOff();
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    cleanup(): void {
        this.partA?.cleanup();
        this.partB?.cleanup();
        this.partA = null;
        this.partB = null;
    }

    private osc(part: MacroPart): MacroOscillator | null {
        return part === 'partA' ? this.partA : this.partB;
    }
}
