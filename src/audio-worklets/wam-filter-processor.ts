// src/audio-worklets/wam-filter-processor.ts
// The "WASM OSC filter" (#1663): one resonant LP / BP / HP biquad per node, run by
// the AssemblyScript kernel (assembly/biquad.ts, built standalone as src/wasm/wamFilter.wasm).
//
// It is a drop-in filter stage inside `Voice`: whatever oscillator engine feeds
// it — an OscillatorNode, a looped table, a Rust/C++/DWGS worklet voice — comes
// out filtered by the same kernel that filters a `wam-*` table.
//
// The main thread compiles the module once and passes it in processorOptions, so
// every node instantiates synchronously in its constructor. Each node owns its
// instance (one fixed 64 KiB page, no imports, no growth): nodes share nothing.

import { wlog } from './wlog';
import {
    WAM_FILTER_ABI_VERSION,
    WAM_FILTER_PROCESSOR,
    clampFilterTypeId,
    filterSettingsChanged,
    hasWamFilterApi,
    type WamFilterExports,
    type WamFilterInMessage,
    type WamFilterOutMessage,
    type WamFilterProcessorOptions,
    type WamFilterSettings,
} from './wamFilter';

class WamFilterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            // The kernel clamps to [20 Hz, sampleRate / 2.1]; the ranges just bound automation.
            { name: 'cutoff', defaultValue: 20000, minValue: 0, maxValue: 96000, automationRate: 'k-rate' as const },
            { name: 'resonance', defaultValue: 0.7071, minValue: 0, maxValue: 1000, automationRate: 'k-rate' as const },
            { name: 'type', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' as const },
        ];
    }

    private x: WamFilterExports | null = null;
    private inBuf: Float32Array | null = null;
    private outBuf: Float32Array | null = null;
    private maxFrames = 0;
    private applied: WamFilterSettings | null = null;
    /** True after a block that ran real input, so a silent gap resets the state once. */
    private dirty = false;
    private disposed = false;
    private failed = false;

    constructor(options?: { processorOptions?: unknown }) {
        super();
        this.port.onmessage = (event: MessageEvent<WamFilterInMessage>) => {
            if (event.data?.type === 'dispose') this.disposed = true;
        };
        const init = (options?.processorOptions ?? {}) as Partial<WamFilterProcessorOptions>;
        this.attach(init.module);
    }

    private post(message: WamFilterOutMessage): void {
        this.port.postMessage(message);
    }

    private attach(module: WebAssembly.Module | undefined): void {
        try {
            if (!(module instanceof WebAssembly.Module)) {
                throw new Error('processorOptions.module is not a WebAssembly.Module');
            }
            const exports = new WebAssembly.Instance(module, {}).exports;
            if (!hasWamFilterApi(exports)) throw new Error('wamFilter.wasm is missing its exports');
            const abi = exports.abiVersion();
            if (abi !== WAM_FILTER_ABI_VERSION) {
                throw new Error(`wamFilter.wasm ABI ${abi}, worklet expects ${WAM_FILTER_ABI_VERSION}`);
            }
            // Fixed memory (maximum = initial = 1 page): the buffer never detaches.
            this.maxFrames = exports.maxFrames();
            this.inBuf = new Float32Array(exports.memory.buffer, exports.inPtr(), this.maxFrames);
            this.outBuf = new Float32Array(exports.memory.buffer, exports.outPtr(), this.maxFrames);
            this.x = exports;
            wlog(`[WamFilter] node ready: sr=${sampleRate} maxFrames=${this.maxFrames}`);
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
                x.reset();
                this.dirty = false;
            }
            return true;
        }

        const next: WamFilterSettings = {
            cutoff: parameters.cutoff[0] ?? 20000,
            resonance: parameters.resonance[0] ?? 0.7071,
            type: clampFilterTypeId(parameters.type[0]),
        };
        if (filterSettingsChanged(this.applied, next)) {
            // Refused arguments (NaN from a bad automation) leave the last coefficients.
            if (x.configure(sampleRate, next.cutoff, next.resonance, next.type) === 1) this.applied = next;
        }
        if (!this.applied) return true; // never configured: stay silent rather than pass raw audio

        const inBuf = this.inBuf!;
        const outBuf = this.outBuf!;
        for (let start = 0; start < input.length; start += this.maxFrames) {
            const n = Math.min(this.maxFrames, input.length - start);
            // Element loops, not subarray() + set(): no view allocation per block.
            for (let k = 0; k < n; k++) inBuf[k] = input[start + k]!;
            const done = x.process(n);
            for (let k = 0; k < done; k++) out[start + k] = outBuf[k]!;
        }
        this.dirty = true;
        return true;
    }
}

registerProcessor(WAM_FILTER_PROCESSOR, WamFilterProcessor);
