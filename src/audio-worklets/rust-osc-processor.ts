// src/audio-worklets/rust-osc-processor.ts
// The `rust-*` oscillator family (#1664): one band-limited voice of the Rust
// kernel (rust-audio/, public/rust_osc.wasm) per node.
//
// The main thread compiles the module once and passes it in processorOptions,
// so every voice is instantiated synchronously in the constructor and plays
// from its first block. Each node owns its instance (2 fixed pages, no
// imports): voices share nothing, so there is no session or handle table.
//
// The node is a drop-in for an OscillatorNode inside `Voice`: an a-rate
// `frequency` (Hz), a k-rate `shape` and an a-rate `gate`. A closed gate writes
// nothing — outputs arrive zeroed — so an idle voice costs one branch per block.

import { wlog } from './wlog';
import {
    RUST_OSC_ABI_VERSION,
    RUST_OSC_PROCESSOR,
    gateOpenAt,
    gateRunEnd,
    hasRustOscApi,
    type RustOscExports,
    type RustOscInMessage,
    type RustOscOutMessage,
    type RustOscProcessorOptions,
} from './rustOsc';

class RustOscProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            // Upper bound is generous; the kernel clamps the increment to Nyquist.
            { name: 'frequency', defaultValue: 440, minValue: 0, maxValue: 96000, automationRate: 'a-rate' as const },
            { name: 'shape', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' as const },
            { name: 'gate', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' as const },
        ];
    }

    private x: RustOscExports | null = null;
    private freqIn: Float32Array | null = null;
    private out: Float32Array | null = null;
    private maxFrames = 0;
    /** Gate state at the end of the previous run, for the phase-reset edge. */
    private open = false;
    private disposed = false;
    private failed = false;

    constructor(options?: { processorOptions?: unknown }) {
        super();
        this.port.onmessage = (event: MessageEvent<RustOscInMessage>) => {
            if (event.data?.type === 'dispose') this.disposed = true;
        };
        const init = (options?.processorOptions ?? {}) as Partial<RustOscProcessorOptions>;
        this.attach(init.module);
    }

    private post(message: RustOscOutMessage): void {
        this.port.postMessage(message);
    }

    private attach(module: WebAssembly.Module | undefined): void {
        try {
            if (!(module instanceof WebAssembly.Module)) {
                throw new Error('processorOptions.module is not a WebAssembly.Module');
            }
            const exports = new WebAssembly.Instance(module, {}).exports;
            if (!hasRustOscApi(exports)) throw new Error('rust_osc.wasm is missing rosc_* exports');
            const abi = exports.rosc_abi_version();
            if (abi !== RUST_OSC_ABI_VERSION) {
                throw new Error(`rust_osc.wasm ABI ${abi}, worklet expects ${RUST_OSC_ABI_VERSION}`);
            }
            if (exports.rosc_init(sampleRate) !== 1) throw new Error(`rosc_init(${sampleRate}) refused the rate`);
            // Fixed memory: the buffer never detaches, so the views are stable.
            this.maxFrames = exports.rosc_max_frames();
            this.freqIn = new Float32Array(exports.memory.buffer, exports.rosc_freq_ptr(), this.maxFrames);
            this.out = new Float32Array(exports.memory.buffer, exports.rosc_out_ptr(), this.maxFrames);
            this.x = exports;
            const simd = exports.rosc_simd() === 1;
            wlog(`[RustOsc] voice ready: sr=${sampleRate} simd=${simd} maxFrames=${this.maxFrames}`);
            this.post({ type: 'ready', simd, maxFrames: this.maxFrames });
        } catch (e) {
            this.failed = true;
            this.post({ type: 'error', reason: e instanceof Error ? e.message : String(e) });
        }
    }

    process(
        _inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ): boolean {
        if (this.disposed) return false;
        const channel = outputs[0]?.[0];
        const x = this.x;
        if (!channel || !x || this.failed) return true;

        const frames = channel.length;
        const freq = parameters.frequency;
        const gate = parameters.gate;
        const shape = Math.min(3, Math.max(0, Math.round(parameters.shape[0] ?? 0)));

        for (let start = 0; start < frames; ) {
            const end = gateRunEnd(gate, frames, start);
            if (!gateOpenAt(gate, start)) {
                this.open = false; // the output is already zero
            } else {
                if (!this.open) {
                    x.rosc_reset(0);
                    this.open = true;
                }
                this.render(x, shape, freq, channel, start, end);
            }
            start = end;
        }
        return true;
    }

    private render(
        x: RustOscExports,
        shape: number,
        freq: Float32Array,
        channel: Float32Array,
        start: number,
        end: number,
    ): void {
        const freqIn = this.freqIn!;
        const out = this.out!;
        const perSample = freq.length > 1;
        if (!perSample) freqIn[0] = freq[0]!;
        for (let i = start; i < end; ) {
            const n = Math.min(this.maxFrames, end - i);
            // Element loops, not subarray() + set(): no view allocation per block.
            if (perSample) for (let k = 0; k < n; k++) freqIn[k] = freq[i + k]!;
            const done = x.rosc_render(shape, n, perSample ? 1 : 0);
            for (let k = 0; k < done; k++) channel[i + k] = out[k]!;
            i += n;
        }
    }
}

registerProcessor(RUST_OSC_PROCESSOR, RustOscProcessor);
