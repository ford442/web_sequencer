import { describe, expect, it, vi } from 'vitest';

vi.mock('onnxruntime-web', () => ({
  env: { wasm: { wasmPaths: '', numThreads: 1 } },
  Tensor: class {
    constructor(public type: string, public data: Float32Array, public dims: number[]) {}
  },
  InferenceSession: { create: vi.fn() },
}));
import { PhonemeAligner, ALIGNMENT_BOUNDARY_TOLERANCE_MS } from '../PhonemeAligner';
import { CtcForcedAligner, WAV2VEC2_CTC_VOCAB } from '../alignment/ctcForcedAligner';
import { generateTtsFixtureAudio, TTS_ALIGNMENT_FIXTURE } from './fixtures/ttsAlignmentFixture';

function inferPeakedAtBoundary(boundarySec: number, hopSeconds: number) {
  const vocab = WAV2VEC2_CTC_VOCAB;
  const vocabSize = vocab.length;
  const idH = vocab.indexOf('A');
  const idE = vocab.indexOf('E');
  const blank = 0;
  return async (audio16k: Float32Array) => {
    const duration = audio16k.length / 16000;
    const timeSteps = Math.max(8, Math.round(duration / hopSeconds));
    const logProbs = new Float32Array(timeSteps * vocabSize).fill(-10);
    const split = Math.round((boundarySec / duration) * timeSteps);
    for (let t = 0; t < timeSteps; t++) {
      const id = t < split ? idH : idE;
      logProbs[t * vocabSize + id] = 0;
      logProbs[t * vocabSize + blank] = -4;
    }
    return { logProbs, timeSteps, vocabSize };
  };
}

describe('PhonemeAligner CTC vs heuristic', () => {
  it('documents median boundary tolerance', () => {
    expect(ALIGNMENT_BOUNDARY_TOLERANCE_MS).toBe(40);
  });

  it('places the ah|ee vowel boundary closer than uniform heuristic', async () => {
    const hop = 0.02;
    const audio = generateTtsFixtureAudio();
    const sampleRate = TTS_ALIGNMENT_FIXTURE.sampleRate;
    const text = TTS_ALIGNMENT_FIXTURE.transcript;
    const expected = TTS_ALIGNMENT_FIXTURE.expectedBoundariesSec[1];

    const heuristic = new PhonemeAligner({ useLocalAlignment: true, enableCtcAlignment: false });
    const heur = await heuristic.alignPhonemes(audio, text, sampleRate);
    const heurBoundary = heur.phonemes[0]?.end ?? 0;

    const ctc = new CtcForcedAligner({
      hopSeconds: hop,
      infer: inferPeakedAtBoundary(expected, hop),
    });
    const aligner = new PhonemeAligner({
      enableCtcAlignment: true,
      ctcAligner: ctc,
    });
    const forced = await aligner.alignPhonemes(audio, text, sampleRate);
    const ctcBoundary = forced.phonemes.find((p) => p.phoneme === 'AA' || p.phoneme === 'AE')?.end
      ?? forced.phonemes[0].end;

    const ctcErrMs = Math.abs(ctcBoundary - expected) * 1000;
    expect(ctcErrMs).toBeLessThanOrEqual(ALIGNMENT_BOUNDARY_TOLERANCE_MS);

    const heurErrMs = Math.abs(heurBoundary - expected) * 1000;
    expect(ctcErrMs).toBeLessThanOrEqual(heurErrMs);
  });

  it('falls back to heuristic when CTC is disabled', async () => {
    const audio = new Float32Array(16000);
    const aligner = new PhonemeAligner({ enableCtcAlignment: false });
    const result = await aligner.alignPhonemes(audio, 'hello', 16000);
    expect(result.phonemes.map((p) => p.phoneme)).toEqual(['HH', 'AH', 'L', 'OW']);
  });
});
