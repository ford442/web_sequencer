// src/audio-worklets/rust-filter-processor.ts
// The "Rust filter" (#1672): one resonant LP / BP / HP RBJ biquad per node, run
// by the Rust kernel (rust-audio/, the `rflt_*` exports of public/rust_osc.wasm).
//
// A drop-in filter stage inside `Voice`, exactly like the WASM OSC filter:
// whatever oscillator engine feeds it — an OscillatorNode, a looped table, a
// Rust/C++/DWGS worklet voice — comes out filtered by the same kernel that is
// the Rust oscillator's built-in filter. The oscillator and the filter are
// independent: this node never renders a wave.
//
// The main thread compiles the module once and passes it in processorOptions, so
// every node instantiates synchronously in its constructor. Each node owns its
// instance (2 fixed pages, no imports, no growth): nodes share nothing.

import { wlog } from './wlog';
import {
    RUST_FILTER_ABI_VERSION,
    RUST_FILTER_PROCESSOR,
    clampFilterTypeId,
    filterSettingsChanged,
    hasRustFilterApi,
    type RustFilterExports,
    type RustFilterInMessage,
    type RustFilterOutMessage,
    type RustFilterProcessorOptions,
    type RustFilterSettings,
} from './rustFilter';

class RustFilterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            // The kernel clamps to [20 Hz, sampleRate / 2.1]; the ranges just bound automation.
            { name: 'cutoff', defaultValue: 20000, minValue: 0, maxValue: 96000, automationRate: 'k-rate' as const },
            { name: 'resonance', defaultValue: 0.7071, minValue: 0, maxValue: 1000, automationRate: 'k-rate' as const },
            { name: 'type', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' as const },
        ];
    }

    private x: RustFilterExports | null = null;
    private buf: Float32Array | null = null;
    private maxFrames = 0;
    private applied: RustFilterSettings | null = null;
    /** True after a block that ran real input, so a silent gap resets the state once. */
    private dirty = false;
    private disposed = false;
    private failed = false;

    constructor(options?: { processorOptions?: unknown }) {
        super();
        this.port.onmessage = (event: MessageEvent<RustFilterInMessage>) => {
            if (event.data?.type === 'dispose') this.disposed = true;
        };
        const init = (options?.processorOptions ?? {}) as Partial<RustFilterProcessorOptions>;
        this.attach(init.module);
    }

    private post(message: RustFilterOutMessage): void {
        this.port.postMessage(message);
    }

    private attach(module: WebAssembly.Module | undefined): void {
        try {
            if (!(module instanceof WebAssembly.Module)) {
                throw new Error('processorOptions.module is not a WebAssembly.Module');
            }
            const exports = new WebAssembly.Instance(module, {}).exports;
            if (!hasRustFilterApi(exports)) throw new Error('rust_osc.wasm is missing rflt_* exports');
            const abi = exports.rosc_abi_version();
            if (abi !== RUST_FILTER_ABI_VERSION) {
                throw new Error(`rust_osc.wasm ABI ${abi}, worklet expects ${RUST_FILTER_ABI_VERSION}`);
            }
            if (exports.rosc_init(sampleRate) !== 1) throw new Error(`rosc_init(${sampleRate}) refused the rate`);
            // Fixed memory: the buffer never detaches, so the view is stable.
            this.maxFrames = exports.rosc_max_frames();
            this.buf = new Float32Array(exports.memory.buffer, exports.rflt_buf_ptr(), this.maxFrames);
            this.x = exports;
            wlog(`[RustFilter] node ready: sr=${sampleRate} maxFrames=${this.maxFrames}`);
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
                x.rflt_reset();
                this.dirty = false;
            }
            return true;
        }

        const next: RustFilterSettings = {
            cutoff: parameters.cutoff[0] ?? 20000,
            resonance: parameters.resonance[0] ?? 0.7071,
            type: clampFilterTypeId(parameters.type[0]),
        };
        if (filterSettingsChanged(this.applied, next)) {
            // Refused arguments (NaN from a bad automation) leave the last coefficients.
            if (x.rflt_configure(sampleRate, next.cutoff, next.resonance, next.type) === 1) this.applied = next;
        }
        if (!this.applied) return true; // never configured: stay silent rather than pass raw audio

        const buf = this.buf!;
        for (let start = 0; start < input.length; start += this.maxFrames) {
            const n = Math.min(this.maxFrames, input.length - start);
            // Element loops, not subarray() + set(): no view allocation per block.
            for (let k = 0; k < n; k++) buf[k] = input[start + k]!;
            const done = x.rflt_process(n);
            for (let k = 0; k < done; k++) out[start + k] = buf[k]!;
        }
        this.dirty = true;
        return true;
    }
}

registerProcessor(RUST_FILTER_PROCESSOR, RustFilterProcessor);
