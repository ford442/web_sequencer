// src/audio-worklets/prophecy-processor.ts
// AudioWorklet processor for the Korg Prophecy formant synthesis engine.
// Uses the prophecy_* multi-instance C API exposed by prophecy_wrapper.cpp
// inside hyphon_native.wasm, on the audio session's shared instance
// (see hyphonNativeSession.ts) — this processor owns only its handle.

import {
    formatMissingWasmExports,
    hasProphecyApi,
} from './hyphonNativeImports';
import { acquireHyphonNativeSession, type HyphonNativeSession } from './hyphonNativeSession';

// Definitions for the AudioWorklet scope
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

// Synth state (const object for erasableSyntaxOnly compatibility)
const ProphecyState = {
    UNINITIALIZED: 'uninitialized',
    INITIALIZING:  'initializing',
    READY:         'ready',
    FAILED:        'failed',
} as const;

type ProphecyStateType = typeof ProphecyState[keyof typeof ProphecyState];

class ProphecyProcessor extends AudioWorkletProcessor {
    /** Shared per-audio-session hyphon_native instance. */
    private native:         HyphonNativeSession | null = null;
    private heapFloat32:    Float32Array        | null = null;
    private detachHeapListener: (() => void) | null = null;
    private disposed = false;

    private synthState: ProphecyStateType = ProphecyState.UNINITIALIZED;

    /** Handle returned by prophecy_create(). */
    private instanceHandle: number = 0;

    /** Number of frames per process() quantum. */
    private readonly bufFrames: number = 128;

