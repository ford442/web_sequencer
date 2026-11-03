// src/audio-worklets/openrb-lowpass-processor.ts
// The patch bay's "openrb" low-pass: ReBirth 2.01's PCF low-pass, run by the
// optional `openrb_lp_*` group of openrb338.wasm (GPL-3.0-only, opt-in build).
//
// The main thread compiles the module and posts it (`{ type: 'module' }`).
// Until it arrives — or if it fails the ABI check — the processor outputs
// silence and reports `unavailable`; the node's mode switch then plays the
// RBJ biquad instead (`src/audio/graph/lowpassMode.ts`).
//
// Each channel gets its own module filter. A mono input feeds both. The
// module filters in place; the processor only copies. At 44.1 kHz the output
// is ReBirth's PCF bit for bit (docs/audio-engine/openrb-lowpass.md).

import {
    OPENRB_LP_MAX_CHANNELS,
    OPENRB_LP_PARAM_IDS,
    OPENRB_LOWPASS_PROCESSOR,
    supportsOpenrbLowpass,
    type OpenrbLowpassExports,
    type OpenrbLowpassInMessage,
    type OpenrbLowpassOutMessage,
    type OpenrbLowpassProcessorOptions,
} from './openrbLowpass';

/** Frames the module buffers are sized for (render quanta are 128; leave room). */
const MAX_FRAMES = 1024;

class OpenrbLowpassProcessor extends AudioWorkletProcessor {
    private exports: OpenrbLowpassExports | null = null;
    private handles: number[] = [];
    private pointers: number[] = [];
    private cutoffHz = 2000;
    private q = 0.7;
    private outputGain = 1;

    constructor(options?: { processorOptions?: unknown }) {
        super();
        const init = (options?.processorOptions ?? {}) as OpenrbLowpassProcessorOptions;
        if (Number.isFinite(init.cutoffHz)) this.cutoffHz = init.cutoffHz as number;
        if (Number.isFinite(init.q)) this.q = init.q as number;
        if (Number.isFinite(init.outputGain)) this.outputGain = init.outputGain as number;
        this.port.onmessage = (event: MessageEvent<OpenrbLowpassInMessage>) => this.onMessage(event.data);
    }

    private post(message: OpenrbLowpassOutMessage): void {
        this.port.postMessage(message);
    }

    private onMessage(message: OpenrbLowpassInMessage): void {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'module') {
            this.attach(message.module);
            return;
        }
        if (message.type === 'set') {
            if (Number.isFinite(message.cutoffHz)) this.cutoffHz = message.cutoffHz as number;
            if (Number.isFinite(message.q)) this.q = message.q as number;
            if (Number.isFinite(message.outputGain)) this.outputGain = message.outputGain as number;
            this.pushParams();
        }
    }

    private attach(module: WebAssembly.Module): void {
        if (this.exports) return;
        let exports: unknown;
        try {
            exports = new WebAssembly.Instance(module, {}).exports;
        } catch (error) {
            this.post({ type: 'unavailable', reason: `instantiate failed: ${String(error)}` });
            return;
        }
        if (!supportsOpenrbLowpass(exports)) {
            this.post({ type: 'unavailable', reason: 'module has no openrb_lp_* group at this revision' });
            return;
        }
        const lp = exports;
        const handles: number[] = [];
        for (let c = 0; c < OPENRB_LP_MAX_CHANNELS; c++) {
            const handle = exports.openrb_lp_create(sampleRate);
            if (handle === 0) {
                for (const h of handles) exports.openrb_lp_destroy(h);
                this.post({ type: 'unavailable', reason: `openrb_lp_create(${sampleRate}) failed` });
                return;
            }
            handles.push(handle);
        }
        this.exports = exports;
        this.handles = handles;
        this.pointers = handles.map((h) => lp.openrb_lp_buffer(h, MAX_FRAMES) >>> 0);
        this.pushParams();
        this.post({ type: 'ready', bitExact: exports.openrb_lp_is_bit_exact(handles[0]) === 1 });
    }

    private pushParams(): void {
        const x = this.exports;
        if (!x) return;
        for (const h of this.handles) {
            // Q before Hz is not required (the module re-resolves both), but it
            // is the order a reader expects: the row, then the step in it.
            x.openrb_lp_set_param(h, OPENRB_LP_PARAM_IDS.q, this.q);
            x.openrb_lp_set_param(h, OPENRB_LP_PARAM_IDS.cutoffHz, this.cutoffHz);
            x.openrb_lp_set_param(h, OPENRB_LP_PARAM_IDS.outputGain, this.outputGain);
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const output = outputs[0];
        if (!output || output.length === 0) return true;
        const x = this.exports;
        if (!x) {
            for (const channel of output) channel.fill(0);
            return true;
        }
        const input = inputs[0] ?? [];
        const frames = output[0].length;
        for (let c = 0; c < output.length; c++) {
            const out = output[c];
            const handle = this.handles[c];
            if (handle === undefined) {
                out.fill(0);
                continue;
            }
            const source = input[c] ?? input[0];
            for (let start = 0; start < frames; start += MAX_FRAMES) {
                const n = Math.min(MAX_FRAMES, frames - start);
                // A fresh view per call: memory.buffer is replaced if the memory grows.
                const view = new Float32Array(x.memory.buffer, this.pointers[c], n);
                if (source) view.set(source.subarray(start, start + n));
                else view.fill(0);
                x.openrb_lp_process(handle, n);
                out.set(new Float32Array(x.memory.buffer, this.pointers[c], n), start);
            }
        }
        return true;
    }
}

registerProcessor(OPENRB_LOWPASS_PROCESSOR, OpenrbLowpassProcessor);
