// src/audio-worklets/macro-processor.ts
// AudioWorklet processor for the macro engine family (Plaits DSP, MIT):
// one polyphonic, stereo macro_* voice (emscripten/macro_wrapper.cpp) per node
// on the audio session's shared hyphon_native instance (hyphonNativeSession.ts).
//
// Every note and param is pushed into the voice's native event ring for its own
// frame; the engine applies it on the next 48 kHz control block (≤ 0.25 ms).
// The voice renders planar stereo: left at the buffer, right one stride on.

import { formatMissingWasmExports, hasMacroApi, MACRO_REQUIRED_WASM_EXPORTS } from './hyphonNativeImports';
import { VoiceEvent } from '../shared/rt/hyphonNativeExports';
import { NativeVoiceProcessor, type NativeVoiceRef } from './nativeVoiceProcessor';

/** Fields the port messages carry; each message type reads a few of them. */
interface MacroMessageData {
    note?: number;
    /** 0–1. */
    velocity?: number;
    audioTime?: number;
    /** Per-note TIMBRE / MORPH offsets, −1…1. */
    timbre?: number;
    morph?: number;
    /** Glide in from the part's last pitch (legato when the part is mono). */
    slide?: boolean;
    /** Fine pitch in semitones. */
    fine?: number;
    paramId?: number;
    value?: number;
    /** set-params: flat [id, value, id, value, …]. */
    params?: number[];
}

interface MacroInitData {
    wasmBytes: ArrayBuffer;
    sampleRate: number;
    isThreaded: boolean;
    variant?: string;
    memoryPages?: number;
    exportMap?: Record<string, string>;
}

class MacroProcessor extends NativeVoiceProcessor {
    private voice: NativeVoiceRef | null = null;
    private stride = 0;
    private initializing = false;

    private readonly readyMessage: { type: 'ready'; heap: unknown; engineCount: number } = {
        type: 'ready',
        heap: undefined,
        engineCount: 0,
    };
    private readonly errorMessage = { type: 'error' as const, error: '' };

    constructor() {
        super('macro', '[Macro]');
        this.port.onmessage = this.handleMessage.bind(this);
    }

    // ── Message handler ───────────────────────────────────────────────────────

    private async handleMessage(event: MessageEvent): Promise<void> {
        const { type, data } = event.data as { type: string; data?: unknown };

        if (type === 'init-wasm') {
            await this.initializeWasm(data as MacroInitData);
            return;
        }
        if (type === 'dispose') {
            this.dispose();
            return;
        }

        const voice = this.voice;
        if (!voice) return;
        const d = (data ?? {}) as MacroMessageData;

        switch (type) {
            case 'noteOn':
                if (d.note !== undefined) {
                    this.pushEvent(
                        voice,
                        this.frameAt(d.audioTime),
                        VoiceEvent.NoteOn,
                        d.note,
                        d.velocity ?? 0.8,
                        d.timbre ?? 0,
                        d.slide ? 1 : 0,
                        d.fine ?? 0,
                        d.morph ?? 0,
                    );
                }
                break;
            case 'noteOff':
                if (d.note !== undefined) {
                    this.pushEvent(voice, this.frameAt(d.audioTime), VoiceEvent.NoteOff, d.note, 0);
                }
                break;
            case 'releaseAll':
                // MIDI All Notes Off on its frame: gates close, tails ring out.
                this.pushEvent(voice, this.frameAt(d.audioTime), VoiceEvent.AllNotesOff, 0, 0);
                break;
            case 'allNotesOff':
                // Transport stop: drop what is still scheduled, then fade out
                // everything sounding (2 ms) — the hard reset a part has always had.
                this.cancelNotes(voice);
                this.x.macro_all_notes_off(voice.handle);
                break;
            case 'set-param':
                if (d.paramId !== undefined && d.value !== undefined) {
                    this.pushEvent(voice, this.frameAt(d.audioTime), VoiceEvent.Param, d.paramId, d.value);
                }
                break;
            case 'set-params-now':
                // Knob moves: in effect now, and anything a note queued
                // earlier for the same param is dropped so it cannot undo them.
                if (d.params) {
                    for (let i = 0; i + 1 < d.params.length; i += 2) {
                        this.x.macro_set_param_now(voice.handle, d.params[i], d.params[i + 1]);
                    }
                }
                break;
            case 'set-params':
                if (d.params) {
                    const frame = this.frameAt(d.audioTime);
                    for (let i = 0; i + 1 < d.params.length; i += 2) {
                        this.pushEvent(voice, frame, VoiceEvent.Param, d.params[i], d.params[i + 1]);
                    }
                }
                break;
            default:
                break;
        }
    }