    // Error rate-limiting
    private processErrorCount    = 0;
    private allocationErrorCount = 0;

    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
    }

    // ── Message handler ───────────────────────────────────────────────────────

    private async handleMessage(event: MessageEvent): Promise<void> {
        const { type, data } = event.data;

        if (type === 'init-wasm') {
            await this.initializeWasm(data);
            return;
        }

        if (type === 'dispose') {
            this.dispose();
            return;
        }

        if (this.synthState !== ProphecyState.READY || !this.native) return;

        const exports = this.getExports();

        switch (type) {
            case 'noteOn':
                try {
                    exports.prophecy_note_on(this.instanceHandle, data.note, data.velocity);
                } catch (e) {
                    console.error('[Prophecy] noteOn error:', e);
                }
                break;

            case 'noteOff':
                try {
                    exports.prophecy_note_off(this.instanceHandle, data.note);
                } catch (e) {
                    console.error('[Prophecy] noteOff error:', e);
                }
                break;

            case 'allNotesOff':
                try {
                    exports.prophecy_all_notes_off(this.instanceHandle);
                } catch (e) {
                    console.error('[Prophecy] allNotesOff error:', e);
                }
                break;

            case 'set-param':
                try {
                    exports.prophecy_set_param(this.instanceHandle, data.paramId, data.value);
                } catch (e) {
                    console.error('[Prophecy] set-param error:', e);
                }
                break;

            default:
                break;
        }
    }

    // ── WASM initialization ───────────────────────────────────────────────────

    private async initializeWasm(data: {
        wasmBytes:   ArrayBuffer;
        sampleRate:  number;
        isThreaded:  boolean;
        variant?:    string;
        memoryPages?: number;
        exportMap?:  Record<string, string>;
    }): Promise<void> {
        if (this.synthState === ProphecyState.INITIALIZING) return;
        this.synthState = ProphecyState.INITIALIZING;

        try {
            const { wasmBytes, sampleRate, isThreaded, memoryPages, exportMap } = data;

            // Compile/allocate/instantiate happens once per audio session; the
            // second Prophecy part and every 303 voice reuse the same instance.
            const native = await acquireHyphonNativeSession(
                {
                    wasmBytes,
                    isThreaded: !!isThreaded,
                    // createHyphonMemory floors this per profile (pthread / st).
                    memoryPages,
                    exportMap,
                },
                '[Prophecy]',
            );
            if (this.disposed) return;
            this.native = native;
            this.updateHeap();
            if (!native.memory) throw new Error('[Prophecy] No memory export/import found');
            const exp = native.exports;

            // Verify the Prophecy API on *normalized* exports — release builds
            // minify the raw names (prophecy_create → V, etc.).
            if (!hasProphecyApi(exp)) {
                throw new Error(
                    '[Prophecy] prophecy_* API not found in WASM exports. ' +
                    formatMissingWasmExports(native.instance.exports, [
                        'prophecy_create',
                        'prophecy_init',
                    ]),
                );
            }

            // Create and initialise an engine instance
            this.instanceHandle = exp.prophecy_create();
            if (!this.instanceHandle) throw new Error('[Prophecy] prophecy_create() returned null handle');

            const ok = exp.prophecy_init(this.instanceHandle, sampleRate, this.bufFrames);
            if (ok !== 1) throw new Error(`[Prophecy] prophecy_init() returned ${ok}`);

            native.retain();
            const unsubscribe = native.onHeapGrow((stats) => {
                this.updateHeap();
                this.port.postMessage({ type: 'hyphon-heap', data: stats });
            });
            this.detachHeapListener = () => {
                unsubscribe();
                native.release();
            };

            this.synthState = ProphecyState.READY;
            console.log(`[Prophecy] Engine ready: handle=${this.instanceHandle}, sr=${sampleRate}`);
            this.port.postMessage({ type: 'ready', heap: native.stats });

        } catch (e: any) {
            this.destroyHandle();
            this.synthState = ProphecyState.FAILED;
            console.error('[Prophecy] WASM init failed:', e);
            this.port.postMessage({ type: 'error', error: String(e?.message ?? e) });
        }
    }

    private getExports(): Record<string, any> {
        return this.native?.exports ?? {};
    }

    private updateHeap(): void {
        const memory = this.native?.memory;
        if (memory && this.heapFloat32?.buffer !== memory.buffer) {
            this.heapFloat32 = new Float32Array(memory.buffer);
        }
    }

    private destroyHandle(): void {
        if (!this.instanceHandle) return;
        try {
            this.getExports().prophecy_destroy?.(this.instanceHandle);
        } catch (e) {
            console.warn('[Prophecy] prophecy_destroy failed:', e);
        }
        this.instanceHandle = 0;
    }

    /** Node teardown: the instance is shared, so hand the handle back explicitly. */
    private dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.destroyHandle();
        this.detachHeapListener?.();
        this.detachHeapListener = null;
        this.synthState = ProphecyState.FAILED;
        this.heapFloat32 = null;
    }

    // ── Audio render ──────────────────────────────────────────────────────────

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        if (this.disposed) return false;
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
        const channelR = output[1] ?? null;

        if (this.synthState !== ProphecyState.READY || !this.native || !this.heapFloat32) {
            channelL?.fill(0);
            channelR?.fill(0);
            return true;
        }

        try {
            const exports = this.getExports();
            const numFrames = channelL?.length ?? this.bufFrames;

            // Refresh heap view when memory grows (SharedArrayBuffer may be detached)
            this.updateHeap();

            // prophecy_process returns a pointer to the internal float buffer
            const ptr: number = exports.prophecy_process(this.instanceHandle, numFrames);

            if (!ptr) {
                if (this.allocationErrorCount++ < 5)
                    console.error('[Prophecy] prophecy_process returned null pointer');
                channelL?.fill(0);
                channelR?.fill(0);
                return true;
            }

            const offset = ptr >>> 2;  // Convert byte pointer to Float32Array index (divide by 4 bytes per float)
            const heap   = this.heapFloat32!;

            if (offset >= 0 && offset + numFrames <= heap.length) {
                for (let i = 0; i < numFrames; i++) {
                    const s = heap[offset + i];
                    if (channelL) channelL[i] = s;
                    if (channelR) channelR[i] = s;
                }
            } else {
                if (this.processErrorCount++ < 5)
                    console.error(`[Prophecy] Heap out-of-bounds: offset=${offset}, heapLen=${heap.length}`);
                channelL?.fill(0);
                channelR?.fill(0);
            }

        } catch (e: any) {
            if (this.processErrorCount++ < 5)
                console.error('[Prophecy] process() error:', e);
            channelL?.fill(0);
            channelR?.fill(0);
        }

        return true;
    }
}

registerProcessor('prophecy-processor', ProphecyProcessor);
