// The WebGPU filter's bank cache (#1675): a synchronous lookup over banks the GPU
// bakes one at a time, newest request first, a dozen kept, failures remembered.
// The kernel is in WebGpuOscillator.test.ts and tools/measure_gpu_filter.mjs; this
// is the part between it and `Voice`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebGpuFilter } from '../WebGpuFilter';
import type { FilteredBankSet } from '../WebGpuOscillator';
import {
    BANK_MIDI_HIGH,
    BANK_MIDI_LOW,
    BANK_NOTE_COUNT,
    planFilteredBank,
    quantizeGpuFilter,
    type GpuFilterSpec,
} from '../backends/gpuFilter';
import { WAVETABLE_LENGTH, planWavetableBands } from '../backends/wavetableBands';
import { midiToHz } from '../../utils/math';
import type { WaveShape } from '../../utils/waveformParser';

const SR = 48000;
const LP: GpuFilterSpec = { type: 'lp', cutoff: 1000, q: 4 };

/** A bank in which note `i`'s table is filled with `i`, so a test can tell which one it was handed. */
function makeSet(sampleRate: number, shape: WaveShape, filter: GpuFilterSpec): FilteredBankSet {
    const bands = planWavetableBands(sampleRate);
    const notes = planFilteredBank(bands);
    return {
        sampleRate,
        shape,
        filter,
        length: WAVETABLE_LENGTH,
        bands,
        notes,
        tables: notes.map((_, i) => new Float32Array(WAVETABLE_LENGTH).fill(i)),
        renderMs: 1,
    };
}

function makeCtx(sampleRate = SR) {
    const createBuffer = vi.fn((channels: number, length: number, rate: number) => {
        const data = new Float32Array(length);
        return { length, numberOfChannels: channels, sampleRate: rate, getChannelData: () => data } as unknown as AudioBuffer;
    });
    return { ctx: { sampleRate, createBuffer } as unknown as AudioContext, createBuffer };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** A GPU whose renders finish when the test says so. */
function makeEngine() {
    const pending: Array<{ args: [number, WaveShape, GpuFilterSpec]; resolve: (set: FilteredBankSet | null) => void; reject: (e: unknown) => void }> = [];
    const engine = {
        isSupported: true,
        renderFilteredBank: vi.fn((sampleRate: number, shape: WaveShape, filter: GpuFilterSpec) =>
            new Promise<FilteredBankSet | null>((resolve, reject) => {
                pending.push({ args: [sampleRate, shape, filter], resolve, reject });
            })),
    };
    /** Finish the oldest render with its bank. */
    const finish = async (set?: FilteredBankSet | null) => {
        const job = pending.shift()!;
        job.resolve(set === undefined ? makeSet(...job.args) : set);
        await settle();
    };
    return { engine, pending, finish };
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('lookup', () => {
    it('says "warming" for a bank that is not there and bakes it once, on the cache grid', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();

        const first = gpu.lookup(ctx, 'saw', LP, 261.63);
        const again = gpu.lookup(ctx, 'saw', LP, 330);
        expect(first.kind).toBe('warming');
        expect(again.kind).toBe('warming');
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(1);
        const [rate, shape, spec] = engine.renderFilteredBank.mock.calls[0];
        expect([rate, shape]).toEqual([SR, 'saw']);
        expect(spec).toEqual(quantizeGpuFilter(LP, SR).spec);

        await finish();
        await settle();
        expect(gpu.lookup(ctx, 'saw', LP, 261.63).kind).toBe('ready');
    });

    it('hands the note its own table and the pitch that table sounds at', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        gpu.lookup(ctx, 'tri', LP, 440);
        await finish();
        await settle();

        const bands = planWavetableBands(SR);
        const notes = planFilteredBank(bands);
        for (const midi of [BANK_MIDI_LOW, 36, 60, 69, 96, BANK_MIDI_HIGH]) {
            const got = gpu.lookup(ctx, 'tri', LP, midiToHz(midi));
            expect(got.kind).toBe('ready');
            if (got.kind !== 'ready') continue;
            const i = midi - BANK_MIDI_LOW;
            expect(got.render.baseFrequency).toBe(bands[notes[i].band].baseFrequency);
            expect(got.render.buffer.getChannelData(0)[0]).toBe(i);
            expect(got.render.buffer.length).toBe(WAVETABLE_LENGTH);
        }
    });

    it('serves a pitch within half a semitone from the nearest note', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        gpu.lookup(ctx, 'saw', LP, 440);
        await finish();
        await settle();
        const sharp = gpu.lookup(ctx, 'saw', LP, 440 * 2 ** (40 / 1200));
        const flat = gpu.lookup(ctx, 'saw', LP, 440 * 2 ** (-40 / 1200));
        expect(sharp.kind === 'ready' && sharp.render.buffer.getChannelData(0)[0]).toBe(69 - BANK_MIDI_LOW);
        expect(flat.kind === 'ready' && flat.render.buffer.getChannelData(0)[0]).toBe(69 - BANK_MIDI_LOW);
    });

    it('makes a note\'s AudioBuffer once, when it is first played', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx, createBuffer } = makeCtx();
        gpu.lookup(ctx, 'saw', LP, 440);
        await finish();
        await settle();
        expect(createBuffer).not.toHaveBeenCalled();

        const a = gpu.lookup(ctx, 'saw', LP, 440);
        const b = gpu.lookup(ctx, 'saw', LP, 440);
        gpu.lookup(ctx, 'saw', LP, 880);
        expect(createBuffer).toHaveBeenCalledTimes(2);
        expect(a.kind === 'ready' && b.kind === 'ready' && a.render.buffer === b.render.buffer).toBe(true);
    });

    it('shares a bank between filters in the same grid cell and separates different ones', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();

        gpu.lookup(ctx, 'saw', LP, 440);
        await finish();
        expect(gpu.lookup(ctx, 'saw', { ...LP, cutoff: 1004, q: 4.05 }, 440).kind).toBe('ready');
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(1);

        // Each of these is a different bank: none finds the one that is cached.
        const others = [
            { shape: 'sqr' as const, spec: LP },
            { shape: 'saw' as const, spec: { ...LP, cutoff: 1500 } },
            { shape: 'saw' as const, spec: { ...LP, q: 9 } },
            { shape: 'saw' as const, spec: { ...LP, type: 'hp' as const } },
        ];
        for (const other of others) expect(gpu.lookup(ctx, other.shape, other.spec, 440).kind).toBe('warming');
        // One started at once; the rest wait, and only the newest of them is kept.
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(2);
        expect(engine.renderFilteredBank.mock.calls[1][1]).toBe('sqr');
    });

    it('does not mix sample rates', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        gpu.lookup(makeCtx(48000).ctx, 'saw', LP, 440);
        await finish();
        await settle();
        expect(gpu.lookup(makeCtx(48000).ctx, 'saw', LP, 440).kind).toBe('ready');
        expect(gpu.lookup(makeCtx(44100).ctx, 'saw', LP, 440).kind).toBe('warming');
    });

    it('refuses a pitch outside the bank without baking anything, with a reason that does not name the pitch', () => {
        const { engine } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        const low = gpu.lookup(ctx, 'saw', LP, midiToHz(BANK_MIDI_LOW - 1));
        const high = gpu.lookup(ctx, 'saw', LP, midiToHz(BANK_MIDI_HIGH + 1));
        expect(low.kind).toBe('unavailable');
        expect(high.kind).toBe('unavailable');
        expect(low.kind === 'unavailable' && high.kind === 'unavailable' && low.reason === high.reason).toBe(true);
        expect(gpu.lookup(ctx, 'saw', LP, Number.NaN).kind).toBe('unavailable');
        expect(engine.renderFilteredBank).not.toHaveBeenCalled();
    });
});

