import { describe, expect, it, vi } from 'vitest';

vi.mock('onnxruntime-web', () => ({
  env: { wasm: { wasmPaths: '', numThreads: 1 } },
  Tensor: class {
    constructor(public type: string, public data: Float32Array, public dims: number[]) {}
  },
  InferenceSession: { create: vi.fn() },
}));
import { forcedAlignCtc, resampleLinear } from '../alignment/ctcViterbi';
import { WAV2VEC2_CTC_VOCAB } from '../alignment/ctcForcedAligner';
import { g2pText } from '../alignment/g2p';

describe('forcedAlignCtc', () => {
  it('recovers a two-token path from peaked log-probs', () => {
    const vocabSize = 4;
    const blank = 0;
    const timeSteps = 20;
    const tokenIds = [1, 2];
    const logProbs = new Float32Array(timeSteps * vocabSize).fill(-8);
    for (let t = 0; t < timeSteps; t++) {
      const id = t < 8 ? 1 : 2;
      logProbs[t * vocabSize + id] = 0;
      logProbs[t * vocabSize + blank] = -3;
    }
    const spans = forcedAlignCtc(logProbs, timeSteps, vocabSize, tokenIds, blank);
    expect(spans.length).toBe(2);
    expect(spans[0].tokenId).toBe(1);
    expect(spans[1].tokenId).toBe(2);
    expect(spans[0].endFrame).toBeLessThanOrEqual(spans[1].startFrame + 1);
    expect(Math.abs(spans[0].endFrame - 8)).toBeLessThanOrEqual(3);
  });
});

describe('resampleLinear', () => {
  it('changes length by the sample-rate ratio', () => {
    const src = new Float32Array(1000).fill(0.5);
    const out = resampleLinear(src, 48000, 16000);
    expect(out.length).toBe(Math.round(1000 * 16000 / 48000));
  });
});

describe('g2pText', () => {
  it('uses the CMU subset for hello world', () => {
    expect(g2pText('hello world')).toEqual([
      'HH', 'AH', 'L', 'OW', 'W', 'ER', 'L', 'D',
    ]);
  });
});

describe('wav2vec2 vocab', () => {
  it('includes blank and English letters', () => {
    expect(WAV2VEC2_CTC_VOCAB[0]).toBe('<pad>');
    expect(WAV2VEC2_CTC_VOCAB).toContain('A');
    expect(WAV2VEC2_CTC_VOCAB).toContain('|');
  });
});
