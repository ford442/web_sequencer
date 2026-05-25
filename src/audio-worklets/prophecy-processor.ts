// src/audio-worklets/prophecy-processor.ts
// AudioWorklet processor for the Korg Prophecy formant synthesis engine.
// Uses the prophecy_* multi-instance C API exposed by prophecy_wrapper.cpp
// inside hyphon_native.wasm.

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

/** Minimum pages for the shared hyphon_native.wasm threaded build (512 MB). */
const PROPHECY_MIN_MEMORY_PAGES = 8192;

class ProphecyProcessor extends AudioWorkletProcessor {
    private wasmInstance:   WebAssembly.Instance | null = null;
    private importedMemory: WebAssembly.Memory   | null = null;
    private heapFloat32:    Float32Array         | null = null;

    private synthState: ProphecyStateType = ProphecyState.UNINITIALIZED;
    private isThreaded: boolean = false;

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

        if (this.synthState !== ProphecyState.READY || !this.wasmInstance) return;

        const exports = this.wasmInstance.exports as any;

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
    }): Promise<void> {
        if (this.synthState === ProphecyState.INITIALIZING) return;
        this.synthState = ProphecyState.INITIALIZING;

        try {
            const { wasmBytes, sampleRate, isThreaded, memoryPages } = data;
            this.isThreaded = !!isThreaded;

            let memory: WebAssembly.Memory | undefined;
            let importObject: WebAssembly.Imports;

            if (isThreaded) {
                const pages = memoryPages ?? PROPHECY_MIN_MEMORY_PAGES;
                memory = new WebAssembly.Memory({
                    initial:   pages,
                    maximum:   pages,
                    shared:    true,
                } as WebAssembly.MemoryDescriptor & { shared: boolean });

                importObject = { env: { memory } };
            } else {
                importObject = {};
            }

            const module = await WebAssembly.compile(wasmBytes);

            // Fill in all required imports from the module descriptor so the
            // instantiation does not fail due to missing symbols.
            const requiredImports = WebAssembly.Module.imports(module);
            for (const imp of requiredImports) {
                const ns = imp.module as string;
                const nm = imp.name   as string;
                if (!importObject[ns]) (importObject as any)[ns] = {};
                if ((importObject as any)[ns][nm] === undefined) {
                    switch (imp.kind) {
                        case 'function': (importObject as any)[ns][nm] = () => {}; break;
                        case 'global':   (importObject as any)[ns][nm] = new WebAssembly.Global({ value: 'i32', mutable: true }, 0); break;
                        case 'table':    (importObject as any)[ns][nm] = new WebAssembly.Table({ element: 'anyfunc', initial: 0 }); break;
                        default: break;
                    }
                }
            }

            const instance = await WebAssembly.instantiate(module, importObject);
            this.wasmInstance = instance;

            // Obtain the heap view
            const exp = instance.exports as any;
            const mem: WebAssembly.Memory = memory ?? (exp.memory as WebAssembly.Memory);
            if (!mem) throw new Error('[Prophecy] No memory export/import found');
            this.importedMemory = mem;
            this.heapFloat32    = new Float32Array(mem.buffer);

            // Verify the Prophecy API is present
            if (typeof exp.prophecy_create !== 'function' ||
                typeof exp.prophecy_init   !== 'function') {
                throw new Error('[Prophecy] prophecy_* API not found in WASM exports');
            }

            // Create and initialise an engine instance
            this.instanceHandle = exp.prophecy_create();
            if (!this.instanceHandle) throw new Error('[Prophecy] prophecy_create() returned null handle');

            const ok = exp.prophecy_init(this.instanceHandle, sampleRate, this.bufFrames);
            if (ok !== 1) throw new Error(`[Prophecy] prophecy_init() returned ${ok}`);

            this.synthState = ProphecyState.READY;
            console.log(`[Prophecy] Engine ready: handle=${this.instanceHandle}, sr=${sampleRate}`);
            this.port.postMessage({ type: 'ready' });

        } catch (e: any) {
            this.synthState = ProphecyState.FAILED;
            console.error('[Prophecy] WASM init failed:', e);
            this.port.postMessage({ type: 'error', error: String(e?.message ?? e) });
        }
    }

    // ── Audio render ──────────────────────────────────────────────────────────

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
        const channelR = output[1] ?? null;

        if (this.synthState !== ProphecyState.READY || !this.wasmInstance || !this.heapFloat32) {
            channelL?.fill(0);
            channelR?.fill(0);
            return true;
        }

        try {
            const exports = this.wasmInstance.exports as any;
            const numFrames = channelL?.length ?? this.bufFrames;

            // Refresh heap view when memory grows (SharedArrayBuffer may be detached)
            if (this.importedMemory &&
                this.heapFloat32.buffer !== this.importedMemory.buffer) {
                this.heapFloat32 = new Float32Array(this.importedMemory.buffer);
            }

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
            const heap   = this.heapFloat32;

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
