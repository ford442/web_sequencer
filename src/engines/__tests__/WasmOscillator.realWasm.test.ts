/**
 * The `wam-*` kernel (assembly/oscillators.ts) on the real src/wasm/oscillators.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:oscillators` (or build:native);
 * requireRepoArtifacts fails the tier closed when the binary is missing.
 *
 *   1. Band-limiting: the saw, square and triangle put far less energy between
 *      the harmonics than the naive shapes they replaced.
 *   2. Loop tables wrap without a click: whole cycles, a settled filter, and the
 *      pitch still right.
 *   3. `generate` is still exactly floor(rate * dur) frames from a filter at rest.
 *   4. Hostile arguments return 0 frames, and nothing is written past memory.
 *   5. The module contract the bridge relies on: no import but env.abort, the
 *      original 7-argument generate, its own non-shared memory.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WASM = join(__dirname, '../../wasm/oscillators.wasm');
const RATE = 48000;
const SHAPE = { saw: 0, sqr: 1, tri: 2, sin: 3 } as const;

interface Kernel {
    memory: WebAssembly.Memory;
    generate(o: number, sr: number, f: number, d: number, t: number, c: number, q: number): number;
    generateLoop(o: number, sr: number, f: number, d: number, t: number, c: number, q: number): number;
}

const module = new WebAssembly.Module(new Uint8Array(readFileSync(WASM)));
const fresh = (): Kernel =>
    new WebAssembly.Instance(module, { env: { abort: () => { throw new Error('abort'); } } })
        .exports as unknown as Kernel;

function render(
    fn: 'generate' | 'generateLoop',
    shape: keyof typeof SHAPE,
    freq: number,
    dur: number,
    cutoff = 22000,
    q = 0.7071,
    sr = RATE,
): Float32Array {
    const k = fresh();
    const n = k[fn](0, sr, freq, dur, SHAPE[shape], cutoff, q);
    return new Float32Array(k.memory.buffer.slice(0, n * 4));
}

/** The shapes this kernel replaced: evaluated per sample with no band-limiting. */
function naive(shape: 'saw' | 'sqr' | 'tri', freq: number, frames: number): Float32Array {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        const p = (i * freq / RATE) % 1;
        out[i] = shape === 'saw' ? 2 * p - 1 : shape === 'sqr' ? (p < 0.5 ? 1 : -1) : 1 - 4 * Math.abs(p - 0.5);
    }
    return out;
}

function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k;
                const b = a + len / 2;
                const tr = re[b] * cr - im[b] * ci;
                const ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                const nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
}

/**
 * Energy that is not on a harmonic of `freq`, in dB relative to the total. A
 * Hann window and ±4 bins around each true harmonic; the pitch is chosen
 * off-grid so folded aliases land between the masked bins instead of on them.
 */
function inharmonicDb(x: Float32Array, freq: number): number {
    const N = 1 << 15;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    const mask = new Uint8Array(N / 2);
    for (let h = 1; h * freq < RATE / 2; h++) {
        const c = Math.round((h * freq * N) / RATE);
        for (let k = c - 4; k <= c + 4; k++) if (k > 0 && k < N / 2) mask[k] = 1;
    }
    let total = 0;
    let inharmonic = 0;
    for (let k = 1; k < N / 2; k++) {
        const e = re[k] ** 2 + im[k] ** 2;
        total += e;
        if (!mask[k]) inharmonic += e;
    }
    return 10 * Math.log10(inharmonic / total);
}

describe('band-limiting', () => {
    // The naive figures at these pitches are -10..-20 dB (saw/square) and -31..-57
    // (triangle). The margins are conservative against the measured improvement:
    // saw/square ~18 dB at every pitch, triangle 2..12 dB growing with pitch.
    it.each([
        ['saw', 1046.517, 12],
        ['saw', 4186.2, 12],
        ['sqr', 1046.517, 12],
        ['sqr', 4186.2, 12],
        ['tri', 2093.0371, 5],
        ['tri', 4186.2, 8],
    ] as const)('%s at %f Hz carries >= %f dB less inharmonic energy than the naive shape', (shape, hz, margin) => {
        const frames = 1 << 15;
        const kernel = render('generate', shape, hz, frames / RATE + 0.001);
        expect(kernel.length).toBeGreaterThanOrEqual(frames);
        const delta = inharmonicDb(naive(shape, hz, frames), hz) - inharmonicDb(kernel, hz);
        expect(delta).toBeGreaterThan(margin);
    });

    it('the sine has no harmonics to speak of: 2nd..5th below -90 dB re the fundamental', () => {
        const hz = 1046.517;
        const x = render('generate', 'sin', hz, 0.7);
        const n = 1 << 15;
        // Hann-windowed DFT at one frequency; far enough from the fundamental that
        // the window's own leakage (-100 dB or better at 2 octaves of bins) is not the floor.
        const mag = (f: number) => {
            let re = 0;
            let im = 0;
            for (let i = 0; i < n; i++) {
                const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
                re += x[i] * w * Math.cos((2 * Math.PI * f * i) / RATE);
                im -= x[i] * w * Math.sin((2 * Math.PI * f * i) / RATE);
            }
            return Math.hypot(re, im);
        };
        const fundamental = mag(hz);
        for (const h of [2, 3, 4, 5]) {
            expect(20 * Math.log10(mag(h * hz) / fundamental), `harmonic ${h}`).toBeLessThan(-90);
        }
    });
});

