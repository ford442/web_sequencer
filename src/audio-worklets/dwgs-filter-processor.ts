// src/audio-worklets/dwgs-filter-processor.ts
// The "DWGS filter" (#1674): one resonant LP / BP / HP 4-pole ladder with
// saturated feedback per node, run by the DWGS kernel (dwgs-audio/, the
// `dflt_*` exports of public/dwgs_osc.wasm).
//
// A drop-in filter stage inside `Voice`, exactly like the WASM OSC, Rust and C++
// filters: whatever oscillator engine feeds it — an OscillatorNode, a looped
// table, a Rust/C++/DWGS worklet voice — comes out through the DWGS kernel's
// 24 dB/oct filter. The oscillator and the filter are independent: this node
// never renders a wave.
//
// The main thread compiles the module once and passes it in processorOptions, so
// every node instantiates synchronously in its constructor. Each node owns its
// instance (2 fixed pages, no imports, no growth): nodes share nothing.

import { wlog } from './wlog';
import {
    DWGS_FILTER_PROCESSOR,
    clampFilterTypeId,
    filterSettingsChanged,
    instantiateDwgsFilter,
    type DwgsFilterExports,
    type DwgsFilterInMessage,
    type DwgsFilterOutMessage,
    type DwgsFilterProcessorOptions,
    type DwgsFilterSettings,
} from './dwgsFilter';

class DwgsFilterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            // The kernel clamps to [20 Hz, sampleRate / 2.1]; the ranges just bound automation.
            { name: 'cutoff', defaultValue: 20000, minValue: 0, maxValue: 96000, automationRate: 'k-rate' as const },
            { name: 'resonance', defaultValue: 0.7071, minValue: 0, maxValue: 1000, automationRate: 'k-rate' as const },
            { name: 'type', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' as const },
        ];
    }

    private x: DwgsFilterExports | null = null;
    private buf: Float32Array | null = null;
    private maxFrames = 0;
    private applied: DwgsFilterSettings | null = null;
    /** True after a block that ran real input, so a silent gap resets the state once. */
    private dirty = false;
    private disposed = false;
    private failed = false;

    constructor(options?: { processorOptions?: unknown }) {
        super();
        this.port.onmessage = (event: MessageEvent<DwgsFilterInMessage>) => {
            if (event.data?.type === 'dispose') this.disposed = true;
        };
        const init = (options?.processorOptions ?? {}) as Partial<DwgsFilterProcessorOptions>;
        this.attach(init.module);
    }

    private post(message: DwgsFilterOutMessage): void {
        this.port.postMessage(message);
    }

    private attach(module: WebAssembly.Module | undefined): void {
        try {
            if (!(module instanceof WebAssembly.Module)) {
                throw new Error('processorOptions.module is not a WebAssembly.Module');
            }
            const exports = instantiateDwgsFilter(module);
            // The rate is the one thing the kernel would refuse; find out now, not on the first note.
            if (exports.dflt_configure(sampleRate, 20000, 0.7071, 0) !== 1) {
                throw new Error(`dflt_configure refused the rate ${sampleRate}`);
            }
            exports.dflt_reset();
            // Fixed memory: the buffer never detaches, so the view is stable.
            this.maxFrames = exports.dwgs_max_frames();
            this.buf = new Float32Array(exports.memory.buffer, exports.dflt_buf_ptr(), this.maxFrames);
            this.x = exports;
            wlog(`[DwgsFilter] node ready: sr=${sampleRate} maxFrames=${this.maxFrames}`);
            this.post({ type: 'ready', maxFrames: this.maxFrames });
        } catch (e) {
            this.failed = true;
            this.post({ type: 'error', reason: e instanceof Error ? e.message : String(e) });
        }
    }

    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ): boolean {
        if (this.disposed) return false;
        const out = outputs[0]?.[0];
        const x = this.x;
        if (!out || !x || this.failed) return true;

        const input = inputs[0]?.[0];
        if (!input) {
            // Nothing connected: output is already zero. Filter from rest when the
            // next source arrives, so a stale tail cannot ring into the next note.
            if (this.dirty) {
                x.dflt_reset();
                this.dirty = false;
            }
            return true;
        }

        const next: DwgsFilterSettings = {
            cutoff: parameters.cutoff[0] ?? 20000,
            resonance: parameters.resonance[0] ?? 0.7071,
            type: clampFilterTypeId(parameters.type[0]),
        };
        if (filterSettingsChanged(this.applied, next)) {
            // Refused arguments (NaN from a bad automation) leave the last response.
            if (x.dflt_configure(sampleRate, next.cutoff, next.resonance, next.type) === 1) this.applied = next;
        }
        if (!this.applied) return true; // never configured: stay silent rather than pass raw audio

        const buf = this.buf!;
        for (let start = 0; start < input.length; start += this.maxFrames) {
            const n = Math.min(this.maxFrames, input.length - start);
            // Element loops, not subarray() + set(): no view allocation per block.
            for (let k = 0; k < n; k++) buf[k] = input[start + k]!;
            const done = x.dflt_process(n);
            for (let k = 0; k < done; k++) out[start + k] = buf[k]!;
        }
        this.dirty = true;
        return true;
    }
}

registerProcessor(DWGS_FILTER_PROCESSOR, DwgsFilterProcessor);
