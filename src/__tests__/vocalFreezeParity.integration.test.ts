/**
 * Live and frozen sing the same line (#1273 Part C, V2).
 *
 * The offline vocal host runs the same RubberBandProcessor on its own
 * rubberband.wasm instance, at the export rate instead of the live one. This
 * drives the real processor on the real public/rubberband.wasm the way the
 * trigger does — phoneme buffer from PhonemeAligner, pitch on the pitchScale
 * param, noteOn — once at a live 44.1 kHz and once at a 48 kHz export, and
 * compares what is heard:
 *
 * 1. a two-bar sung line (two notes of a two-phoneme phrase, 220 Hz "ah" then
 *    880 Hz "ee"): the audible phoneme boundary of each note lands at the same
 *    time at both rates, within ALIGNMENT_BOUNDARY_TOLERANCE_MS;
 * 2. the vowel crossfade is planned at the same moment at both rates;
 * 3. the frozen (48 kHz) vowel layer of a long G4 is within a semitone of G4
 *    on its sustained portion.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { repoRoot, requireRepoArtifacts } from '@/test/helpers/requireRepoArtifacts';
import { PhonemeAligner, type AlignmentResult } from '@/engines/rubberband/PhonemeAligner';
import { ALIGNMENT_BOUNDARY_TOLERANCE_MS } from '@/engines/rubberband/alignment/types';
import { resampleLinear } from '@/engines/rubberband/alignment/ctcViterbi';
import { ConcatenativeHybrid, VowelLibrary, parseVowelManifest } from '@/engines/rubberband/ConcatenativeHybrid';
import { RUBBERBAND_PARAMETER_DESCRIPTORS } from '@/audio-worklets/rubberband/parameterDescriptors';

const LIVE_SR = 44100;
const EXPORT_SR = 48000;
const QUANTUM = 128;
const STEP_SECONDS = 0.125; // 120 BPM sixteenths
const NOTE_STEPS = 8; // one second
const LINE_STEPS = 32; // two bars of the 16-step grid
const NOTE_STARTS = [0, 16];

type Processor = {
  handleMessage(event: { data: Record<string, unknown> }): Promise<void>;
  process(inputs: unknown, outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
};

let ProcessorCtor: new () => Processor;
const clock = { currentTime: 0 };

beforeAll(async () => {
  requireRepoArtifacts(['public/rubberband.wasm', 'src/audio-worklets/rubberband-lib.js']);
  vi.stubGlobal('AudioWorkletProcessor', class {
    port = { postMessage: () => {}, onmessage: null };
  });
  vi.stubGlobal('registerProcessor', (_name: string, ctor: new () => Processor) => {
    ProcessorCtor = ctor;
  });
  vi.stubGlobal('sampleRate', EXPORT_SR);
  Object.defineProperty(globalThis, 'currentTime', { get: () => clock.currentTime, configurable: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('@/audio-worklets/rubberband-processor');
});

/** A processor at `rate`: the worklet scope's sampleRate is read in the constructor. */
async function processorAt(rate: number): Promise<Processor> {
  vi.stubGlobal('sampleRate', rate);
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
  return processor;
}

function defaultParams(overrides: Record<string, number> = {}): Record<string, Float32Array> {
  return Object.fromEntries(RUBBERBAND_PARAMETER_DESCRIPTORS.map((d) => [
    d.name,
    new Float32Array([overrides[d.name] ?? (d.name === 'attack' ? 0.001 : d.defaultValue)]),
  ]));
}

/** Renders `seconds`, calling `at(block)` before each block (to post messages on time). */
async function render(
  processor: Processor,
  rate: number,
  seconds: number,
  parameters: Record<string, Float32Array>,
  at: (block: number) => Promise<void>,
): Promise<Float32Array> {
  const blocks = Math.ceil((seconds * rate) / QUANTUM);
  const out = new Float32Array(blocks * QUANTUM);
  for (let b = 0; b < blocks; b++) {
    await at(b);
    const l = new Float32Array(QUANTUM);
    const r = new Float32Array(QUANTUM);
    processor.process([], [[l, r]], parameters);
    out.set(l, b * QUANTUM);
    clock.currentTime += QUANTUM / rate;
  }
  return out;
}

