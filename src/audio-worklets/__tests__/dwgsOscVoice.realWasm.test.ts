/**
 * The `dwgs-*` oscillator family (#1666) on the real public/dwgs_osc.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:dwgs` (or build:native);
 * requireRepoArtifacts fails the tier closed when the binary is missing.
 *
 *   1. The module passes the release gate checker (fixed memory, no imports,
 *      scalar, exact export surface, every wave renders).
 *   2. It is what DWGS claims to be: every tonal wave is a sum of harmonics —
 *      no energy anywhere else, at any pitch — and the waves are different
 *      spectra, not one shape relabelled. Noise tracks the keyboard.
 *   3. Its timing is what the worklet relies on: every note starts at 0 after
 *      a reset, block-size independence, no NaN for hostile input.
 *   4. The offline (export) render is the live kernel, bit for bit.
 *   5. dwgs-osc-processor, run block by block as the audio thread would, opens
 *      its gate on the exact frame, resets on the edge, follows a-rate
 *      frequency, switches wave on its k-rate param, and is silent while closed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDwgsOscModule } from '../../../tools/check_dwgs_osc_module.mjs';
import { renderDwgsOscOnModule } from '../../audio/offline/OfflineDwgsOscEngine';
import { DWGS_WAVES, dwgsWaveIndex } from '../../engines/dwgsWaves';
import {
    DWGS_OSC_PROCESSOR,
    DWGS_OSC_WAVE_COUNT,
    instantiateDwgsOsc,
    type DwgsOscExports,
    type DwgsOscOutMessage,
} from '../dwgsOsc';

const WASM = join(__dirname, '../../../public/dwgs_osc.wasm');
const RATE = 48000;
const BLOCK = 128;
const NOISE = dwgsWaveIndex('noise');
const TONAL = DWGS_WAVES.map((_, i) => i).filter((i) => i !== NOISE);

const bytes = new Uint8Array(readFileSync(WASM));
const module = new WebAssembly.Module(bytes);

function instance(): DwgsOscExports {
    return instantiateDwgsOsc(module, RATE);
}

function views(x: DwgsOscExports) {
    const max = x.dwgs_max_frames();
    return {
        freq: new Float32Array(x.memory.buffer, x.dwgs_freq_ptr(), max),
        out: new Float32Array(x.memory.buffer, x.dwgs_out_ptr(), max),
    };
}

/** Render `total` frames in blocks of `sizes[i % len]`, from a reset at phase 0. */
function renderRun(
    wave: number,
    total: number,
    hzAt: ((frame: number) => number) | number,
    sizes: number[] = [BLOCK],
    x: DwgsOscExports = instance(),
): Float32Array {
    const { freq, out } = views(x);
    x.dwgs_reset(0);
    const result = new Float32Array(total);
    for (let at = 0, b = 0; at < total; b++) {
        const n = Math.min(sizes[b % sizes.length], total - at);
        const perSample = typeof hzAt === 'function';
        if (perSample) for (let i = 0; i < n; i++) freq[i] = hzAt(at + i);
        else freq[0] = hzAt;
        expect(x.dwgs_render(wave, n, perSample ? 1 : 0)).toBe(n);
        result.set(out.subarray(0, n), at);
        at += n;
    }
    return result;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
}

