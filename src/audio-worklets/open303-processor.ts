// src/audio-worklets/open303-processor.ts
// Hardened version with stack overflow protection and graceful degradation

import { WorkletPerfReporter } from './workletPerfReporter';
import { Open303EngineSession } from './open303/engineSession';
import { Open303EngineSelection } from './open303/engineSelection';
import { ParameterQueue } from './open303/parameterQueue';
import { SynthState, getTime, type EngineFamily } from './open303/shared';

// Definitions for the AudioWorklet scope
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare const currentTime: number;

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

// Map from jc303_set* function name → open303 paramId
// (keeps the existing message protocol while supporting the new native API)
const JC303_PARAM_MAP: Record<string, number> = {
    jc303_setWaveform:   0,  // OPEN303_WAVEFORM
    jc303_setCutoff:     2,  // OPEN303_CUTOFF
    jc303_setResonance:  3,  // OPEN303_RESONANCE
    jc303_setEnvMod:     4,  // OPEN303_ENV_MOD
    jc303_setDecay:      5,  // OPEN303_DECAY
    jc303_setAccent:     6,  // OPEN303_ACCENT
    jc303_setVolume:     7,  // OPEN303_VOLUME
    jc303_setFilterMode: 8,  // OPEN303_FILTER_MODE
};

class Open303Processor extends AudioWorkletProcessor {
    private readonly session = new Open303EngineSession(this.port);
    private readonly engineSelection = new Open303EngineSelection(this.session, this.port, () => this.clearAllNotes());
    private readonly parameterQueue = new ParameterQueue(this.applyParamMessage.bind(this));
    private readonly perf = new WorkletPerfReporter(this.port, 'open303');

    // Mild makeup gain — hyphon_native 303 engines already run near full scale.
    private static readonly OUTPUT_GAIN = 1.0;

    // Stuck note protection
    private activeNotes: Map<number, number> = new Map(); // note -> startTime (ms)
    private static readonly MAX_NOTE_DURATION_MS = 8000;
    private stuckNoteWarnings = 0;

    // Rate limiting
    private lastNoteOnTime = 0;
    private static readonly MIN_NOTE_INTERVAL_MS = 5;
    private static readonly MAX_NOTES_PER_SECOND = 50;
    private noteOnTimes: number[] = [];

    // Portamento/slide fix
    private pendingNote: { note: number; velocity: number } | null = null;
    private noteOffJustSent = false;

    // Error tracking (process() hot path)
    private processErrorCount = 0;
    private allocationErrorCount = 0;

