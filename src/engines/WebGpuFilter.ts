// @mode: bridge
// The WebGPU filter as a `Voice` filter source (#1675).
//
// The other filter sources are AudioWorklet stages: audio goes in, filtered
// audio comes out, a block at a time. A GPU cannot be one (BUILD_NOTES
// `#wgsl-gpu`: no `navigator.gpu` in a worklet scope, and a `mapAsync` readback
// is asynchronous and jittery). What a GPU is good at is the thing the `wgsl-*`
// oscillator already does — render whole tables ahead of time — so the WebGPU
// filter is a *table* filter: the kernel renders the note's shape with the
// resonant filter folded into every harmonic (`WebGpuOscillator`, `gpuFilter.ts`),
// and the voice loops that table through `playbackRate` like any `wgsl-*` note.
//
// A render is async and the note path is not, so this object is the seam:
//
//   lookup()  synchronous. A *bank* — the shape filtered for every MIDI note, for
//             one (type, cutoff, Q) — is either here (`ready`: a loop table for
//             the note) or not (`warming`, the bake is started; or `unavailable`,
//             with the reason). `Voice` plays `ready` from the table and anything
//             else through its native filter, which is the same RBJ response, so
//             a cold start changes how a note is made, not how it sounds.
//   warm()    async. Bake a bank now; the UI calls it when a filter knob moves so
//             the first note usually finds it ready.
//
// One bake runs at a time and the newest request wins, so a knob sweep costs one
// dispatch per cell of the cache grid (`quantizeGpuFilter`) it settles in, never
// a queue. Banks are kept least-recently-used, 12 at a time (~1.9 MB each).

import { engineTelemetry } from '../utils/engineTelemetry';
import type { WaveShape } from '../utils/waveformParser';
import type { FilteredBankSet, WebGpuOscillator } from './WebGpuOscillator';
import { midiToHz } from '../utils/math';
import type { LoopRender } from './backends/OscillatorBackend';
import {
    BANK_MIDI_HIGH,
    BANK_MIDI_LOW,
    nearestBankNote,
    quantizeGpuFilter,
    type GpuFilterSpec,
} from './backends/gpuFilter';

/** What a synchronous look at the bank cache found. */
export type GpuLookup =
    /** A loop table for the note, filtered for its pitch. */
    | { kind: 'ready'; render: LoopRender }
    /** No bank yet; its bake is running (or queued). Use the native filter for this note. */
    | { kind: 'warming'; key: string }
    /** The GPU filter cannot serve this note at all. */
    | { kind: 'unavailable'; reason: string };

interface Bank {
    set: FilteredBankSet;
    /** One buffer per note, made when the note is first played (a song uses few of the 116). */
    buffers: Array<AudioBuffer | undefined>;
}

interface Job {
    key: string;
    ctxSampleRate: number;
    shape: WaveShape;
    spec: GpuFilterSpec;
    promise: Promise<boolean>;
    resolve: (ok: boolean) => void;
}

/** The slice of `WebGpuOscillator` this needs (a test stands in for the rest). */
type BankEngine = Pick<WebGpuOscillator, 'isSupported' | 'renderFilteredBank'>;

export class WebGpuFilter {
    /** Banks kept (least recently used out first): ~1.9 MB each. */
    static readonly MAX_BANKS = 12;
    /** After a failed bake, how long before the same bank is tried again. */
    static readonly RETRY_AFTER_MS = 2000;

    /** Insertion order is recency order: the first key is the next to evict. */
    private readonly banks = new Map<string, Bank>();
    private readonly failures = new Map<string, { reason: string; at: number }>();
    private current: Job | null = null;
    private next: Job | null = null;
    /** Bumped by `dispose`, so a bake that was running then does not repopulate the cache. */
    private epoch = 0;

    private readonly engine: BankEngine;
    private readonly now: () => number;

    constructor(engine: BankEngine, now: () => number = () => Date.now()) {
        this.engine = engine;
        this.now = now;
    }

    /** Why the GPU filter cannot run at all right now, or null. */
    unavailableReason(): string | null {
        return this.engine.isSupported ? null : 'WebGPU is unavailable (no adapter, or the device was lost)';
    }

    /**
     * The table for a note of `frequency` filtered by `spec`, if its bank is
     * ready. Never waits: a missing bank starts its bake and says `warming`.
     */
    lookup(
        ctx: BaseAudioContext,
        shape: WaveShape,
        spec: GpuFilterSpec,
        frequency: number,
    ): GpuLookup {
        const reason = this.unavailableReason();
        if (reason) return { kind: 'unavailable', reason };

        const midi = nearestBankNote(frequency);
        if (midi === null) {
            return {
                kind: 'unavailable',
                reason: `the pitch is outside the WebGPU filter's range (${midiToHz(BANK_MIDI_LOW).toFixed(1)}–${midiToHz(BANK_MIDI_HIGH).toFixed(0)} Hz)`,
            };
        }

        const sampleRate = ctx.sampleRate;
        const { spec: onGrid, key: gridKey } = quantizeGpuFilter(spec, sampleRate);
        const key = `${shape}|${gridKey}`;

        const bank = this.banks.get(key);
        if (bank) {
            // Most recently used goes last.
            this.banks.delete(key);
            this.banks.set(key, bank);
            return { kind: 'ready', render: this.tableFor(ctx, bank, midi) };
        }

        const failure = this.failures.get(key);
        if (failure && this.now() - failure.at < WebGpuFilter.RETRY_AFTER_MS) {
            return { kind: 'unavailable', reason: failure.reason };
        }

        void this.schedule({ key, ctxSampleRate: sampleRate, shape, spec: onGrid });
        return { kind: 'warming', key };
    }

