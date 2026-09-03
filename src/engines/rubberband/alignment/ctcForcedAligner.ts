import * as ort from 'onnxruntime-web';
import { g2pText, defaultPhonemeDurationWeights, isArpabetVowel, categorizePhoneme } from './g2p';
import { forcedAlignCtc, resampleLinear } from './ctcViterbi';
import type { AlignmentResult, PhonemeSegment, AlignPassOptions } from './types';

/** wav2vec2-base-960h character CTC labels (blank = `<pad>`). */
export const WAV2VEC2_CTC_VOCAB = [
  '<pad>', '<s>', '</s>', '<unk>', '|',
  'E', 'T', 'A', 'O', 'N', 'I', 'H', 'S', 'R', 'D', 'L', 'U', 'M',
  'W', 'C', 'F', 'G', 'Y', 'P', 'B', 'V', 'K', 'X', 'J', 'Q', 'Z',
] as const;

export const CTC_MODEL_SAMPLE_RATE = 16000;
export const CTC_DEFAULT_HOP_SECONDS = 0.02;
export const CTC_MODEL_URL = 'assets/onnx/wav2vec2-ctc.onnx';

export interface CtcInferResult {
  logProbs: Float32Array;
  timeSteps: number;
  vocabSize: number;
}

export interface CtcForcedAlignerOptions {
  modelUrl?: string;
  vocab?: readonly string[];
  blankId?: number;
  hopSeconds?: number;
  infer?: (audio16k: Float32Array) => Promise<CtcInferResult>;
}


