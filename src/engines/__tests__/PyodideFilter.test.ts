// The Pyodide filter's table cache (#1676): synchronous lookups over a Python
// runtime that loads late. A fake runtime stands in for CPython; the numerics are
// checked against real NumPy / SciPy in src/pyodide/__tests__/filterEngine.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { PyodideFilter, type PythonRuntimeView } from '../PyodideFilter';
import { planPyodideTable } from '../backends/pyodideFilter';
import type { GpuFilterSpec } from '../backends/gpuFilter';
import type { PyodideLike } from '../../utils/pyodideBuffers';

const RATE = 48000;
const SPEC: GpuFilterSpec = { type: 'lp', cutoff: 1000, q: 2 };
const C4 = 261.63;

function makeCtx(rate = RATE) {
    return {
        sampleRate: rate,
        createBuffer: vi.fn((_ch: number, length: number, sampleRate: number) => {
            const data = new Float32Array(length);
            return { length, sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
        }),
    } as unknown as BaseAudioContext & { createBuffer: ReturnType<typeof vi.fn> };
}

/** A runtime whose `generate_filtered_table` returns what the test wants (default: a ramp of the asked length). */
function makeRuntime(impl?: (...args: unknown[]) => Float32Array | Error) {
    const setRate = vi.fn();
    const generate = vi.fn((...args: unknown[]) => {
        const out = impl ? impl(...args) : new Float32Array(args[2] as number).fill(0.25);
        if (out instanceof Error) throw out;
        return { toJs: () => out, destroy: vi.fn() };
    });
    const pyodide = {
        globals: { get: (name: string) => (name === 'set_sample_rate' ? setRate : generate) },
    } as unknown as PyodideLike;
    return { pyodide, generate, setRate };
}

function filterWith(view: PythonRuntimeView, now = () => 0) {
    return new PyodideFilter(() => view, now);
}
const ready = (pyodide: PyodideLike): PythonRuntimeView => ({ status: 'ready', pyodide, reason: null });

describe('PyodideFilter.lookup: the runtime', () => {
    it.each(['not-requested', 'loading'] as const)('says `loading` while the runtime is %s, and renders nothing', (status) => {
        const f = filterWith({ status, pyodide: null, reason: null });
        expect(f.lookup(makeCtx(), 'saw', SPEC, C4)).toEqual({ kind: 'loading' });
        expect(f.unavailableReason()).toBeNull();
    });

    it('says `unavailable` once the load failed, with the reason', () => {
        const f = filterWith({ status: 'failed', pyodide: null, reason: 'timed out' });
        const found = f.lookup(makeCtx(), 'saw', SPEC, C4);
        expect(found.kind).toBe('unavailable');
        expect((found as { reason: string }).reason).toContain('timed out');
    });

    it('sees a runtime that arrives later, without being rebuilt', () => {
        let view: PythonRuntimeView = { status: 'loading', pyodide: null, reason: null };
        const f = new PyodideFilter(() => view);
        expect(f.lookup(makeCtx(), 'saw', SPEC, C4).kind).toBe('loading');
        view = ready(makeRuntime().pyodide);
        expect(f.lookup(makeCtx(), 'saw', SPEC, C4).kind).toBe('ready');
    });
});

describe('PyodideFilter.lookup: rendering and the cache', () => {
    it('asks Python for the planned geometry, shape and filter, and returns a loop at the table\'s own pitch', () => {
        const { pyodide, generate, setRate } = makeRuntime();
        const f = filterWith(ready(pyodide));
        const ctx = makeCtx();

        const found = f.lookup(ctx, 'tri', { type: 'bp', cutoff: 1000, q: 4 }, C4);

        const plan = planPyodideTable(C4, RATE)!;
        expect(setRate).toHaveBeenCalledWith(RATE);
        const args = generate.mock.calls[0];
        expect(args.slice(0, 5)).toEqual(['tri', plan.cycles, plan.length, plan.f0, 'bp']);
        expect(Math.abs((args[5] as number) / 1000 - 1)).toBeLessThan(0.015); // on the 1/24-octave grid
        expect(Math.abs((args[6] as number) / 4 - 1)).toBeLessThan(0.05); // and the 1/8-octave Q grid
        expect(found.kind).toBe('ready');
        const render = (found as { render: { buffer: AudioBuffer; baseFrequency: number } }).render;
        expect(render.baseFrequency).toBe(plan.baseFrequency);
        expect(render.buffer.length).toBe(plan.length);
        expect(render.buffer.sampleRate).toBe(RATE);
    });

    it('maps the part\'s shape names to Python\'s (sqr → square, sin → sine)', () => {
        const { pyodide, generate } = makeRuntime();
        const f = filterWith(ready(pyodide));
        f.lookup(makeCtx(), 'sqr', SPEC, C4);
        f.lookup(makeCtx(), 'sin', SPEC, C4);
        expect(generate.mock.calls.map((c) => c[0])).toEqual(['square', 'sine']);
    });

    it('renders once per (shape, nearest note, filter cell): a hit costs no Python call', () => {
        const { pyodide, generate } = makeRuntime();
        const f = filterWith(ready(pyodide));
        const ctx = makeCtx();

        const a = f.lookup(ctx, 'saw', SPEC, C4);
        const b = f.lookup(ctx, 'saw', SPEC, C4 * 1.001); // same nearest note
        const c = f.lookup(ctx, 'saw', { ...SPEC, cutoff: 1004 }, C4); // same 1/24-octave cell
        expect(generate).toHaveBeenCalledTimes(1);
        expect((b as { render: unknown }).render).toBe((a as { render: unknown }).render);
        expect((c as { render: unknown }).render).toBe((a as { render: unknown }).render);

        f.lookup(ctx, 'saw', SPEC, C4 * 2 ** (1 / 12)); // another note
        f.lookup(ctx, 'sqr', SPEC, C4); // another shape
        f.lookup(ctx, 'saw', { ...SPEC, type: 'hp' }, C4); // another response
        f.lookup(ctx, 'saw', { ...SPEC, cutoff: 3000 }, C4); // another cutoff cell
        f.lookup(ctx, 'saw', { ...SPEC, q: 9 }, C4); // another Q cell
        expect(generate).toHaveBeenCalledTimes(6);
        expect(f.tableCount).toBe(6);
    });

    it('keeps tables per sample rate (a table is made for one)', () => {
        const { pyodide, generate } = makeRuntime();
        const f = filterWith(ready(pyodide));
        f.lookup(makeCtx(44100), 'saw', SPEC, C4);
        f.lookup(makeCtx(48000), 'saw', SPEC, C4);
        expect(generate).toHaveBeenCalledTimes(2);
    });

    it('evicts the least recently used table past MAX_TABLES', () => {
        const { pyodide, generate } = makeRuntime();
        const f = filterWith(ready(pyodide));
        const ctx = makeCtx();
        for (let i = 0; i < PyodideFilter.MAX_TABLES; i++) f.lookup(ctx, 'saw', { ...SPEC, cutoff: 100 * 2 ** (i / 24) }, C4);
        expect(f.tableCount).toBe(PyodideFilter.MAX_TABLES);
        // Touch the oldest, then add one more: the second-oldest goes, not the touched one.
        f.lookup(ctx, 'saw', { ...SPEC, cutoff: 100 }, C4);
        const before = generate.mock.calls.length;
        f.lookup(ctx, 'saw', { ...SPEC, cutoff: 100 * 2 ** (PyodideFilter.MAX_TABLES / 24) }, C4);
        expect(f.tableCount).toBe(PyodideFilter.MAX_TABLES);
        f.lookup(ctx, 'saw', { ...SPEC, cutoff: 100 }, C4);
        expect(generate.mock.calls.length).toBe(before + 1); // the touched one was still cached
    });

    it('dispose forgets every table', () => {
        const { pyodide, generate } = makeRuntime();
        const f = filterWith(ready(pyodide));
        f.lookup(makeCtx(), 'saw', SPEC, C4);
        f.dispose();
        expect(f.tableCount).toBe(0);
        f.lookup(makeCtx(), 'saw', SPEC, C4);
        expect(generate).toHaveBeenCalledTimes(2);
    });
});

describe('PyodideFilter.lookup: what it refuses to play', () => {
    it.each([5, 30000, Number.NaN, -1])('a pitch of %s Hz is unavailable, naming the range', (hz) => {
        const f = filterWith(ready(makeRuntime().pyodide));
        const found = f.lookup(makeCtx(), 'saw', SPEC, hz);
        expect(found.kind).toBe('unavailable');
        expect((found as { reason: string }).reason).toMatch(/outside the Pyodide filter's range/);
    });

    it('a Python error is unavailable with its last line, and is not retried at once', () => {
        const { pyodide, generate } = makeRuntime(() => new Error('Traceback (most recent call last):\n  File "<exec>"\nValueError: unknown filter type'));
        let t = 0;
        const f = filterWith(ready(pyodide), () => t);
        const ctx = makeCtx();

        const first = f.lookup(ctx, 'saw', SPEC, C4);
        expect(first.kind).toBe('unavailable');
        expect((first as { reason: string }).reason).toContain('ValueError: unknown filter type');
        expect((first as { reason: string }).reason).not.toContain('Traceback');

        t = 500;
        f.lookup(ctx, 'saw', SPEC, C4);
        expect(generate).toHaveBeenCalledTimes(1); // inside the retry window
        t = PyodideFilter.RETRY_AFTER_MS + 1;
        f.lookup(ctx, 'saw', SPEC, C4);
        expect(generate).toHaveBeenCalledTimes(2);
    });

    it('a table with non-finite samples is never looped', () => {
        const { pyodide } = makeRuntime((...a) => {
            const t = new Float32Array(a[2] as number);
            t[3] = Number.NaN;
            return t;
        });
        const f = filterWith(ready(pyodide));
        const ctx = makeCtx();
        const found = f.lookup(ctx, 'saw', SPEC, C4);
        expect(found.kind).toBe('unavailable');
        expect((found as { reason: string }).reason).toContain('non-finite');
        expect(ctx.createBuffer).not.toHaveBeenCalled();
        expect(f.tableCount).toBe(0);
    });

    it('an empty result is unavailable', () => {
        const { pyodide } = makeRuntime(() => new Float32Array(0));
        const found = filterWith(ready(pyodide)).lookup(makeCtx(), 'saw', SPEC, C4);
        expect(found.kind).toBe('unavailable');
        expect((found as { reason: string }).reason).toContain('no samples');
    });

    it('a recovered render clears the failure', () => {
        let fail = true;
        const { pyodide } = makeRuntime((...a) => (fail ? new Error('boom') : new Float32Array(a[2] as number)));
        let t = 0;
        const f = filterWith(ready(pyodide), () => t);
        expect(f.lookup(makeCtx(), 'saw', SPEC, C4).kind).toBe('unavailable');
        fail = false;
        t = PyodideFilter.RETRY_AFTER_MS + 1;
        expect(f.lookup(makeCtx(), 'saw', SPEC, C4).kind).toBe('ready');
    });
});
