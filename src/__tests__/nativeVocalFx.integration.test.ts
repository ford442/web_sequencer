/**
 * Golden / character tests: the native singing-voice FX chain in
 * public/rubberband.wasm (emscripten/rubberband_fx.cpp) against the TS oracle
 * (src/audio-worklets/rubberband/). Agreement is within an error budget, not
 * bit-exact — see GOLDEN_TOLERANCE.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { repoRoot } from '@/test/helpers/requireRepoArtifacts';
import { NativeVocalFx, type RubberBandFxModule } from '@/audio-worklets/rubberband/nativeVocalFx';
import { TsVocalFx, type VocalFxBlock } from '@/audio-worklets/rubberband/vocalFx';
import { SpectralBandProcessor } from '@/audio-worklets/rubberband/spectralEffects';
import {
  FX_ON_BLOCK,
  QUANTUM,
  blockFor,
  compareSignals,
  loadRubberBandFxModule,
  makeVocalSignal,
  runChain,
  xorshift32,
  type FxCase,
} from '@/test/helpers/vocalFxHarness';

const SAMPLE_RATE = 48000;
const SEED = 0xC0FFEE;

/**
 * Agreed TS-oracle vs C++ error. Possible sources of difference: libm vs V8
 * trig, and the compressor's log10+pow folded into one pow. Both chains keep
 * state in doubles and round to float32 at the same stage boundaries, so on
 * emcc 6.0.3 / Node 24 every case below is bit-identical (0 error). The budget
 * is for other toolchains / engines and sits below audibility: 1e-4 is
 * -80 dBFS, and nudging spectralComp by 1e-4 already fails the 80 dB SNR gate.
 */
const GOLDEN_TOLERANCE = { maxAbs: 1e-4, minSnrDb: 80 };

let wasm: RubberBandFxModule & { _malloc(n: number): number };
let signal: Float32Array;

beforeAll(async () => {
  wasm = await loadRubberBandFxModule();
  signal = makeVocalSignal(SAMPLE_RATE, 1.5);
});

function expectGolden(label: string, reference: Float32Array, candidate: Float32Array): void {
  const stats = compareSignals(reference, candidate);
  expect(stats.maxAbs, `${label}: max |err| ${stats.maxAbs}`).toBeLessThanOrEqual(GOLDEN_TOLERANCE.maxAbs);
  expect(stats.snrDb, `${label}: SNR ${stats.snrDb.toFixed(1)} dB`).toBeGreaterThanOrEqual(GOLDEN_TOLERANCE.minSnrDb);
}

function pair(seed = SEED): { ts: TsVocalFx; native: NativeVocalFx } {
  return {
    ts: new TsVocalFx(SAMPLE_RATE, xorshift32(seed)),
    native: new NativeVocalFx(wasm, SAMPLE_RATE, QUANTUM, seed),
  };
}

const POST_RETRIEVE_CASES: FxCase[] = [
  { name: 'bypass (dual mono)', block: {} },
  { name: 'phoneme tone filter', block: { hasPhonemeContext: true, phonemeFilterMod: 0.7, phonemeVolume: 0.6 } },
  { name: 'phoneme volume only', block: { hasPhonemeContext: true, phonemeVolume: 0.5 } },
  { name: 'syllable volume filter', block: { volumeFilterMod: 0.8, syllableVolume: 0.5, isVowel: 1 } },
  { name: 'trance gate', block: { gateDepth: 0.8, gateRate: 6 } },
  { name: 'spectral comp 0.3', block: { spectralComp: 0.3 } },
  { name: 'spectral comp 1.0', block: { spectralComp: 1 } },
  { name: 'pan spread (no wrap: centre pans)', block: { grainPanSpread: 0.7 } },
  { name: 'chorus vowel', block: { vocalChorus: 0.6, isVowel: 1 } },
  { name: 'chorus consonant', block: { vocalChorus: 0.6, isVowel: 0 } },
  { name: 'sub harmonics ducked on kick', block: { subHarmonics: 0.8, isVowel: 1, duckingScalar: 0.3, drumIsSnare: 0 } },
  { name: 'master duck (gain + 350 Hz dynamic EQ)', block: { duckingScalar: 0.5, isVowel: 1 } },
  { name: 'master duck consonant', block: { duckingScalar: 0.9, isVowel: 0 } },
  { name: 'bitcrush + downsample', block: { bitcrush: 0.5, downsample: 4 } },
  { name: 'downsample fractional', block: { downsample: 2.5 } },
  { name: 'all FX on', block: FX_ON_BLOCK },
];

