// src/audio-worklets/drumkit-processor.ts
// AudioWorklet for analog 808/909 drums. One hyphon_native instantiate per
// kit (kick/snare/CH/OH share C handles on that instance).

import {
    DRUMKIT_REQUIRED_WASM_EXPORTS,
    HYPHON_NATIVE_MIN_MEMORY_PAGES,
    buildHyphonWasmImports,
    formatMissingWasmExports,
    hasDrumkitApi,
    normalizeWasmExports,
} from './hyphonNativeImports';
import { DrumTriggerQueue } from './drumkit/triggerQueue';

declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare const currentTime: number;

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

const DrumkitState = {
    UNINITIALIZED: 'uninitialized',
    INITIALIZING: 'initializing',
    READY: 'ready',
    FAILED: 'failed',
} as const;

type DrumkitStateType = (typeof DrumkitState)[keyof typeof DrumkitState];

class DrumkitProcessor extends AudioWorkletProcessor {
    private wasmInstance: WebAssembly.Instance | null = null;
    private normalizedExports: Record<string, unknown> | null = null;
    private importedMemory: WebAssembly.Memory | null = null;
    private heapFloat32: Float32Array | null = null;
    private synthState: DrumkitStateType = DrumkitState.UNINITIALIZED;
    private isThreaded = false;
    private instanceHandle = 0;
    private readonly bufFrames = 128;
    private processErrorCount = 0;
    private allocationErrorCount = 0;
    private readonly triggers = new DrumTriggerQueue();

    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
    }

    private async handleMessage(event: MessageEvent): Promise<void> {
        const { type, data } = event.data;

        if (type === 'init-wasm') {
            await this.initializeWasm(data);
            return;
        }

        if (this.synthState !== DrumkitState.READY || !this.wasmInstance) return;

        const exports = this.getExports();

        switch (type) {
            case 'set-kit':
                try {
                    exports.drumkit_set_kit(this.instanceHandle, data.kit);
                } catch (e) {
                    console.error('[Drumkit] set-kit error:', e);
                }
                break;
            case 'trigger': {
                const audioTime = typeof data.audioTime === 'number' ? data.audioTime : 0;
                const entry = {
                    audioTime,
                    voice: data.voice,
                    velocity: data.velocity ?? 1,
                    a: data.a ?? 0,
                    b: data.b ?? 0,
                    c: data.c ?? 0,
                    d: data.d ?? 0,
                };
                if (typeof currentTime !== 'undefined' && audioTime <= currentTime) {
                    this.applyTrigger(exports, entry);
                } else {
                    this.triggers.schedule(entry);
                }
                break;
            }
            case 'choke-open-hat':
                try {
                    exports.drumkit_choke_open_hat(this.instanceHandle);
                } catch (e) {
                    console.error('[Drumkit] choke error:', e);
                }
                break;
            default:
                break;
        }
    }

    private applyTrigger(
        exports: Record<string, any>,
        entry: { voice: number; velocity: number; a: number; b: number; c: number; d: number },
    ): void {
        exports.drumkit_trigger(
            this.instanceHandle,
            entry.voice,
            entry.velocity,
            entry.a,
            entry.b,
            entry.c,
            entry.d,
        );
    }

    private async initializeWasm(data: {
        wasmBytes: ArrayBuffer;
        sampleRate: number;
        isThreaded: boolean;
        variant?: string;
        memoryPages?: number;
        exportMap?: Record<string, string>;
    }): Promise<void> {
        if (this.synthState === DrumkitState.INITIALIZING) return;
        this.synthState = DrumkitState.INITIALIZING;

        try {
            const { wasmBytes, sampleRate, isThreaded, memoryPages, exportMap } = data;
            this.isThreaded = !!isThreaded;

            const module = await WebAssembly.compile(wasmBytes);
            const importCtx = {
                getWasmInstance: () => this.wasmInstance,
                getImportedMemory: () => this.importedMemory,
                setImportedMemory: (m: WebAssembly.Memory) => {
                    this.importedMemory = m;
                },
                onHeapUpdate: () => this.updateHeap(),
                logPrefix: '[Drumkit]',
            };

            const { imports, memory } = buildHyphonWasmImports(module, importCtx, {
                memoryPages: memoryPages ?? HYPHON_NATIVE_MIN_MEMORY_PAGES,
                isThreaded: this.isThreaded,
            });

            const instance = await WebAssembly.instantiate(module, imports);
            this.wasmInstance = instance;
            this.normalizedExports = normalizeWasmExports(instance.exports, exportMap ?? {});
            this.configureWasmStack();

            const exp = this.getExports();
            const instanceExp = instance.exports as Record<string, any>;
            const mem: WebAssembly.Memory =
                memory ??
                (instanceExp.memory as WebAssembly.Memory) ??
                this.importedMemory;
            if (!mem) throw new Error('[Drumkit] No memory export/import found');
            this.importedMemory = mem;
            this.heapFloat32 = new Float32Array(mem.buffer);

            if (!hasDrumkitApi(exp)) {
                throw new Error(
                    '[Drumkit] drumkit_* API not found in WASM exports. ' +
                    formatMissingWasmExports(instance.exports, [...DRUMKIT_REQUIRED_WASM_EXPORTS]),
                );
            }

            this.instanceHandle = exp.drumkit_create();
            if (!this.instanceHandle) throw new Error('[Drumkit] drumkit_create() returned null handle');

            const ok = exp.drumkit_init(this.instanceHandle, sampleRate, this.bufFrames);
            if (ok !== 1) throw new Error(`[Drumkit] drumkit_init() returned ${ok}`);

            this.synthState = DrumkitState.READY;
            this.port.postMessage({ type: 'ready', heapCount: 1 });
        } catch (e: unknown) {
            this.synthState = DrumkitState.FAILED;
            const message = e instanceof Error ? e.message : String(e);
            console.error('[Drumkit] WASM init failed:', e);
            this.port.postMessage({ type: 'error', error: message });
        }
    }

    private getExports(): Record<string, any> {
        return (this.normalizedExports ?? {}) as Record<string, any>;
    }

    private updateHeap(): void {
        const memory =
            (this.wasmInstance?.exports as { memory?: WebAssembly.Memory } | undefined)?.memory ??
            this.importedMemory;
        if (memory) {
            this.heapFloat32 = new Float32Array(memory.buffer);
        }
    }

    private configureWasmStack(): void {
        const exports = this.getExports() as Record<string, (...args: number[]) => number>;
        if (typeof exports.emscripten_stack_init === 'function') {
            exports.emscripten_stack_init();
        }
        if (typeof exports.__wasm_call_ctors === 'function') {
            exports.__wasm_call_ctors();
        }
        if (
            typeof exports.__set_stack_limits === 'function' &&
            typeof exports.emscripten_stack_get_base === 'function'
        ) {
            const stackBase = exports.emscripten_stack_get_base();
            if (stackBase > 0) {
                exports.__set_stack_limits(stackBase, 0);
            }
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
        const channelR = output[1] ?? null;

        if (this.synthState !== DrumkitState.READY || !this.wasmInstance || !this.heapFloat32) {
            channelL?.fill(0);
            channelR?.fill(0);
            return true;
        }

        try {
            const exports = this.getExports();
            if (typeof currentTime !== 'undefined' && this.triggers.length > 0) {
                this.triggers.drain(currentTime, (entry) => this.applyTrigger(exports, entry));
            }

            const numFrames = channelL?.length ?? this.bufFrames;

            if (this.importedMemory && this.heapFloat32.buffer !== this.importedMemory.buffer) {
                this.heapFloat32 = new Float32Array(this.importedMemory.buffer);
            }

            const ptr: number = exports.drumkit_process(this.instanceHandle, numFrames);
            if (!ptr) {
                if (this.allocationErrorCount++ < 5) {
                    console.error('[Drumkit] drumkit_process returned null pointer');
                }
                channelL?.fill(0);
                channelR?.fill(0);
                return true;
            }

            const offset = ptr >>> 2;
            const heap = this.heapFloat32;

            if (offset >= 0 && offset + numFrames <= heap.length) {
                for (let i = 0; i < numFrames; i++) {
                    const s = heap[offset + i];
                    if (channelL) channelL[i] = s;
                    if (channelR) channelR[i] = s;
                }
            } else {
                if (this.processErrorCount++ < 5) {
                    console.error(`[Drumkit] Heap out-of-bounds: offset=${offset}, heapLen=${heap.length}`);
                }
                channelL?.fill(0);
                channelR?.fill(0);
            }
        } catch (e) {
            if (this.processErrorCount++ < 5) {
                console.error('[Drumkit] process() error:', e);
            }
            channelL?.fill(0);
            channelR?.fill(0);
        }

        return true;
    }
}

registerProcessor('drumkit-processor', DrumkitProcessor);