    // ── WASM initialization ───────────────────────────────────────────────────

    private async initializeWasm(data: MacroInitData): Promise<void> {
        if (this.initializing || this.voice) return;
        this.initializing = true;
        let handle = 0;
        try {
            // Compile/allocate/instantiate happens once per audio session; the
            // other macro part, Prophecy, the drums and the 303s reuse it.
            const native = await this.attachSession(
                {
                    wasmBytes: data.wasmBytes,
                    isThreaded: !!data.isThreaded,
                    memoryPages: data.memoryPages,
                    exportMap: data.exportMap,
                },
                data.sampleRate,
            );
            if (this.disposed) return;
            if (!native.memory) throw new Error('[Macro] No memory export/import found');

            // A hyphon_native from before the macro family has no macro_* API:
            // say so by name, the main thread substitutes and reports it.
            if (!hasMacroApi(native.exports)) {
                const missing = MACRO_REQUIRED_WASM_EXPORTS.filter((name) => typeof native.exports[name] !== 'function');
                throw new Error(
                    '[Macro] macro_* API not found in WASM exports. ' +
                    formatMissingWasmExports(native.instance.exports, missing),
                );
            }

            handle = this.x.macro_create();
            if (!handle) throw new Error('[Macro] macro_create() returned null handle (all slots in use)');
            const ok = this.x.macro_init(handle, this.rateHz, NativeVoiceProcessor.MAX_BLOCK_FRAMES);
            if (ok !== 1) throw new Error(`[Macro] macro_init() returned ${ok}`);
            this.stride = this.x.macro_stride(handle);

            this.voice = { prefix: 'macro', handle };
            console.log(`[Macro] Engine ready: handle=${handle}, sr=${this.rateHz}, stride=${this.stride}`);
            this.readyMessage.heap = native.stats;
            this.readyMessage.engineCount = this.x.macro_engine_count();
            this.port.postMessage(this.readyMessage);
        } catch (e: unknown) {
            if (handle) this.x.macro_destroy(handle);
            this.releaseSession();
            console.error('[Macro] WASM init failed:', e);
            this.errorMessage.error = e instanceof Error ? e.message : String(e);
            this.port.postMessage(this.errorMessage);
        } finally {
            this.initializing = false;
        }
    }

    /** Node teardown: the instance is shared, so hand the handle back explicitly. */
    private dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.voice) {
            try {
                this.x.macro_destroy(this.voice.handle);
            } catch (e) {
                console.warn('[Macro] macro_destroy failed:', e);
            }
            this.voice = null;
        }
        this.releaseSession();
    }

    // ── Audio render ──────────────────────────────────────────────────────────

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (this.disposed) return false;
        const output = outputs[0];
        if (!output) return true;

        const left = output[0];
        const right = output[1];
        const frames = left?.length ?? 128;
        this.beginBlock(frames);

        const voice = this.voice;
        if (!voice) {
            NativeVoiceProcessor.silence(left, right);
            return true;
        }

        this.perf.beginProcess(frames);
        try {
            this.renderVoiceStereo(voice, frames, this.stride, left, right);
        } catch (e) {
            this.processFailed(e, left, right);
        } finally {
            this.perf.endProcess();
        }
        return true;
    }
}

registerProcessor('macro-processor', MacroProcessor);