describe('native vocal FX vs TS oracle — post-retrieve chain', () => {
  it.each(POST_RETRIEVE_CASES)('$name', ({ name, block }) => {
    const { ts, native } = pair();
    const b = blockFor(block);
    const [tsL, tsR] = runChain(ts, signal, b);
    const [nL, nR] = runChain(native, signal, b);
    expectGolden(`${name} L`, tsL, nL);
    expectGolden(`${name} R`, tsR, nR);
    native.dispose();
  });
});

describe('native vocal FX vs TS oracle — freeze granulator', () => {
  const GRAIN_CASES: FxCase[] = [
    { name: 'hann, no jitter', block: { windowShape: 0 } },
    { name: 'hamming + jitter (seeded)', block: { windowShape: 1, grainJitter: 0.6 } },
    { name: 'soft velocity widens jitter', block: { windowShape: 0, grainJitter: 0.5, velocity: 0.3 } },
    { name: 'blackman + grain LFO + position scan', block: { windowShape: 2, grainLfoDepth: 0.5, grainPosLfoDepth: 0.7 } },
    { name: 'rectangular + env shrink + ducking', block: { windowShape: 3, grainEnvDepth: 0.5, envelopeValue: 0.8, duckingScalar: 0.4 } },
    { name: 'gaussian', block: { windowShape: 4 } },
    { name: 'sin^4', block: { windowShape: 5 } },
    {
      name: 'phoneme overrides (size, jitter, dark cutoff)',
      block: { hasPhonemeContext: true, phonemeGrainSizeMs: 45, phonemeGrainJitter: 0.3, phonemeVolume: 0.4 },
    },
  ];

  function renderFrozen(chain: TsVocalFx | NativeVocalFx, block: VocalFxBlock, setup?: (c: TsVocalFx | NativeVocalFx) => void) {
    chain.setSampleBuffer(signal);
    setup?.(chain);
    const frames = 1024;
    const blocks = 60;
    const out = new Float32Array(frames * blocks);
    const tsHeap = new Float32Array(frames);
    const ptr = chain instanceof NativeVocalFx ? wasm._malloc(frames * 4) : 0;
    let cursor = 12000;
    for (let b = 0; b < blocks; b++) {
      chain.advanceLfo(0, 3, QUANTUM);
      const heap = chain instanceof NativeVocalFx ? wasm.HEAPF32 : tsHeap;
      const offset = chain instanceof NativeVocalFx ? ptr >> 2 : 0;
      const fed = chain.renderGrains(block, heap, offset, frames, cursor, 4000, 60000);
      expect(fed).toBe(frames);
      out.set(heap.subarray(offset, offset + frames), b * frames);
      cursor += 97;
    }
    return out;
  }

  it.each(GRAIN_CASES)('$name', ({ name, block }) => {
    const { ts, native } = pair();
    const b = blockFor(block);
    expectGolden(name, renderFrozen(ts, b), renderFrozen(native, b));
    native.dispose();
  });

  it('custom window shape and custom grain envelope', () => {
    const shape = new Float32Array(64).map((_, i) => Math.sin((Math.PI * i) / 63) ** 2);
    const envelope = Array.from({ length: 33 }, (_, i) => 1 - Math.abs(i - 16) / 16);
    for (const [label, setup] of [
      ['window shape', (c: TsVocalFx | NativeVocalFx) => c.setCustomWindowShape(shape)],
      ['grain envelope', (c: TsVocalFx | NativeVocalFx) => c.setCustomGrainEnvelope(envelope)],
    ] as const) {
      const { ts, native } = pair();
      const b = blockFor({});
      expectGolden(label, renderFrozen(ts, b, setup), renderFrozen(native, b, setup));
      native.dispose();
    }
  });

  it('grain-wrap pan spread: freeze then post-retrieve chain (seeded RNG)', () => {
    const { ts, native } = pair();
    const frozen = blockFor({ grainJitter: 0.4 });
    const spread = blockFor({ ...FX_ON_BLOCK, grainPanSpread: 0.9 });
    const frames = 512;
    const tsHeap = new Float32Array(frames);
    const ptr = wasm._malloc(frames * 4);
    ts.setSampleBuffer(signal);
    native.setSampleBuffer(signal);

    const blocks = Math.floor(signal.length / QUANTUM) - 1;
    const tsL = new Float32Array(QUANTUM), tsR = new Float32Array(QUANTUM);
    const nL = new Float32Array(QUANTUM), nR = new Float32Array(QUANTUM);
    const outs = { tsL: [] as number[], tsR: [] as number[], nL: [] as number[], nR: [] as number[] };
    let pansMoved = false;
    for (let b = 0; b < blocks; b++) {
      ts.renderGrains(frozen, tsHeap, 0, frames, 20000 + b * 11, 0, signal.length);
      native.renderGrains(frozen, wasm.HEAPF32, ptr >> 2, frames, 20000 + b * 11, 0, signal.length);
      const src = signal.subarray(b * QUANTUM, (b + 1) * QUANTUM);
      tsL.set(src); tsR.fill(0); nL.set(src); nR.fill(0);
      ts.process(spread, tsL, tsR);
      native.process(spread, nL, nR);
      if (Math.abs(nL[64] - nR[64]) > 1e-3) pansMoved = true;
      outs.tsL.push(...tsL); outs.tsR.push(...tsR); outs.nL.push(...nL); outs.nR.push(...nR);
    }
    expect(pansMoved, 'grain wraps should have re-randomised the stereo pans').toBe(true);
    expectGolden('pan spread L', Float32Array.from(outs.tsL), Float32Array.from(outs.nL));
    expectGolden('pan spread R', Float32Array.from(outs.tsR), Float32Array.from(outs.nR));
    native.dispose();
  });
});

