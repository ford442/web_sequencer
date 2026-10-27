// src/audio-worklets/drumkit-processor.ts
// AudioWorklet for analog 808/909 drums: one drumkit_* voice (kick / snare /
// closed + open hat) on the audio session's shared hyphon_native instance.
// Triggers are pushed into the voice's native event ring and start on their
// own frame — the same clock the 303 and Prophecy voices use (#1344 P4).
// Each trigger carries its hit's pan; the kit renders planar stereo.

import { DRUMKIT_REQUIRED_WASM_EXPORTS, formatMissingWasmExports, hasDrumkitApi } from './hyphonNativeImports';
import { DrumkitEvent, VoiceEvent } from '../shared/rt/hyphonNativeExports';
import { NativeVoiceProcessor, type NativeVoiceRef } from './nativeVoiceProcessor';

/** Fields the port messages carry; each message type reads a few of them. */
interface DrumkitMessageData {
    kit?: number;
    voice?: number;
    velocity?: number;
    a?: number;
    b?: number;
    c?: number;
    d?: number;
    pan?: number;
    audioTime?: number;
}

interface DrumkitInitData {
    wasmBytes: ArrayBuffer;
    sampleRate: number;
    isThreaded: boolean;
    memoryPages?: number;
    exportMap?: Record<string, string>;
}

class DrumkitProcessor extends NativeVoiceProcessor {
    private voice: NativeVoiceRef | null = null;
    private initializing = false;
    private readonly readyMessage: { type: 'ready'; heap: unknown } = { type: 'ready', heap: undefined };
    private readonly errorMessage = { type: 'error' as const, error: '' };

    constructor() {
        super('drumkit', '[Drumkit]');
        this.port.onmessage = this.handleMessage.bind(this);
    }

    private async handleMessage(event: MessageEvent): Promise<void> {
        const { type, data } = event.data as { type: string; data?: unknown };

        if (type === 'init-wasm') {
            await this.initializeWasm(data as DrumkitInitData);
            return;
        }
        if (type === 'dispose') {
            this.dispose();
            return;
        }

        const voice = this.voice;
        if (!voice) return;
        const d = (data ?? {}) as DrumkitMessageData;

        switch (type) {
            case 'trigger':
                if (d.voice !== undefined) {
                    const frame = this.frameAt(d.audioTime);
                    // Same frame, pushed first: the trigger latches it.
                    this.pushEvent(voice, frame, DrumkitEvent.SetPan, d.voice, d.pan ?? 0);
                    this.pushEvent(
                        voice,
                        frame,
                        VoiceEvent.Trigger,
                        d.voice,
                        d.velocity ?? 1,
                        d.a ?? 0,
                        d.b ?? 0,
                        d.c ?? 0,
                        d.d ?? 0,
                    );
                }
                break;
            case 'set-kit':
                if (d.kit !== undefined) {
                    this.pushEvent(voice, this.frameAt(d.audioTime), DrumkitEvent.SetKit, d.kit, 0);
                }
                break;
            case 'allNotesOff':
                // Transport stop: drop pending hits; ringing ones decay.
                this.cancelNotes(voice);
                break;
            case 'choke-open-hat':
                this.pushEvent(voice, this.frameAt(d.audioTime), DrumkitEvent.ChokeOpenHat, 0, 0);
                break;
            default:
                break;
        }
    }

    private async initializeWasm(data: DrumkitInitData): Promise<void> {
        if (this.initializing || this.voice) return;
        this.initializing = true;
        let handle = 0;
        try {
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
            if (!native.memory) throw new Error('[Drumkit] No memory export/import found');

            if (!hasDrumkitApi(native.exports)) {
                throw new Error(
                    '[Drumkit] drumkit_* API not found in WASM exports. ' +
                    formatMissingWasmExports(native.instance.exports, [...DRUMKIT_REQUIRED_WASM_EXPORTS]),
                );
            }

            handle = this.x.drumkit_create();
            if (!handle) throw new Error('[Drumkit] drumkit_create() returned null handle');
            const ok = this.x.drumkit_init(handle, this.rateHz, NativeVoiceProcessor.MAX_BLOCK_FRAMES);
            if (ok !== 1) throw new Error(`[Drumkit] drumkit_init() returned ${ok}`);

            this.voice = { prefix: 'drumkit', handle };
            this.readyMessage.heap = native.stats;
            this.port.postMessage(this.readyMessage);
        } catch (e: unknown) {
            if (handle) this.x.drumkit_destroy(handle);
            this.releaseSession();
            console.error('[Drumkit] WASM init failed:', e);
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
                this.x.drumkit_destroy(this.voice.handle);
            } catch (e) {
                console.warn('[Drumkit] drumkit_destroy failed:', e);
            }
            this.voice = null;
        }
        this.releaseSession();
    }

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
            this.renderVoiceStereo(voice, frames, NativeVoiceProcessor.MAX_BLOCK_FRAMES, left, right);
        } catch (e) {
            this.processFailed(e, left, right);
        } finally {
            this.perf.endProcess();
        }
        return true;
    }
}

registerProcessor('drumkit-processor', DrumkitProcessor);