    /** Params/engine messages received before the worklet reaches READY. */
    private pendingMessages: Array<{ type: string; data: any }> = [];

    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
    }

    private async handleMessage(event: MessageEvent) {
        const { type, data } = event.data;

        if (type === 'init-wasm') {
            await this.session.initialize(data, () => this.flushPendingMessages());
            return;
        }

        if (!this.session.isReady) {
            if (type === 'set-engine' || type === 'set-303-model' || type === 'param') {
                this.pendingMessages.push({ type, data });
            }
            return;
        }

        this.dispatchMessage(type, data);
    }

    private dispatchMessage(type: string, data: any): void {
        if (type === 'noteOn') {
            this.handleNoteOn(data.note, data.velocity);
        } else if (type === 'noteOff') {
            this.handleNoteOff(data.note);
        } else if (type === 'set-engine') {
            this.engineSelection.setEngine(data.engine as EngineFamily);
        } else if (type === 'set-303-model') {
            this.engineSelection.setModel(
                data.model as string,
                data.engine as EngineFamily | undefined,
                data.oversample as number | undefined,
            );
        } else if (type === 'param') {
            this.handleParam(data);
        }
    }

    private handleParam(data: { func: string; value: number; audioTime?: number }): void {
        const audioTime = data.audioTime ?? 0;

        // Immediate? (currentTime must be accessed on global scope in audio worklets, but TS types define it via currentTime. Actually, AudioWorkletGlobalScope exposes currentTime directly.)
        if (typeof currentTime !== 'undefined' && audioTime <= currentTime) {
            this.applyParamMessage(this.session.getExports(), data);
            return;
        }

        // Schedule
        this.parameterQueue.schedule({ func: data.func, value: data.value, audioTime });
    }

    private applyParamMessage(exports: Record<string, any>, data: { func: string; value: number }): void {
        if (this.session.isNativeApi) {
            const paramId = JC303_PARAM_MAP[data.func as string];
            if (paramId !== undefined) {
                // The live high-fid voice mirrors Open303Param ids, so the same
                // message keeps working. Params go to it whenever it exists,
                // and the custom open303 instance keeps receiving them too, so
                // a CPU-gate step-down lands on an already-in-sync stock voice.
                this.engineSelection.liveHighFid?.setParam(paramId, data.value);
                if (this.engineSelection.activeEngine === 'jc303' && this.session.hasJc303MultiApi && exports.jc303_set_param) {
                    exports.jc303_set_param(this.session.toWasmHandle(this.session.jc303Handle), paramId, data.value);
                } else if (exports.open303_set_param) {
                    exports.open303_set_param(this.session.toWasmHandle(this.session.instanceHandle), paramId, data.value);
                }
            }
        } else if (exports[data.func]) {
            exports[data.func](data.value);
        }
    }

    private flushPendingMessages(): void {
        const queue = this.pendingMessages;
        this.pendingMessages = [];
        for (const msg of queue) {
            this.dispatchMessage(msg.type, msg.data);
        }
    }

    private handleNoteOn(note: number, velocity: number): void {
        const now = getTime();

        // Rate limit check
        let keepCount = 0;
        for (let i = 0; i < this.noteOnTimes.length; i++) {
            if (now - this.noteOnTimes[i] < 1000) {
                this.noteOnTimes[keepCount++] = this.noteOnTimes[i];
            }
        }
        this.noteOnTimes.length = keepCount;
        if (this.noteOnTimes.length >= Open303Processor.MAX_NOTES_PER_SECOND) {
            console.warn(`[Open303] Rate limit exceeded, dropping note ${note}`);
            return;
        }

        const timeSinceLastNote = now - this.lastNoteOnTime;
        if (timeSinceLastNote < Open303Processor.MIN_NOTE_INTERVAL_MS) {
            console.warn(`[Open303] Note ${note} too soon (${timeSinceLastNote.toFixed(1)}ms), dropping`);
            return;
        }

        // Portamento fix
        if (this.noteOffJustSent || this.activeNotes.size > 0) {
            if (this.activeNotes.size > 0) {
                this.clearAllNotes();
            }
            this.pendingNote = { note, velocity };
            this.noteOffJustSent = true;
            return;
        }

        this.triggerNoteOn(note, velocity);
    }

    private handleNoteOff(note: number): void {
        if (!this.session.isInstantiated) return;
        const exports = this.session.getExports();

        try {
            if (this.engineSelection.activeEngine === 'highfid' && this.engineSelection.liveHighFid) {
                this.engineSelection.liveHighFid.noteOff(note);
            } else if (this.engineSelection.activeEngine === 'jc303' && this.session.hasJc303MultiApi) {
                exports.jc303_note_off(this.session.toWasmHandle(this.session.jc303Handle), note);
            } else if (this.session.isNativeApi) {
                exports.open303_note_off(this.session.toWasmHandle(this.session.instanceHandle), note);
            } else {
                exports.jc303_noteOff(note);
            }
            this.activeNotes.delete(note);
            this.noteOffJustSent = true;
        } catch (e) {
            console.error('[Open303] noteOff failed:', e);
        }
    }

    private clearAllNotes(): void {
        if (!this.session.isInstantiated) return;
        const exports = this.session.getExports();

        try {
            if (this.engineSelection.activeEngine === 'highfid' && this.engineSelection.liveHighFid) {
                this.engineSelection.liveHighFid.allNotesOff();
            } else if (this.engineSelection.activeEngine === 'jc303' && this.session.hasJc303MultiApi) {
                exports.jc303_all_notes_off(this.session.toWasmHandle(this.session.jc303Handle));
            } else if (this.session.isNativeApi) {
                exports.open303_all_notes_off(this.session.toWasmHandle(this.session.instanceHandle));
            } else if (exports.jc303_allNotesOff) {
                exports.jc303_allNotesOff();
            } else {
                for (const note of this.activeNotes.keys()) {
                    exports.jc303_noteOff(note);
                }
            }
        } catch (e) {
            console.error('[Open303] clearAllNotes failed:', e);
        }
        this.activeNotes.clear();
    }

    private triggerNoteOn(note: number, velocity: number): void {
        if (!this.session.isInstantiated) return;
        const exports = this.session.getExports();

        try {
            if (this.engineSelection.activeEngine === 'highfid' && this.engineSelection.liveHighFid) {
                this.engineSelection.liveHighFid.noteOn(note, velocity);
            } else if (this.engineSelection.activeEngine === 'jc303' && this.session.hasJc303MultiApi) {
                exports.jc303_note_on(this.session.toWasmHandle(this.session.jc303Handle), note, velocity);
            } else if (this.session.isNativeApi) {
                exports.open303_note_on(this.session.toWasmHandle(this.session.instanceHandle), note, velocity);
            } else {
                exports.jc303_noteOn(note, velocity);
            }
            const now = getTime();
            this.lastNoteOnTime = now;
            this.noteOnTimes.push(now);
            this.activeNotes.set(note, now);
        } catch (e: any) {
            console.error(`[Open303] noteOn failed:`, e);
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
        const blockFrames = channelL ? channelL.length : 128;
        this.perf.beginProcess(blockFrames);
        try {
        const channelR = output[1];

        // Drain pending parameters
        if (this.parameterQueue.length > 0 && typeof currentTime !== 'undefined') {
            this.parameterQueue.drain(currentTime, this.session.getExports());
        }

        // Handle pending note (portamento fix)
        if (this.pendingNote && this.session.state === SynthState.READY) {
            this.triggerNoteOn(this.pendingNote.note, this.pendingNote.velocity);
            this.pendingNote = null;
            this.noteOffJustSent = false;
        }

        // Output silence if not ready
        if (!this.session.isReady || !this.session.heapFloat32) {
            if (channelL) channelL.fill(0);
            if (channelR) channelR.fill(0);
            return true;
        }

        try {
            const exports = this.session.getExports();
            const numFrames = channelL ? channelL.length : 128;
            const gain = Open303Processor.OUTPUT_GAIN;

            if (this.engineSelection.activeEngine === 'highfid' && this.engineSelection.liveHighFid?.isReady) {
                // ── Live diode-ladder high-fid voice (Phase L1) ──────────────
                if (this.session.isInvalidHandle(this.session.nativeOutputPtr)) {
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }

                const t0 = getTime();
                this.engineSelection.liveHighFid.process(this.session.nativeOutputPtr, numFrames);
                const renderUs = (getTime() - t0) * 1000;

                const floatOffset = this.session.getWasmSampleOffset(this.session.nativeOutputPtr, numFrames);
                if (floatOffset < 0) {
                    if (this.processErrorCount++ < 5) {
                        console.error('[Open303] highfid303_process output buffer unreadable');
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }
                this.session.writeOutputSamples(floatOffset, numFrames, channelL, channelR, gain);

                // CPU meter / glitch gate — degrade to stock rather than glitch.
                const quantumUs = (numFrames / this.session.sampleRateHz) * 1_000_000;
                this.engineSelection.recordHighFidTiming(renderUs, quantumUs);
            } else if (this.engineSelection.activeEngine === 'jc303' && this.session.hasJc303MultiApi) {
                // ── Authentic rosic::Open303 multi-instance API ───────────────
                const ptr = exports.jc303_process_handle(
                    this.session.toWasmHandle(this.session.jc303Handle),
                    numFrames,
                );
                const floatOffset = this.session.getWasmSampleOffset(ptr, numFrames);
                if (floatOffset < 0) {
                    if (this.allocationErrorCount++ < 5) {
                        console.error('[Open303] jc303_process_handle returned invalid pointer');
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }
                this.session.writeOutputSamples(floatOffset, numFrames, channelL, channelR, gain);
            } else if (this.session.isNativeApi) {
                // ── Custom open303 multi-instance API ────────────────────────
                if (this.session.isInvalidHandle(this.session.nativeOutputPtr)) {
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }

                exports.open303_process(
                    this.session.toWasmHandle(this.session.instanceHandle),
                    this.session.toWasmHandle(this.session.nativeOutputPtr),
                    numFrames,
                );

                const floatOffset = this.session.getWasmSampleOffset(this.session.nativeOutputPtr, numFrames);
                if (floatOffset < 0) {
                    if (this.processErrorCount++ < 5) {
                        console.error('[Open303] open303_process output buffer unreadable');
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }
                this.session.writeOutputSamples(floatOffset, numFrames, channelL, channelR, gain);
            } else {
                // ── Legacy jc303_* API ───────────────────────────────────────
                const ptr = exports.jc303_process(numFrames);

                if (this.session.wasmPtrToOffset(ptr) < 0) {
                    if (this.allocationErrorCount++ < 5) {
                        console.error('[Open303] jc303_process returned invalid pointer');
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }

                const floatOffset = this.session.getWasmSampleOffset(ptr, numFrames);
                if (floatOffset < 0) {
                    if (this.processErrorCount++ < 5) {
                        console.error('[Open303] jc303_process buffer unreadable');
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }
                this.session.writeOutputSamples(floatOffset, numFrames, channelL, channelR, gain);

                if (exports.free) {
                    exports.free(ptr);
                }
            }

            // Stuck note detection (common to both APIs)
            this.checkStuckNotes(exports);

        } catch (e: any) {
            if (this.processErrorCount++ < 5) {
                console.error('[Open303] Process error:', e);
            }
            if (channelL) channelL.fill(0);
            if (channelR) channelR.fill(0);
        }

        return true;
        } finally {
            this.perf.endProcess();
        }
    }

    private checkStuckNotes(exports: any): void {
        const now = getTime();
        for (const [note, startTime] of this.activeNotes.entries()) {
            const duration = now - startTime;
            if (duration > Open303Processor.MAX_NOTE_DURATION_MS) {
                if (this.stuckNoteWarnings++ < 5) {
                    console.warn(`[Open303] Stuck note detected: ${note} held for ${duration.toFixed(0)}ms, auto-releasing`);
                }
                try {
                    if (this.engineSelection.activeEngine === 'highfid' && this.engineSelection.liveHighFid) {
                        this.engineSelection.liveHighFid.noteOff(note);
                    } else if (this.engineSelection.activeEngine === 'jc303' && this.session.hasJc303MultiApi) {
                        exports.jc303_note_off(this.session.jc303Handle, note);
                    } else if (this.session.isNativeApi) {
                        exports.open303_note_off(this.session.instanceHandle, note);
                    } else {
                        exports.jc303_noteOff(note);
                    }
                } catch { }
                this.activeNotes.delete(note);
            }
        }
    }
}

registerProcessor('open303-processor', Open303Processor);