describe('spectral path compresses once', () => {
  it('matches a single split + compress pass, not the historical double pass', () => {
    const b = blockFor({ spectralComp: 1 });
    const { ts, native } = pair();
    const [single] = runChain(ts, signal, b);
    const [nativeL] = runChain(native, signal, b);
    native.dispose();

    // Reconstruct the pre-#1228 behaviour: the same crossover memory re-splits
    // and re-compresses the already-compressed block.
    const spectral = new SpectralBandProcessor();
    const pans = [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2];
    const doubled = new Float32Array(single.length);
    const l = new Float32Array(QUANTUM);
    const r = new Float32Array(QUANTUM);
    for (let i = 0; i + QUANTUM <= signal.length; i += QUANTUM) {
      l.set(signal.subarray(i, i + QUANTUM));
      for (let pass = 0; pass < 2; pass++) {
        spectral.applyBandSplitAndCompression({
          outL: l, outR: r, hasStereo: true, spectralComp: 1,
          grainPanSpread: 0, grainPanL: pans, grainPanR: pans, sampleRate: SAMPLE_RATE,
        });
      }
      doubled.set(l, i);
    }

    expectGolden('single pass', single, nativeL);
    expect(compareSignals(doubled, nativeL).snrDb).toBeLessThan(20);
  });

  it('gain reduction on a sustained vowel equals one compressor stage', () => {
    const vowel = new Float32Array(SAMPLE_RATE * 1.5).map((_, i) => {
      let v = 0;
      for (let k = 1; k <= 8; k++) v += Math.sin((2 * Math.PI * 220 * k * i) / SAMPLE_RATE) / k;
      return 0.5 * v;
    });
    const rmsDb = (x: Float32Array) => {
      const tail = x.subarray(x.length / 2);
      return 10 * Math.log10(tail.reduce((acc, v) => acc + v * v, 0) / tail.length);
    };
    const render = (chain: TsVocalFx | NativeVocalFx, comp: number, passes = 1) => {
      const b = blockFor({ spectralComp: comp });
      let x: Float32Array = vowel;
      for (let p = 0; p < passes; p++) x = runChain(chain, x, b)[0];
      return x;
    };

    const dryDb = rmsDb(render(pair().ts, 1e-9));
    const onceDb = dryDb - rmsDb(render(pair().ts, 1));
    const twiceDb = dryDb - rmsDb(render(pair().ts, 1, 2));
    const { native } = pair();
    const nativeDb = dryDb - rmsDb(render(native, 1));
    native.dispose();

    expect(twiceDb - onceDb, 'a second stage must be distinguishable').toBeGreaterThan(1);
    expect(Math.abs(nativeDb - onceDb)).toBeLessThan(0.01);
  });
});