/** Power at an exact DFT bin (Goertzel); `x` is RATE samples long, so bins are 1 Hz. */
function binPower(x: Float32Array, hz: number): number {
    const w = (2 * Math.PI * hz) / x.length;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < x.length; i++) {
        const s0 = x[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/** Normalised power of harmonics 1..n of an integer-Hz tone one second long. */
function harmonicProfile(x: Float32Array, hz: number, n: number): number[] {
    const p = Array.from({ length: n }, (_, k) => binPower(x, hz * (k + 1)));
    const total = p.reduce((a, b) => a + b, 0);
    return p.map((v) => v / total);
}

/** Energy outside DC and the true harmonics, as a fraction of the total. */
function aliasRatio(x: Float32Array, hz: number): number {
    let total = 0;
    for (const v of x) total += v * v;
    total *= x.length;
    let harmonic = binPower(x, 0);
    for (let f = hz; f < RATE / 2; f += hz) harmonic += 2 * binPower(x, f);
    return Math.max(1e-30, (total - harmonic) / total);
}

describe('public/dwgs_osc.wasm', () => {
    it('passes the release gate checker', () => {
        expect(checkDwgsOscModule(bytes)).toEqual([]);
    });

    it('reports the wave count the UI offers', () => {
        expect(instance().dwgs_wave_count()).toBe(DWGS_WAVES.length);
        expect(DWGS_OSC_WAVE_COUNT).toBe(DWGS_WAVES.length);
    });

    it.each([110, 880, 3500])('every tonal wave at %i Hz is harmonics and nothing else', (hz) => {
        for (const wave of TONAL) {
            const ratio = aliasRatio(renderRun(wave, RATE, hz), hz);
            // Float32 output rounding is the floor (~-140 dB); a naive saw at
            // 3.5 kHz sits near -20 dB.
            expect(ratio, `${DWGS_WAVES[wave].suffix} at ${hz} Hz`).toBeLessThan(1e-10);
        }
    });

    it('the waves are distinct spectra, not one shape relabelled', () => {
        const profiles = TONAL.map((w) => harmonicProfile(renderRun(w, RATE, 100), 100, 24));
        for (let a = 0; a < profiles.length; a++) {
            for (let b = a + 1; b < profiles.length; b++) {
                const distance = profiles[a].reduce((d, v, k) => d + Math.abs(v - profiles[b][k]), 0);
                expect(distance, `${DWGS_WAVES[TONAL[a]].suffix} vs ${DWGS_WAVES[TONAL[b]].suffix}`).toBeGreaterThan(0.05);
            }
        }
        // And the recipes are what they say: the square has no even harmonics,
        // the organ stops at its 1' drawbar (plus faint leakage), the sine is one line.
        const sqr = harmonicProfile(renderRun(dwgsWaveIndex('sqr'), RATE, 100), 100, 8);
        expect(sqr[1] + sqr[3] + sqr[5] + sqr[7]).toBeLessThan(1e-12);
        const organ = harmonicProfile(renderRun(dwgsWaveIndex('organ'), RATE, 100), 100, 24);
        expect(organ.slice(16).reduce((a, b) => a + b, 0)).toBeLessThan(1e-12);
        const sine = harmonicProfile(renderRun(dwgsWaveIndex('sine'), RATE, 100), 100, 8);
        expect(sine[0]).toBeGreaterThan(1 - 1e-9);
    });

    it('noise is brighter for a higher note', () => {
        const brightness = (x: Float32Array) => {
            let d = 0;
            let e = 0;
            for (let i = 1; i < x.length; i++) {
                d += (x[i] - x[i - 1]) ** 2;
                e += x[i] * x[i];
            }
            return d / e;
        };
        expect(brightness(renderRun(NOISE, RATE / 2, 1000))).toBeGreaterThan(
            10 * brightness(renderRun(NOISE, RATE / 2, 55)),
        );
    });

    it('starts every note at 0 after a reset, whatever played before', () => {
        const x = instance();
        for (const wave of DWGS_WAVES.keys()) {
            renderRun(wave === 0 ? 1 : 0, 333, 777, [BLOCK], x); // leave it mid-note
            const note = renderRun(wave, 4, 220, [BLOCK], x);
            expect(Math.abs(note[0]), DWGS_WAVES[wave].suffix).toBeLessThan(1e-6);
        }
    });

    it('never emits NaN for hostile frequencies', () => {
        for (const hz of [Number.NaN, -1, 0, 1e9, Number.POSITIVE_INFINITY]) {
            for (const wave of [0, dwgsWaveIndex('bell'), NOISE]) {
                const out = renderRun(wave, 256, hz);
                expect(out.every(Number.isFinite), `${hz} Hz`).toBe(true);
            }
        }
    });

    it('renders the same samples whatever the block size', () => {
        for (const wave of [dwgsWaveIndex('brass'), NOISE]) {
            const glide = (i: number) => 80 * 2 ** (i / 2000);
            const ref = renderRun(wave, 4096, glide, [BLOCK]);
            expect(maxAbsDiff(renderRun(wave, 4096, glide, [1, 7, 64, 1024, 3]), ref)).toBe(0);
        }
    });

    it('the offline (export) render is the live kernel, bit for bit', () => {
        for (const wave of [dwgsWaveIndex('vox'), NOISE]) {
            const live = renderRun(wave, 3000, 196);
            const offline = renderDwgsOscOnModule(module, { wave, hz: 196, frames: 3000, sampleRate: RATE });
            expect(offline).not.toBeNull();
            expect(maxAbsDiff(offline!, live)).toBe(0);
        }
    });

    it('refuses an unusable sample rate instead of rendering garbage', () => {
        expect(() => instantiateDwgsOsc(module, 100)).toThrow(/refused the rate/);
        expect(renderDwgsOscOnModule(module, { wave: 0, hz: 440, frames: 16, sampleRate: Number.NaN })).toBeNull();
    });
});

// ── The processor, driven as the audio thread would ─────────────────────────

class FakePort {
    onmessage: ((e: MessageEvent) => unknown) | null = null;
    readonly posted: DwgsOscOutMessage[] = [];
    postMessage(msg: DwgsOscOutMessage) {
        this.posted.push(msg);
    }
}

type Processor = {
    port: FakePort;
    process: (
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ) => boolean;
};
type ProcessorCtor = new (options: { processorOptions: { module: unknown } }) => Processor;

const g = globalThis as unknown as {
    sampleRate?: number;
    AudioWorkletProcessor?: unknown;
    registerProcessor?: (name: string, ctor: ProcessorCtor) => void;
};
let Ctor: ProcessorCtor;

describe('dwgs-osc-processor on the real kernel', () => {
    beforeAll(async () => {
        g.AudioWorkletProcessor ??= class {
            readonly port = new FakePort();
        };
        const previous = g.registerProcessor;
        g.registerProcessor = (name, ctor) => {
            if (name === DWGS_OSC_PROCESSOR) Ctor = ctor;
            else previous?.(name, ctor);
        };
        g.sampleRate = RATE;
        await import('../dwgs-osc-processor');
    });

    function params(hz: Float32Array | number, gate: Float32Array | number, wave = 0) {
        const f = (v: Float32Array | number) => (typeof v === 'number' ? new Float32Array([v]) : v);
        return { frequency: f(hz), gate: f(gate), wave: new Float32Array([wave]) };
    }

    function block(node: Processor, p: Record<string, Float32Array>): Float32Array {
        const out = new Float32Array(BLOCK);
        expect(node.process([], [[out]], p)).toBe(true);
        return out;
    }

    it('instantiates synchronously from processorOptions and reports ready', () => {
        const node = new Ctor({ processorOptions: { module } });
        expect(node.port.posted).toEqual([{ type: 'ready', waves: DWGS_WAVES.length, maxFrames: 1024 }]);
    });

    it('reports an error (and stays silent) for a missing module', () => {
        const node = new Ctor({ processorOptions: { module: undefined } });
        expect(node.port.posted[0]?.type).toBe('error');
        expect(block(node, params(440, 1)).every((v) => v === 0)).toBe(true);
    });

    it('is silent with the gate closed', () => {
        const node = new Ctor({ processorOptions: { module } });
        expect(block(node, params(440, 0)).every((v) => v === 0)).toBe(true);
    });

    it('opens on the exact frame, from phase 0, and matches the kernel run alone', () => {
        const node = new Ctor({ processorOptions: { module } });
        const gate = new Float32Array(BLOCK);
        const OPEN = 37;
        gate.fill(1, OPEN);
        const organ = dwgsWaveIndex('organ');
        const out = block(node, params(1000, gate, organ));
        expect(out.subarray(0, OPEN).every((v) => v === 0)).toBe(true);
        expect(maxAbsDiff(out.subarray(OPEN), renderRun(organ, BLOCK - OPEN, 1000))).toBe(0);
    });

    it('closes mid-block and resets (noise included) when it opens again', () => {
        const node = new Ctor({ processorOptions: { module } });
        block(node, params(700, 1, NOISE)); // ring a while: phase and noise stream are mid-note
        const gate = new Float32Array(BLOCK);
        gate.fill(1, 0, 20);
        gate.fill(1, 90);
        const out = block(node, params(700, gate, NOISE));
        expect(out.subarray(20, 90).every((v) => v === 0)).toBe(true);
        expect(maxAbsDiff(out.subarray(90), renderRun(NOISE, BLOCK - 90, 700))).toBe(0);
    });

    it('follows an a-rate frequency ramp sample by sample', () => {
        const node = new Ctor({ processorOptions: { module } });
        const hz = new Float32Array(BLOCK).map((_, i) => 200 + i * 20);
        const bell = dwgsWaveIndex('bell');
        const out = block(node, params(hz, 1, bell));
        expect(maxAbsDiff(out, renderRun(bell, BLOCK, (i) => 200 + i * 20))).toBe(0);
    });

    it('clamps an out-of-range wave param to the saw instead of reading past the table', () => {
        const node = new Ctor({ processorOptions: { module } });
        const out = block(node, params(440, 1, 99));
        expect(maxAbsDiff(out, renderRun(0, BLOCK, 440))).toBe(0);
    });

    it('stops processing after dispose', () => {
        const node = new Ctor({ processorOptions: { module } });
        node.port.onmessage?.({ data: { type: 'dispose' } } as MessageEvent);
        expect(node.process([], [[new Float32Array(BLOCK)]], params(440, 1))).toBe(false);
    });
});