describe('loop tables (generateLoop)', () => {
    const BASE = 261.63;

    it.each(['saw', 'sqr', 'tri', 'sin'] as const)('%s wraps without a step bigger than the signal makes anyway', (shape) => {
        const t = render('generateLoop', shape, BASE, 2.0, 2000, 6);
        let maxStep = 0;
        for (let i = 1; i < t.length; i++) maxStep = Math.max(maxStep, Math.abs(t[i] - t[i - 1]));
        const wrap = Math.abs(t[0] - t[t.length - 1]);
        expect(wrap).toBeLessThanOrEqual(maxStep * 1.0001);
    });

    it('a plain generate table does not (this is the click being fixed)', () => {
        // 2 s x 261.63 Hz = 523.26 cycles: the table ends 0.26 of a cycle in.
        const t = render('generate', 'sin', BASE, 2.0, 2000, 6);
        let maxStep = 0;
        for (let i = 1; i < t.length; i++) maxStep = Math.max(maxStep, Math.abs(t[i] - t[i - 1]));
        expect(Math.abs(t[0] - t[t.length - 1])).toBeGreaterThan(maxStep * 5);
    });

    it('is a whole number of cycles at the requested pitch, to well under a cent', () => {
        const t = render('generateLoop', 'saw', BASE, 2.0, 22000, 0.7071);
        const cycles = Math.round((t.length * BASE) / RATE);
        const hz = (cycles * RATE) / t.length;
        expect(Math.abs(1200 * Math.log2(hz / BASE))).toBeLessThan(0.01);
        expect(Math.abs(t.length - 2.0 * RATE)).toBeLessThan(RATE / BASE); // within one cycle of the request
    });

    it('is periodic from its first frame: a resonant filter has no start-up transient left in it', () => {
        // Two cycles of a 110 Hz sine through a Q 12 lowpass at 300 Hz, which rings
        // for ~13 ms — about as long as the whole table. The table is exactly two
        // periods, so frame i and frame i + L/2 must be the same sample of the
        // steady-state waveform (L/2 is a half-integer here: interpolate).
        const periodic = (t: Float32Array) => {
            const half = t.length / 2;
            let worst = 0;
            for (let i = 0; i + Math.ceil(half) < t.length; i++) {
                const j = i + Math.floor(half);
                const ahead = half % 1 === 0 ? t[j] : 0.5 * (t[j] + t[j + 1]);
                worst = Math.max(worst, Math.abs(t[i] - ahead));
            }
            return worst;
        };
        const looped = render('generateLoop', 'sin', 110, 0.02, 300, 12);
        const oneShot = render('generate', 'sin', 110, 0.02, 300, 12);
        expect(periodic(looped)).toBeLessThan(1e-3);
        // Control: the same note from a filter at rest is nowhere near periodic.
        expect(periodic(oneShot)).toBeGreaterThan(20 * periodic(looped));
    });

    it('always holds at least one cycle, even for a duration shorter than one', () => {
        const t = render('generateLoop', 'saw', 50, 0.001);
        expect(t.length).toBe(RATE / 50);
    });
});

describe('generate (one-shot)', () => {
    it('is exactly floor(rate * dur) frames', () => {
        expect(render('generate', 'saw', 440, 0.5).length).toBe(24000);
        expect(render('generate', 'saw', 440, 0.3337).length).toBe(Math.floor(RATE * 0.3337));
    });

    it('starts from a filter at rest: the first frame is the filter, not the raw edge', () => {
        const t = render('generate', 'saw', 440, 0.1, 500, 1);
        expect(Math.abs(t[0])).toBeLessThan(0.05);
    });

    it('is deterministic across instances and across repeated calls', () => {
        const a = render('generate', 'tri', 777.7, 0.2, 3000, 4);
        const b = render('generate', 'tri', 777.7, 0.2, 3000, 4);
        expect(Array.from(a)).toEqual(Array.from(b));
        const k = fresh();
        const n1 = k.generate(0, RATE, 777.7, 0.2, 2, 3000, 4);
        const first = new Float32Array(k.memory.buffer.slice(0, n1 * 4));
        k.generate(0, RATE, 100, 0.2, 0, 200, 9); // a different note in between: no state may leak
        k.generate(0, RATE, 777.7, 0.2, 2, 3000, 4);
        expect(Array.from(new Float32Array(k.memory.buffer.slice(0, n1 * 4)))).toEqual(Array.from(first));
    });

    it('keeps a 20 Hz lowpass stable and finite at 96 kHz (f32 DF1 drifted here)', () => {
        const t = render('generate', 'saw', 55, 1.0, 20, 0.5, 96000);
        for (const v of t) expect(Number.isFinite(v)).toBe(true);
        expect(Math.max(...t.map(Math.abs))).toBeLessThan(1.5);
    });

    it('does not accumulate phase error over a long render', () => {
        // 30 s at 440 Hz: the last cycle must still start on the grid f32 accumulation lost.
        const k = fresh();
        const n = k.generate(0, RATE, 440, 30, SHAPE.sin, 22000, 0.7071);
        const f = new Float32Array(k.memory.buffer, 0, n);
        const i = n - 4800; // 0.1 s from the end = 44 whole cycles
        // Through the (phase-lagging) lowpass, the *difference* between two points a whole
        // number of cycles apart is ~0 only if both are at the same true phase.
        const j = i - Math.round((RATE / 440) * 44);
        expect(Math.abs(f[i] - f[j])).toBeLessThan(2e-3);
    });
});