const ALIGNMENT = (rate: number): AlignmentResult => ({
  phonemes: [
    { phoneme: 'AA', start: 0, end: 0.5, isVowel: true },
    { phoneme: 'IY', start: 0.5, end: 1.0, isVowel: true },
  ],
  sampleRate: rate,
  duration: 1,
  text: 'ah ee',
});

/** The bank's phrase at `rate` (the host resamples the TTS buffer to the export rate). */
function phrase(rate: number): Float32Array {
  return new Float32Array(rate).map((_, i) => 0.5 * Math.sin((2 * Math.PI * (i < rate / 2 ? 220 : 880) * i) / rate));
}

/** Audible ah→ee boundary (s) after `from`: first 20 ms window with an 880 Hz zero-crossing rate. */
function boundaryAfter(out: Float32Array, rate: number, from: number, to: number): number {
  const win = Math.floor(0.02 * rate);
  for (let start = Math.floor(from * rate); start + win <= Math.min(out.length, to * rate); start += Math.floor(win / 4)) {
    let crossings = 0;
    let energy = 0;
    for (let i = start + 1; i < start + win; i++) {
      if ((out[i - 1] < 0) !== (out[i] < 0)) crossings++;
      energy += out[i] * out[i];
    }
    if (energy / win > 1e-4 && crossings / 0.02 > 1100) return start / rate;
  }
  return Infinity;
}

/** The two-bar line at `rate`: per-note phoneme data + noteOn at each note's step. */
async function singLine(rate: number): Promise<number[]> {
  const processor = await processorAt(rate);
  const aligner = new PhonemeAligner();
  const alignment = ALIGNMENT(rate);
  const noteSeconds = NOTE_STEPS * STEP_SECONDS;
  await processor.handleMessage({ data: { type: 'loadBuffer', data: { buffer: phrase(rate).buffer } } });

  const startBlocks = new Map(NOTE_STARTS.map((step) => [Math.floor((step * STEP_SECONDS * rate) / QUANTUM), step]));
  const out = await render(processor, rate, LINE_STEPS * STEP_SECONDS, defaultParams(), async (block) => {
    if (!startBlocks.has(block)) return;
    const ratios = aligner.calculateStretchRatios(alignment.phonemes, noteSeconds);
    const sharedBuffer = aligner.createSharedPhonemeBuffer(alignment.phonemes, rate, undefined, ratios);
    await processor.handleMessage({ data: { type: 'setPhonemeData', data: { sharedBuffer, ratios } } });
    await processor.handleMessage({ data: { type: 'noteOn', data: { pitch: 1, startSample: 0, endSample: rate } } });
  });

  return NOTE_STARTS.map((step) => {
    const start = step * STEP_SECONDS;
    return boundaryAfter(out, rate, start, start + noteSeconds + 0.3) - start;
  });
}

/** The committed vowel pack, decoded from its 16-bit WAVs (and linearly resampled for 44.1 kHz). */
function vowelPackAt(rate: number): VowelLibrary {
  const dir = join(repoRoot(), 'public/assets/vowels');
  const manifest = parseVowelManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  const library = new VowelLibrary();
  for (const entry of manifest.samples) {
    const bytes = readFileSync(join(dir, entry.file));
    const data = bytes.indexOf('data') + 8;
    const pcm = new Float32Array((bytes.length - data) / 2).map((_, i) => bytes.readInt16LE(data + 2 * i) / 32768);
    const audio = rate === manifest.sampleRate ? pcm : resampleLinear(pcm, manifest.sampleRate, rate);
    const scale = rate / manifest.sampleRate;
    library.addSample({
      vowel: entry.vowel,
      midiNote: entry.midiNote,
      audio,
      sampleRate: rate,
      loopStart: Math.round(entry.loopStart * scale),
      loopEnd: Math.min(audio.length, Math.round(entry.loopEnd * scale)),
    });
  }
  return library;
}

