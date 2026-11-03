import { GranularEngine } from '../src/audio-worklets/rubberband/granularEngine.ts';

const engine = new GranularEngine(() => 0.5); // constant random
const buf = new Float32Array(44100 * 2);
for (let i = 0; i < buf.length; i++) buf[i] = Math.random();

const params = {
  fullSampleBuffer: buf,
  sampleRate: 44100,
  hasPhonemeContext: false,
  phonemeVolume: 1.0,
  isVowel: 1.0,
  phonemeGrainJitter: -1.0,
  phonemeGrainSizeMs: -1.0,
  currentSamplePtr: 44100,
  startSamplePtr: 0,
  endSamplePtr: 44100 * 2,
  duckingScalar: 0,
  envelopeValue: 0,
  grainJitterParam: 0.1,
  grainEnvDepth: 0,
  windowShape: 0, // HANN
  grainLfoDepth: 0,
  grainPosLfoDepth: 0,
  timeSmear: 0,
  velocity: 1.0,
  bassEnvelopeValue: 0,
  bassEnvDepth: 0,
};

const out = new Float32Array(128);

console.time('renderGrains');
for (let i = 0; i < 50000; i++) {
  engine.renderGrains(params as any, out, 0, 128);
  // advance pointers a bit
  params.currentSamplePtr += 128;
  if (params.currentSamplePtr > 44100*2) params.currentSamplePtr = 0;
}
console.timeEnd('renderGrains');