describe('memory budget', () => {
  it('stretcher + FX chain + 30 s vocal stay inside rubberband.initialMemoryMb (no growth)', async () => {
    const budget = JSON.parse(readFileSync(join(repoRoot(), 'emscripten/wasm_memory_budget.json'), 'utf8'));
    const fresh = await loadRubberBandFxModule() as typeof wasm & {
      RubberBandStretcher: new (...args: number[]) => {
        getSamplesRequired(): number; available(): number; setPitchScale(s: number): void;
        process(ptr: number, n: number, final: boolean): void; retrieve(ptr: number, n: number): number;
      };
    };
    const initialBytes = budget.rubberband.initialMemoryMb * 1024 * 1024;
    expect(fresh.HEAPF32.buffer.byteLength).toBe(initialBytes);

    // Same shape as the worklet: one finer + formant-preserving stretcher, one FX chain.
    const stretcher = new fresh.RubberBandStretcher(SAMPLE_RATE, 1, 1 | 32 | 1048576, 1, 1);
    const fx = new NativeVocalFx(fresh, SAMPLE_RATE, QUANTUM, SEED);
    const vocal = makeVocalSignal(SAMPLE_RATE, 30);
    fx.setSampleBuffer(vocal);
    const io = fresh._malloc(8192 * 4);
    const left = new Float32Array(QUANTUM);
    const right = new Float32Array(QUANTUM);
    const block = blockFor({ ...FX_ON_BLOCK, grainJitter: 0.5 });
    let cursor = 0;
    for (let b = 0; b < 600; b++) {
      stretcher.setPitchScale(1 + 0.3 * Math.sin(b / 25));
      const need = Math.min(stretcher.getSamplesRequired(), 8192);
      if (b % 3 === 0) {
        fx.renderGrains(block, fresh.HEAPF32, io >> 2, need, cursor + 24000, 0, vocal.length);
      } else {
        fresh.HEAPF32.set(vocal.subarray(cursor, cursor + need), io >> 2);
        cursor += need;
      }
      stretcher.process(io, need, false);
      const got = stretcher.retrieve(io, Math.min(stretcher.available(), QUANTUM));
      left.fill(0);
      left.set(fresh.HEAPF32.subarray(io >> 2, (io >> 2) + got));
      fx.process(block, left, right);
    }

    expect(fresh.HEAPF32.buffer.byteLength, 'rubberband heap grew; raise the budget only with a measurement').toBe(initialBytes);
    fx.dispose();
  });
});
