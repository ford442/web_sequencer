// src/audio-worklets/cpp-osc-processor.ts
// The `cpp-*` oscillator family (#1665): one band-limited voice of the C++
// kernel (emscripten/cpp_osc.cpp, public/cpp_osc.wasm) per node.
//
// The main thread compiles the module once and passes it in processorOptions,
// so every voice is instantiated synchronously in the constructor and plays
// from its first block. Each node owns its instance (2 fixed pages, no
// imports): voices share nothing, so there is no session or handle table.
//
// The node is a drop-in for an OscillatorNode inside `Voice`: an a-rate
// `frequency` (Hz), a k-rate `shape` and an a-rate `gate`. A closed gate writes
// nothing — outputs arrive zeroed — so an idle voice costs one branch per block.
// The kernel's output is the band-limited wave delayed by `cosc_latency()`
// samples (16): a gate-open edge resets the phase and the delay line, and the
// onset itself is band-limited inside the kernel.

import { wlog } from './wlog';
import {
    CPP_OSC_PROCESSOR,
    gateOpenAt,
    gateRunEnd,
    instantiateCppOsc,
    type CppOscInMessage,
    type CppOscInstance,
    type CppOscOutMessage,
    type CppOscProcessorOptions,
} from './cppOsc';

class CppOscProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            // Upper bound is generous; the kernel clamps the increment to Nyquist.
            { name: 'frequency', defaultValue: 440, minValue: 0, maxValue: 96000, automationRate: 'a-rate' as const },
            { name: 'shape', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' as const },
            { name: 'gate', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' as const },
        ];
    }

    private x: CppOscInstance | null = null;
    private freqIn: Float32Array | null = null;
    private out: Float32Array | null = null;
    private maxFrames = 0;
    /** Gate state at the end of the previous run, for the phase-reset edge. */
    private open = false;
    private disposed = false;
    private failed = false;

    constructor(options?: { processorOptions?: unknown }) {
        super();
        this.port.onmessage = (event: MessageEvent<CppOscInMessage>) => {
            if (event.data?.type === 'dispose') this.disposed = true;
        };
        const init = (options?.processorOptions ?? {}) as Partial<CppOscProcessorOptions>;
        this.attach(init.module);
    }

    private post(message: CppOscOutMessage): void {
        this.port.postMessage(message);
    }

    private attach(module: WebAssembly.Module | undefined): void {
        try {
            if (!(module instanceof WebAssembly.Module)) {
                throw new Error('processorOptions.module is not a WebAssembly.Module');
            }
            const exports = instantiateCppOsc(module, sampleRate);
            // Fixed memory: the buffer never detaches, so the views are stable.
            this.maxFrames = exports.cosc_max_frames();
            this.freqIn = new Float32Array(exports.memory.buffer, exports.cosc_freq_ptr(), this.maxFrames);
            this.out = new Float32Array(exports.memory.buffer, exports.cosc_out_ptr(), this.maxFrames);
            this.x = exports;
            const latency = exports.cosc_latency();
            wlog(`[CppOsc] voice ready: sr=${sampleRate} latency=${latency} maxFrames=${this.maxFrames}`);
            this.post({ type: 'ready', latency, maxFrames: this.maxFrames });
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
                    x.cosc_reset(0);
                    this.open = true;
                }
                this.render(x, shape, freq, channel, start, end);
            }
            start = end;
        }
        return true;
    }

    private render(
        x: CppOscInstance,
        shape: number,
        freq: Float32Array,
        channel: Float32Array,
        start: number,
        end: number,
    ): void {
        const freqIn = this.freqIn!;
        const out = this.out!;
        const perSample = freq.length > 1;
        if (!perSample) freqIn[0] = freq[0];
        for (let i = start; i < end; ) {
            const n = Math.min(this.maxFrames, end - i);
            // Element loops, not subarray() + set(): no view allocation per block.
            if (perSample) for (let k = 0; k < n; k++) freqIn[k] = freq[i + k];
            const done = x.cosc_render(shape, n, perSample ? 1 : 0);
            for (let k = 0; k < done; k++) channel[i + k] = out[k];
            i += n;
        }
    }
}

registerProcessor(CPP_OSC_PROCESSOR, CppOscProcessor);