describe('the device', () => {
    it('is unavailable when WebGPU is, without baking, and serves the cache again when it returns', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        gpu.lookup(ctx, 'saw', LP, 440);
        await finish();
        await settle();

        engine.isSupported = false;
        const lost = gpu.lookup(ctx, 'saw', LP, 440);
        expect(lost.kind).toBe('unavailable');
        expect(lost.kind === 'unavailable' && lost.reason).toMatch(/WebGPU is unavailable/);
        expect(gpu.unavailableReason()).not.toBeNull();
        expect(gpu.lookup(ctx, 'sqr', LP, 440).kind).toBe('unavailable');
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(1);
        await expect(gpu.warm(ctx, 'sqr', LP)).resolves.toBe(false);

        engine.isSupported = true;
        expect(gpu.unavailableReason()).toBeNull();
        expect(gpu.lookup(ctx, 'saw', LP, 440).kind).toBe('ready');
    });

    it('remembers a failed bake and retries it after the back-off', async () => {
        let clock = 1000;
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine, () => clock);
        const { ctx } = makeCtx();

        expect(gpu.lookup(ctx, 'saw', LP, 440).kind).toBe('warming');
        await finish(null);
        await settle();

        clock += 500;
        const failed = gpu.lookup(ctx, 'saw', LP, 440);
        expect(failed.kind).toBe('unavailable');
        expect(failed.kind === 'unavailable' && failed.reason).toMatch(/GPU bank render failed/);
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(1);

        clock += WebGpuFilter.RETRY_AFTER_MS;
        expect(gpu.lookup(ctx, 'saw', LP, 440).kind).toBe('warming');
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(2);
        await finish();
        await settle();
        expect(gpu.lookup(ctx, 'saw', LP, 440).kind).toBe('ready');
    });

    it('does not cache a bank with non-finite samples', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        gpu.lookup(ctx, 'saw', LP, 440);
        const bad = makeSet(SR, 'saw', quantizeGpuFilter(LP, SR).spec);
        bad.tables[10][7] = Number.NaN;
        await finish(bad);
        await settle();
        const got = gpu.lookup(ctx, 'saw', LP, 440);
        expect(got.kind).toBe('unavailable');
        expect(got.kind === 'unavailable' && got.reason).toMatch(/non-finite/);
        expect(gpu.bankCount).toBe(0);
    });

    it('survives a render that throws', async () => {
        const { engine, pending } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        gpu.lookup(ctx, 'saw', LP, 440);
        pending.shift()!.reject(new Error('device exploded'));
        await settle();
        const got = gpu.lookup(ctx, 'saw', LP, 440);
        expect(got.kind).toBe('unavailable');
        expect(got.kind === 'unavailable' && got.reason).toMatch(/device exploded/);
    });
});