function getAssetUrl(path: string): string {
  const base = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${path.replace(/^\//, '')}`;
}

function letterSequence(text: string): string[] {
  const out: string[] = [];
  const normalized = text.toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, '|');
  for (const ch of normalized) {
    if (ch === '|') out.push('|');
    else if (ch >= 'A' && ch <= 'Z') out.push(ch);
  }
  while (out.length > 0 && out[0] === '|') out.shift();
  while (out.length > 0 && out[out.length - 1] === '|') out.pop();
  return out;
}

function softmaxLogitsToLogProbs(logits: Float32Array, timeSteps: number, vocabSize: number): Float32Array {
  const out = new Float32Array(timeSteps * vocabSize);
  for (let t = 0; t < timeSteps; t++) {
    let max = -Infinity;
    const row = t * vocabSize;
    for (let v = 0; v < vocabSize; v++) {
      const x = logits[row + v];
      if (x > max) max = x;
    }
    let sum = 0;
    for (let v = 0; v < vocabSize; v++) {
      const e = Math.exp(logits[row + v] - max);
      out[row + v] = e;
      sum += e;
    }
    const logSum = Math.log(sum);
    for (let v = 0; v < vocabSize; v++) {
      out[row + v] = logits[row + v] - max - logSum;
    }
  }
  return out;
}

function groupLetterTimes(
  letters: string[],
  letterTimes: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const groups: Array<{ start: number; end: number }> = [];
  let start = 0;
  let end = 0;
  let started = false;
  for (let i = 0; i < letters.length; i++) {
    if (letters[i] === '|') {
      if (started) groups.push({ start, end });
      started = false;
      continue;
    }
    const t = letterTimes[i];
    if (!t) continue;
    if (!started) {
      start = t.start;
      started = true;
    }
    end = t.end;
  }
  if (started) groups.push({ start, end });
  return groups;
}

function splitTimeByWeights(
  start: number,
  end: number,
  weights: number[],
): Array<{ start: number; end: number }> {
  const total = weights.reduce((a, b) => a + Math.max(1e-6, b), 0);
  const span = Math.max(1e-4, end - start);
  const segs: Array<{ start: number; end: number }> = [];
  let t = start;
  for (let i = 0; i < weights.length; i++) {
    const w = Math.max(1e-6, weights[i]);
    const next = i === weights.length - 1 ? end : t + span * (w / total);
    segs.push({ start: t, end: next });
    t = next;
  }
  return segs;
}

/**
 * ONNX CTC forced aligner (download-on-demand wav2vec2).
 * Tests inject `infer` and skip the network.
 */
export class CtcForcedAligner {
  private session: ort.InferenceSession | null = null;
  private loadAttempted = false;
  private loaded = false;
  private readonly modelUrl: string;
  private readonly vocab: readonly string[];
  private readonly blankId: number;
  private readonly hopSeconds: number;
  private readonly inferOverride?: (audio16k: Float32Array) => Promise<CtcInferResult>;
  private readonly tokenToId: Map<string, number>;

  constructor(options: CtcForcedAlignerOptions = {}) {
    this.modelUrl = options.modelUrl ?? CTC_MODEL_URL;
    this.vocab = options.vocab ?? WAV2VEC2_CTC_VOCAB;
    this.blankId = options.blankId ?? 0;
    this.hopSeconds = options.hopSeconds ?? CTC_DEFAULT_HOP_SECONDS;
    this.inferOverride = options.infer;
    this.tokenToId = new Map(this.vocab.map((t, i) => [t, i]));
    if (this.inferOverride) {
      this.loaded = true;
      this.loadAttempted = true;
    }
  }

  isReady(): boolean {
    return this.loaded;
  }

  async ensureLoaded(): Promise<boolean> {
    if (this.loaded) return true;
    if (this.loadAttempted) return false;
    this.loadAttempted = true;
    try {
      const url = getAssetUrl(this.modelUrl);
      this.session = await ort.InferenceSession.create(url, {
        executionProviders: ['wasm'],
      });
      this.loaded = true;
      return true;
    } catch {
      this.loaded = false;
      return false;
    }
  }

  async align(
    audio: Float32Array,
    text: string,
    sampleRate: number,
    options: AlignPassOptions = {},
  ): Promise<AlignmentResult | null> {
    const ready = this.inferOverride ? true : await this.ensureLoaded();
    if (!ready) return null;

    const phonemes = g2pText(text);
    if (phonemes.length === 0) return null;

    const audio16k = resampleLinear(audio, sampleRate, CTC_MODEL_SAMPLE_RATE);
    const inferred = this.inferOverride
      ? await this.inferOverride(audio16k)
      : await this.runOnnx(audio16k);

    if (!inferred || inferred.timeSteps < 1) return null;

    const letters = letterSequence(text);
    const tokenIds = letters
      .map((ch) => this.tokenToId.get(ch) ?? this.tokenToId.get('<unk>') ?? 3)
      .filter((id) => id >= 0);

    if (tokenIds.length === 0) return null;

    const spans = forcedAlignCtc(
      inferred.logProbs,
      inferred.timeSteps,
      inferred.vocabSize,
      tokenIds,
      this.blankId,
    );

    const duration = audio.length / sampleRate;
    const hop = this.hopSeconds;
    const letterTimes = spans.map((s) => ({
      start: Math.max(0, s.startFrame * hop),
      end: Math.min(duration, Math.max(s.startFrame * hop + hop, s.endFrame * hop)),
    }));

    const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 0);
    const wordPhonemes = words.map((w) => g2pText(w));
    const letterGroups = groupLetterTimes(letters, letterTimes);

    const segments: PhonemeSegment[] = [];
    const globalPriors = options.durationPriors;
    let priorOffset = 0;
    if (wordPhonemes.length === letterGroups.length) {
      for (let w = 0; w < wordPhonemes.length; w++) {
        const phs = wordPhonemes[w];
        const range = letterGroups[w];
        const weights = globalPriors && globalPriors.length === phonemes.length
          ? globalPriors.slice(priorOffset, priorOffset + phs.length)
          : defaultPhonemeDurationWeights(phs);
        priorOffset += phs.length;
        const splits = splitTimeByWeights(range.start, range.end, weights);
        for (let i = 0; i < phs.length; i++) {
          segments.push({
            phoneme: phs[i],
            start: splits[i].start,
            end: splits[i].end,
            isVowel: isArpabetVowel(phs[i]),
            category: categorizePhoneme(phs[i]),
          });
        }
      }
    } else {
      const weights = globalPriors && globalPriors.length === phonemes.length
        ? globalPriors
        : defaultPhonemeDurationWeights(phonemes);
      const audioStart = letterTimes[0]?.start ?? 0;
      const audioEnd = letterTimes[letterTimes.length - 1]?.end ?? duration;
      const splits = splitTimeByWeights(
        audioStart,
        audioEnd <= audioStart ? duration : audioEnd,
        weights,
      );
      for (let i = 0; i < phonemes.length; i++) {
        segments.push({
          phoneme: phonemes[i],
          start: splits[i].start,
          end: splits[i].end,
          isVowel: isArpabetVowel(phonemes[i]),
          category: categorizePhoneme(phonemes[i]),
        });
      }
    }

    return {
      phonemes: segments,
      sampleRate,
      duration,
      text,
    };
  }

  private async runOnnx(audio16k: Float32Array): Promise<CtcInferResult | null> {
    if (!this.session) return null;
    const inputName = this.session.inputNames[0];
    const tensor = new ort.Tensor('float32', audio16k, [1, audio16k.length]);
    const out = await this.session.run({ [inputName]: tensor });
    const first = out[this.session.outputNames[0]];
    if (!first) return null;
    const dims = first.dims;
    const timeSteps = dims.length === 3 ? Number(dims[1]) : Number(dims[0]);
    const vocabSize = dims.length === 3 ? Number(dims[2]) : Number(dims[1]);
    const data = first.data as Float32Array;
    return {
      logProbs: softmaxLogitsToLogProbs(data, timeSteps, vocabSize),
      timeSteps,
      vocabSize,
    };
  }
}