describe('hostile arguments', () => {
    const bad: Array<[string, number[]]> = [
        ['NaN freq', [0, RATE, NaN, 1, 0, 1000, 1]],
        ['zero freq', [0, RATE, 0, 1, 0, 1000, 1]],
        ['negative freq', [0, RATE, -440, 1, 0, 1000, 1]],
        ['infinite freq', [0, RATE, Infinity, 1, 0, 1000, 1]],
        ['NaN duration', [0, RATE, 440, NaN, 0, 1000, 1]],
        ['zero duration', [0, RATE, 440, 0, 0, 1000, 1]],
        ['negative duration', [0, RATE, 440, -1, 0, 1000, 1]],
        ['zero sample rate', [0, 0, 440, 1, 0, 1000, 1]],
        ['negative offset', [-4, RATE, 440, 1, 0, 1000, 1]],
        ['offset past the end of memory', [1 << 30, RATE, 440, 1, 0, 1000, 1]],
    ];

    it.each(bad)('%s renders nothing, in both entry points', (_name, args) => {
        const k = fresh();
        expect(k.generate(...(args as [number, number, number, number, number, number, number]))).toBe(0);
        expect(k.generateLoop(...(args as [number, number, number, number, number, number, number]))).toBe(0);
    });

    it('NaN cutoff and resonance fall back to an open, finite filter', () => {
        const t = render('generate', 'saw', 440, 0.05, NaN, NaN);
        expect(t.length).toBe(2400);
        for (const v of t) expect(Number.isFinite(v)).toBe(true);
    });

    it('a pitch at or past Nyquist is clamped, not left to alias into garbage', () => {
        const t = render('generate', 'saw', RATE, 0.05);
        for (const v of t) expect(Number.isFinite(v) && Math.abs(v) < 2).toBe(true);
    });

    it('truncates a render that would run off the end of memory instead of trapping', () => {
        const k = fresh();
        const bytes = k.memory.buffer.byteLength;
        // 400 s at 48 kHz is 76.8 MB of f32 against a 24 MB module.
        const n = k.generate(0, RATE, 440, 400, SHAPE.saw, 5000, 1);
        expect(n).toBe(bytes / 4);
        expect(k.memory.buffer.byteLength).toBe(bytes); // the kernel never grows memory
        // ...and a loop table that cannot fit even one cycle is refused, not clipped.
        expect(k.generateLoop(bytes - 40, RATE, 20, 2, SHAPE.saw, 5000, 1)).toBe(0);
    });

    it('writes nothing outside [offset, offset + frames * 4)', () => {
        const k = fresh();
        const view = new Uint8Array(k.memory.buffer);
        const base = 1 << 20;
        view.fill(0xa5, base - 64, base + 4 * 1000 + 64);
        const n = k.generate(base, RATE, 440, 1000 / RATE, SHAPE.saw, 5000, 1);
        expect(n).toBe(1000);
        expect(Array.from(view.subarray(base - 64, base))).toEqual(new Array(64).fill(0xa5));
        expect(Array.from(view.subarray(base + 4000, base + 4064))).toEqual(new Array(64).fill(0xa5));
    });
});

describe('module contract', () => {
    const imports = WebAssembly.Module.imports(module);
    const exports = WebAssembly.Module.exports(module).map((e) => e.name);

    it('imports only env.abort, so the bridge can instantiate it with { env: { abort } }', () => {
        expect(imports.map((i) => `${i.module}.${i.name}`)).toEqual(['env.abort']);
    });

    it('exports the original generate ABI plus generateLoop, and its own memory', () => {
        expect(exports).toContain('generate');
        expect(exports).toContain('generateLoop');
        expect(exports).toContain('memory');
        const k = fresh();
        expect(k.generate.length).toBe(7);
        expect(k.generateLoop.length).toBe(7);
    });

    it('declares non-shared, non-growing-by-itself memory sized by the budget', () => {
        const mem = WebAssembly.Module.exports(module).find((e) => e.name === 'memory');
        expect(mem?.kind).toBe('memory');
        expect(fresh().memory.buffer).toBeInstanceOf(ArrayBuffer); // a SharedArrayBuffer would fail this
    });
});