describe('baking', () => {
    it('runs one bake at a time, and a newer request replaces one that is still waiting', async () => {
        const { engine, pending, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();

        const a = gpu.warm(ctx, 'saw', { ...LP, cutoff: 500 });
        const b = gpu.warm(ctx, 'saw', { ...LP, cutoff: 900 });
        const c = gpu.warm(ctx, 'saw', { ...LP, cutoff: 1500 });
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(1); // only A is on the GPU
        await expect(b).resolves.toBe(false); // superseded by C: dropped, not queued

        await finish();
        await expect(a).resolves.toBe(true);
        await settle();
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(2); // then C, never B
        expect(engine.renderFilteredBank.mock.calls[1][2].cutoff).toBeCloseTo(quantizeGpuFilter({ ...LP, cutoff: 1500 }, SR).spec.cutoff, 6);
        await finish();
        await expect(c).resolves.toBe(true);
        expect(pending).toHaveLength(0);
    });

    it('asking again for a bank in flight or queued joins it', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        const a1 = gpu.warm(ctx, 'saw', LP);
        const a2 = gpu.warm(ctx, 'saw', LP);
        const q1 = gpu.warm(ctx, 'sqr', LP);
        const q2 = gpu.warm(ctx, 'sqr', LP);
        expect(a1).toBe(a2);
        expect(q1).toBe(q2);
        await finish();
        await finish();
        await expect(Promise.all([a1, q1])).resolves.toEqual([true, true]);
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(2);
    });

    it('resolves true at once for a bank already cached', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        const p = gpu.warm(ctx, 'saw', LP);
        await finish();
        await p;
        await expect(gpu.warm(ctx, 'saw', LP)).resolves.toBe(true);
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(1);
        expect(gpu.has('saw', LP, SR)).toBe(true);
        expect(gpu.has('sqr', LP, SR)).toBe(false);
    });

    it('keeps the most recently used dozen and evicts the rest', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        const cutoffs = Array.from({ length: WebGpuFilter.MAX_BANKS + 1 }, (_, i) => 200 * 2 ** (i / 3));
        for (let i = 0; i < cutoffs.length; i++) {
            const p = gpu.warm(ctx, 'saw', { ...LP, cutoff: cutoffs[i] });
            await finish();
            await p;
            if (i === 3) gpu.lookup(ctx, 'saw', { ...LP, cutoff: cutoffs[0] }, 440); // touch the oldest: it is recent now
        }
        expect(gpu.bankCount).toBe(WebGpuFilter.MAX_BANKS);
        expect(gpu.has('saw', { ...LP, cutoff: cutoffs[0] }, SR)).toBe(true);
        expect(gpu.has('saw', { ...LP, cutoff: cutoffs[1] }, SR)).toBe(false); // the least recently used went
        expect(gpu.has('saw', { ...LP, cutoff: cutoffs[cutoffs.length - 1] }, SR)).toBe(true);
    });

    it('dispose forgets every bank, drops queued bakes, and does not let a running one repopulate', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const { ctx } = makeCtx();
        const done = gpu.warm(ctx, 'saw', LP);
        await finish();
        await done;
        expect(gpu.bankCount).toBe(1);

        const running = gpu.warm(ctx, 'sqr', LP);
        const queued = gpu.warm(ctx, 'tri', LP);
        gpu.dispose();
        expect(gpu.bankCount).toBe(0);
        await expect(queued).resolves.toBe(false);
        await finish();
        await expect(running).resolves.toBe(false);
        await settle();
        expect(gpu.bankCount).toBe(0);
        expect(engine.renderFilteredBank).toHaveBeenCalledTimes(2); // the queued bake never ran
    });

    it('a full bank is BANK_NOTE_COUNT tables', async () => {
        const { engine, finish } = makeEngine();
        const gpu = new WebGpuFilter(engine);
        const p = gpu.warm(makeCtx().ctx, 'saw', LP);
        await finish();
        await p;
        expect(BANK_NOTE_COUNT).toBe(BANK_MIDI_HIGH - BANK_MIDI_LOW + 1);
        expect(gpu.bankCount).toBe(1);
    });
});
