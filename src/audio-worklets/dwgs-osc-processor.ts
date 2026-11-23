// src/audio-worklets/dwgs-osc-processor.ts
// The `dwgs-*` oscillator family (#1666): one voice of the DWGS additive kernel
// (dwgs-audio/, public/dwgs_osc.wasm) per node.
//
// The main thread compiles the module once and passes it in processorOptions,
// so every voice is instantiated synchronously in the constructor and plays
// from its first block. Each node owns its instance (2 fixed pages, no
// imports): voices share nothing, so there is no session or handle table.
// `dwgs_init` evaluates the harmonic recipes once per instance (~16 x 96
// amplitudes, microseconds).
//
// The node is a drop-in for an OscillatorNode inside `Voice`: an a-rate
// `frequency` (Hz), a k-rate `wave` (kernel wave id) and an a-rate `gate`. A
// closed gate writes nothing — outputs arrive zeroed — so an idle voice costs
// one branch per block. A gate-open edge resets the phase (and restarts the
// noise stream); every wave starts from 0 there, so the onset needs no fix-up.

import { wlog } from './wlog';
import {
    DWGS_OSC_PROCESSOR,
    DWGS_OSC_WAVE_COUNT,
    dwgsWaveId,
    gateOpenAt,
    gateRunEnd,
    instantiateDwgsOsc,
    type DwgsOscExports,
    type DwgsOscInMessage,
    type DwgsOscOutMessage,
    type DwgsOscProcessorOptions,
} from './dwgsOsc';

class DwgsOscProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            // Upper bound is generous; the kernel clamps the increment to Nyquist.
            { name: 'frequency', defaultValue: 440, minValue: 0, maxValue: 96000, automationRate: 'a-rate' as const },
            { name: 'wave', defaultValue: 0, minValue: 0, maxValue: DWGS_OSC_WAVE_COUNT - 1, automationRate: 'k-rate' as const },
            { name: 'gate', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' as const },
        ];
    }

    private x: DwgsOscExports | null = null;
    private freqIn: Float32Array | null = null;
    private out: Float32Array | null = null;
    private maxFrames = 0;
    /** Gate state at the end of the previous run, for the phase-reset edge. */
    private open = false;
    private disposed = false;
    private failed = false;

    constructor(options?: { processorOptions?: unknown }) {
        super();
        this.port.onmessage = (event: MessageEvent<DwgsOscInMessage>) => {
            if (event.data?.type === 'dispose') this.disposed = true;
        };
        const init = (options?.processorOptions ?? {}) as Partial<DwgsOscProcessorOptions>;
        this.attach(init.module);
    }

    private post(message: DwgsOscOutMessage): void {
        this.port.postMessage(message);
    }

    private attach(module: WebAssembly.Module | undefined): void {
        try {
            if (!(module instanceof WebAssembly.Module)) {
                throw new Error('processorOptions.module is not a WebAssembly.Module');
            }
            const exports = instantiateDwgsOsc(module, sampleRate);
            // Fixed memory: the buffer never detaches, so the views are stable.
            this.maxFrames = exports.dwgs_max_frames();
            this.freqIn = new Float32Array(exports.memory.buffer, exports.dwgs_freq_ptr(), this.maxFrames);
            this.out = new Float32Array(exports.memory.buffer, exports.dwgs_out_ptr(), this.maxFrames);
            this.x = exports;
            const waves = exports.dwgs_wave_count();
            wlog(`[DwgsOsc] voice ready: sr=${sampleRate} waves=${waves} maxFrames=${this.maxFrames}`);
            this.post({ type: 'ready', waves, maxFrames: this.maxFrames });
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
        const wave = dwgsWaveId(parameters.wave[0]);

        for (let start = 0; start < frames; ) {
            const end = gateRunEnd(gate, frames, start);
            if (!gateOpenAt(gate, start)) {
                this.open = false; // the output is already zero
            } else {
                if (!this.open) {
                    x.dwgs_reset(0);
                    this.open = true;
                }
                this.render(x, wave, freq, channel, start, end);
            }
            start = end;
        }
        return true;
    }

    private render(
        x: DwgsOscExports,
        wave: number,
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
            const done = x.dwgs_render(wave, n, perSample ? 1 : 0);
            for (let k = 0; k < done; k++) channel[i + k] = out[k];
            i += n;
        }
    }
}

registerProcessor(DWGS_OSC_PROCESSOR, DwgsOscProcessor);
