// src/audio-worklets/prophecy-processor.ts
// AudioWorklet processor for the Korg Prophecy formant synthesis engine.
// Drives one prophecy_* voice (prophecy_wrapper.cpp) on the audio session's
// shared hyphon_native instance (see hyphonNativeSession.ts). Notes and params
// are pushed into the voice's native event ring and land on their own frame
// (#1344 P4 — they used to apply whenever the message arrived).

import { formatMissingWasmExports, hasProphecyApi } from './hyphonNativeImports';
import { VoiceEvent } from '../shared/rt/hyphonNativeExports';
import { NativeVoiceProcessor, type NativeVoiceRef } from './nativeVoiceProcessor';

/** Fields the port messages carry; each message type reads a few of them. */
interface ProphecyMessageData {
    note?: number;
    velocity?: number;
    audioTime?: number;
    paramId?: number;
    value?: number;
}

interface ProphecyInitData {
    wasmBytes: ArrayBuffer;
    sampleRate: number;
    isThreaded: boolean;
    variant?: string;
    memoryPages?: number;
    exportMap?: Record<string, string>;
}

class ProphecyProcessor extends NativeVoiceProcessor {
    private voice: NativeVoiceRef | null = null;
    private initializing = false;

    private readonly readyMessage: { type: 'ready'; heap: unknown } = { type: 'ready', heap: undefined };
    private readonly errorMessage = { type: 'error' as const, error: '' };

    constructor() {
        super('prophecy', '[Prophecy]');
        this.port.onmessage = this.handleMessage.bind(this);
    }

    // ── Message handler ───────────────────────────────────────────────────────

    private async handleMessage(event: MessageEvent): Promise<void> {
        const { type, data } = event.data as { type: string; data?: unknown };

        if (type === 'init-wasm') {
            await this.initializeWasm(data as ProphecyInitData);
            return;
        }
        if (type === 'dispose') {
            this.dispose();
            return;
        }

        const voice = this.voice;
        if (!voice) return;
        const d = (data ?? {}) as ProphecyMessageData;

        switch (type) {
            case 'noteOn':
                if (d.note !== undefined) {
                    this.pushEvent(voice, this.frameAt(d.audioTime), VoiceEvent.NoteOn, d.note, d.velocity ?? 0);
                }
                break;
            case 'noteOff':
                if (d.note !== undefined) {
                    this.pushEvent(voice, this.frameAt(d.audioTime), VoiceEvent.NoteOff, d.note, 0);
                }
                break;
            case 'allNotesOff':
                // Stop: drop what is still scheduled, then silence what sounds —
                // the hard reset the part has always had.
                this.cancelNotes(voice);
                this.x.prophecy_all_notes_off(voice.handle);
                break;
            case 'set-param':
                if (d.paramId !== undefined && d.value !== undefined) {
                    this.pushEvent(voice, this.frameAt(d.audioTime), VoiceEvent.Param, d.paramId, d.value);
                }
                break;
            default:
                break;
        }
    }

    // ── WASM initialization ───────────────────────────────────────────────────

    private async initializeWasm(data: ProphecyInitData): Promise<void> {
        if (this.initializing || this.voice) return;
        this.initializing = true;
        let handle = 0;
        try {
            // Compile/allocate/instantiate happens once per audio session; the
            // second Prophecy part, the drums and every 303 voice reuse it.
            const native = await this.attachSession(
                {
                    wasmBytes: data.wasmBytes,
                    isThreaded: !!data.isThreaded,
                    // createHyphonMemory floors this per profile (pthread / st).
                    memoryPages: data.memoryPages,
                    exportMap: data.exportMap,
                },
                data.sampleRate,
            );
            if (this.disposed) return;
            if (!native.memory) throw new Error('[Prophecy] No memory export/import found');

            // Verify on *normalized* exports — the map resolves any renamed export.
            if (!hasProphecyApi(native.exports)) {
                throw new Error(
                    '[Prophecy] prophecy_* API not found in WASM exports. ' +
                    formatMissingWasmExports(native.instance.exports, ['prophecy_create', 'prophecy_render']),
                );
            }

            handle = this.x.prophecy_create();
            if (!handle) throw new Error('[Prophecy] prophecy_create() returned null handle');
            const ok = this.x.prophecy_init(handle, this.rateHz, NativeVoiceProcessor.MAX_BLOCK_FRAMES);
            if (ok !== 1) throw new Error(`[Prophecy] prophecy_init() returned ${ok}`);

            this.voice = { prefix: 'prophecy', handle };
            console.log(`[Prophecy] Engine ready: handle=${handle}, sr=${this.rateHz}`);
            this.readyMessage.heap = native.stats;
            this.port.postMessage(this.readyMessage);
        } catch (e: unknown) {
            if (handle) this.x.prophecy_destroy(handle);
            this.releaseSession();
            console.error('[Prophecy] WASM init failed:', e);
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
                this.x.prophecy_destroy(this.voice.handle);
            } catch (e) {
                console.warn('[Prophecy] prophecy_destroy failed:', e);
            }
            this.voice = null;
        }
        this.releaseSession();
    }

    // ── Audio render ──────────────────────────────────────────────────────────

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
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
            this.renderVoice(voice, frames, left, right);
        } catch (e) {
            this.processFailed(e, left, right);
        } finally {
            this.perf.endProcess();
        }
        return true;
    }
}

registerProcessor('prophecy-processor', ProphecyProcessor);
