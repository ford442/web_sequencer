/**
 * Phoneme elasticity is audible: the real RubberBandProcessor on the real
 * public/rubberband.wasm, fed the phoneme buffer PhonemeAligner builds from
 * Phoneme Painter data, holds a stretched phoneme longer before moving on.
 *
 * The sample is two "phonemes" with different pitches (220 Hz then 880 Hz), so
 * the moment the output's zero-crossing rate jumps is the phoneme boundary as
 * heard. Elasticity 1.5 / 0.5 must push that boundary ~0.25 s later while
 * the note keeps its overall length.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { repoRoot } from '@/test/helpers/requireRepoArtifacts';
import { PhonemeAligner, type AlignmentResult } from '@/engines/rubberband/PhonemeAligner';
import { matchUserPhonemes } from '@/engines/rubberband/phonemeElasticity';
import { RUBBERBAND_PARAMETER_DESCRIPTORS } from '@/audio-worklets/rubberband/parameterDescriptors';
import type { PhonemeData } from '@/types';

const SR = 48000;
const QUANTUM = 128;

type Processor = {
  handleMessage(event: { data: Record<string, unknown> }): Promise<void>;
  process(inputs: unknown, outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
  port: { postMessage: (m: unknown) => void };
};

let ProcessorCtor: new () => Processor;
const clock = { currentTime: 0 };

beforeAll(async () => {
  vi.stubGlobal('AudioWorkletProcessor', class {
    port = { postMessage: () => {}, onmessage: null };
  });
  vi.stubGlobal('registerProcessor', (_name: string, ctor: new () => Processor) => {
    ProcessorCtor = ctor;
  });
  vi.stubGlobal('sampleRate', SR);
  Object.defineProperty(globalThis, 'currentTime', { get: () => clock.currentTime, configurable: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('@/audio-worklets/rubberband-processor');
});

function twoPhonemeSample(): Float32Array {
  return new Float32Array(SR).map((_, i) => {
    const hz = i < SR / 2 ? 220 : 880;
    return 0.5 * Math.sin((2 * Math.PI * hz * i) / SR);
  });
}

const ALIGNMENT: AlignmentResult = {
  phonemes: [
    { phoneme: 'AA', start: 0, end: 0.5, isVowel: true },
    { phoneme: 'IY', start: 0.5, end: 1.0, isVowel: true },
  ],
  sampleRate: SR,
  duration: 1,
  text: 'ah ee',
};

/** Renders a 1 s note and returns the time (s) the output first sounds like the 880 Hz phoneme. */
async function boundarySeconds(userPhonemes: PhonemeData[] | undefined): Promise<number> {
  clock.currentTime = 0;
  const processor = new ProcessorCtor();
  await processor.handleMessage({
    data: {
      type: 'INIT_WASM',
      inputBuffer: new SharedArrayBuffer(4096 * 4),
      outputBuffer: new SharedArrayBuffer(4096 * 4),
      wasmBinary: readFileSync(join(repoRoot(), 'public/rubberband.wasm')),
    },
  });

  const aligner = new PhonemeAligner();
  const targetDuration = 1.0;
  const ratios = aligner.calculateStretchRatios(ALIGNMENT.phonemes, targetDuration);
  const matched = matchUserPhonemes(ALIGNMENT.phonemes, userPhonemes, ALIGNMENT.duration);
  const sharedBuffer = aligner.createSharedPhonemeBuffer(ALIGNMENT.phonemes, SR, matched, ratios);

  const sample = twoPhonemeSample();
  await processor.handleMessage({ data: { type: 'loadBuffer', data: { buffer: sample.buffer.slice(0) } } });
  await processor.handleMessage({ data: { type: 'setPhonemeData', data: { sharedBuffer, ratios } } });
  await processor.handleMessage({ data: { type: 'noteOn', data: { pitch: 1, startSample: 0, endSample: SR } } });

  const parameters = Object.fromEntries(
    RUBBERBAND_PARAMETER_DESCRIPTORS.map((d) => [d.name, new Float32Array([d.name === 'attack' ? 0.001 : d.defaultValue])]),
  );
  const blocks = Math.ceil((1.6 * SR) / QUANTUM);
  const out = new Float32Array(blocks * QUANTUM);
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(QUANTUM);
    const r = new Float32Array(QUANTUM);
    processor.process([], [[l, r]], parameters);
    out.set(l, b * QUANTUM);
    clock.currentTime += QUANTUM / SR;
  }

  // Zero-crossing rate per 20 ms window; 220 Hz → 440 crossings/s, 880 Hz → 1760.
  const win = Math.floor(0.02 * SR);
  for (let start = 0; start + win <= out.length; start += win) {
    let crossings = 0;
    let energy = 0;
    for (let i = start + 1; i < start + win; i++) {
      if ((out[i - 1] < 0) !== (out[i] < 0)) crossings++;
      energy += out[i] * out[i];
    }
    const rate = crossings / 0.02;
    if (energy / win > 1e-4 && rate > 1100) return start / SR;
  }
  return Infinity;
}

describe('phoneme elasticity through the Rubber Band worklet', () => {
  it('a stretched first phoneme moves the audible boundary later', async () => {
    const asAligned = await boundarySeconds(undefined);
    const stretched = await boundarySeconds([
      { id: 'aa', symbol: 'AA', start: 0, end: 0.5, pitchBend: 0, elasticity: 1.5 },
      { id: 'iy', symbol: 'IY', start: 0.5, end: 1, pitchBend: 0, elasticity: 0.5 },
    ]);

    expect(asAligned).toBeGreaterThan(0.4);
    expect(asAligned).toBeLessThan(0.7);
    // 0.5 s × 1.5 = 0.75 s for the first phoneme: ~0.25 s later, same note length.
    expect(stretched - asAligned).toBeGreaterThan(0.17);
    expect(stretched - asAligned).toBeLessThan(0.33);
  });
});