    /**
     * Bake the bank for (`shape`, `spec`) if it is not cached; resolves true when
     * it is ready. Safe to call on every knob movement: one bake runs at a time
     * and only the latest request waits behind it.
     */
    warm(ctx: BaseAudioContext, shape: WaveShape, spec: GpuFilterSpec): Promise<boolean> {
        if (this.unavailableReason()) return Promise.resolve(false);
        const { spec: onGrid, key: gridKey } = quantizeGpuFilter(spec, ctx.sampleRate);
        return this.schedule({ key: `${shape}|${gridKey}`, ctxSampleRate: ctx.sampleRate, shape, spec: onGrid });
    }

    /** True when `lookup` would find this filter's bank ready. */
    has(shape: WaveShape, spec: GpuFilterSpec, sampleRate: number): boolean {
        return this.banks.has(`${shape}|${quantizeGpuFilter(spec, sampleRate).key}`);
    }

    get bankCount(): number {
        return this.banks.size;
    }

    /** Forget every bank and any queued bake; the one running finishes and its result is dropped. */
    dispose(): void {
        this.epoch++;
        this.banks.clear();
        this.failures.clear();
        this.next?.resolve(false);
        this.next = null;
    }

    private tableFor(ctx: BaseAudioContext, bank: Bank, midi: number): LoopRender {
        const i = midi - BANK_MIDI_LOW;
        let buffer = bank.buffers[i];
        if (!buffer) {
            const samples = bank.set.tables[i];
            buffer = ctx.createBuffer(1, samples.length, bank.set.sampleRate);
            buffer.getChannelData(0).set(samples);
            bank.buffers[i] = buffer;
        }
        return { buffer, baseFrequency: bank.set.bands[bank.set.notes[i].band].baseFrequency };
    }

    private schedule(request: Omit<Job, 'promise' | 'resolve'>): Promise<boolean> {
        if (this.banks.has(request.key)) return Promise.resolve(true);
        if (this.current?.key === request.key) return this.current.promise;
        if (this.next?.key === request.key) return this.next.promise;

        let resolve!: (ok: boolean) => void;
        const promise = new Promise<boolean>((r) => { resolve = r; });
        const job: Job = { ...request, promise, resolve };
        if (!this.current) {
            void this.run(job);
        } else {
            // The newest request wins the wait; the one it replaces is dropped, not queued.
            this.next?.resolve(false);
            this.next = job;
        }
        return promise;
    }

    private async run(job: Job): Promise<void> {
        this.current = job;
        let ok = false;
        try {
            ok = await this.bake(job);
        } catch (e) {
            this.failures.set(job.key, { reason: `bank render threw: ${e instanceof Error ? e.message : String(e)}`, at: this.now() });
        } finally {
            this.current = null;
            job.resolve(ok);
        }
        const queued = this.next;
        this.next = null;
        if (!queued) return;
        if (this.banks.has(queued.key)) queued.resolve(true);
        else void this.run(queued);
    }

    private async bake(job: Job): Promise<boolean> {
        const t0 = typeof performance !== 'undefined' ? performance.now() : this.now();
        const epoch = this.epoch;
        const set = await this.engine.renderFilteredBank(job.ctxSampleRate, job.shape, job.spec);
        if (epoch !== this.epoch) return false;
        if (!set) {
            this.failures.set(job.key, { reason: 'the GPU bank render failed (see the WebGPU log)', at: this.now() });
            return false;
        }
        // A table that is not finite would be looped into the speakers.
        if (!set.tables.every((t) => t.every(Number.isFinite))) {
            this.failures.set(job.key, { reason: 'the GPU bank came back with non-finite samples', at: this.now() });
            return false;
        }
        this.failures.delete(job.key);
        this.banks.set(job.key, { set, buffers: Array.from({ length: set.tables.length }, (): AudioBuffer | undefined => undefined) });
        while (this.banks.size > WebGpuFilter.MAX_BANKS) {
            const oldest = this.banks.keys().next().value;
            if (oldest === undefined) break;
            this.banks.delete(oldest);
        }
        try {
            const ms = (typeof performance !== 'undefined' ? performance.now() : this.now()) - t0;
            engineTelemetry.recordLatency('gpu-filter-bank', ms);
        } catch {
            /* telemetry is best-effort */
        }
        return true;
    }
}