/** f0 (Hz) of `signal` by normalised autocorrelation over 80–1000 Hz. */
function pitchHz(signal: Float32Array, rate: number): number {
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.floor(rate / 1000); lag <= Math.ceil(rate / 80); lag++) {
    let num = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i + lag < signal.length; i++) {
      num += signal[i] * signal[i + lag];
      a += signal[i] * signal[i];
      b += signal[i + lag] * signal[i + lag];
    }
    const r = num / Math.sqrt(a * b + 1e-12);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return rate / bestLag;
}

describe('vocal freeze parity: live rate vs export rate', () => {
  it('a two-bar sung line keeps its phoneme boundaries within the alignment tolerance', async () => {
    const live = await singLine(LIVE_SR);
    const frozen = await singLine(EXPORT_SR);
    const toleranceSec = ALIGNMENT_BOUNDARY_TOLERANCE_MS / 1000;

    live.concat(frozen).forEach((t) => {
      expect(t).toBeGreaterThan(0.3);
      expect(t).toBeLessThan(0.8);
    });
    live.forEach((t, note) => expect(Math.abs(frozen[note] - t)).toBeLessThanOrEqual(toleranceSec));
  });

  it('plans the vowel crossfade at the same moment at both rates', () => {
    const live = new ConcatenativeHybrid({ sampleRate: LIVE_SR }, vowelPackAt(LIVE_SR)).planNote({ durationSec: 1, midiNote: 67, alignment: ALIGNMENT(LIVE_SR) })!;
    const frozen = new ConcatenativeHybrid({ sampleRate: EXPORT_SR }, vowelPackAt(EXPORT_SR)).planNote({ durationSec: 1, midiNote: 67, alignment: ALIGNMENT(EXPORT_SR) })!;
    expect(frozen.sample.vowel).toBe('ee'); // the phrase's last vowel
    expect(frozen.crossfadeStart).toBe(live.crossfadeStart);
    expect(frozen.crossfadeDuration).toBe(live.crossfadeDuration);
    expect(Math.abs(frozen.timeRatio - live.timeRatio)).toBeLessThan(0.01);
  });

  it('the frozen vowel layer of a long G4 sustains within a semitone of G4', async () => {
    const targetMidi = 67;
    const hybrid = new ConcatenativeHybrid({ sampleRate: EXPORT_SR }, vowelPackAt(EXPORT_SR));
    const plan = hybrid.planNote({ durationSec: 1.5, midiNote: targetMidi })!;
    expect(plan.sample.vowel).toBe('ah');

    const processor = await processorAt(EXPORT_SR);
    await processor.handleMessage({ data: { type: 'loadBuffer', data: { buffer: plan.buffer.slice().buffer } } });
    await processor.handleMessage({ data: { type: 'setPhonemeData', data: { sharedBuffer: null, ratios: null } } });
    const params = defaultParams({
      pitchScale: Math.pow(2, (targetMidi - plan.rootMidi) / 12),
      timeRatio: plan.timeRatio,
    });
    const out = await render(processor, EXPORT_SR, plan.playDuration, params, async (block) => {
      if (block === 0) await processor.handleMessage({ data: { type: 'noteOn', data: { pitch: 1 } } });
    });

    const sustained = out.subarray(Math.floor(0.4 * EXPORT_SR), Math.floor(1.1 * EXPORT_SR));
    let energy = 0;
    for (const v of sustained) energy += v * v;
    expect(energy / sustained.length).toBeGreaterThan(1e-4);
    const semitones = 12 * Math.log2(pitchHz(sustained, EXPORT_SR) / (440 * Math.pow(2, (targetMidi - 69) / 12)));
    expect(Math.abs(semitones)).toBeLessThan(1);
  });
});
