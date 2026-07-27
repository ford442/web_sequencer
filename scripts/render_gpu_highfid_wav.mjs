#!/usr/bin/env node
/**
 * Host-side harness (Phase-3 / #976): render ~1 s of the gpu-highfid topology
 * (CPU oracle — same DSP as WGSL; Node has no WebGPU) and write a mono WAV.
 *
 * Usage:
 *   pnpm exec vite-node scripts/render_gpu_highfid_wav.mjs
 *   pnpm exec vite-node scripts/render_gpu_highfid_wav.mjs --out /tmp/gpu-highfid_1s.wav
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renderOfflineHighFid303Pattern } from '../src/audio/offline/OfflineHighFid303Engine.ts';

function parseArgs(argv) {
  const out = { outPath: '/tmp/gpu-highfid_1s.wav' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out.outPath = resolve(argv[++i]);
    }
  }
  return out;
}

function floatTo16BitWav(samples, sampleRate) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const a = Math.abs(s);
    if (a > peak) peak = a;
    buffer.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  return { buffer, peak };
}

const args = parseArgs(process.argv);
const sampleRate = 44100;
const pattern = {
  steps: [
    { note: 36, velocity: 90 },
    { note: 36, accent: true, slide: true, velocity: 120 },
    { note: 39, velocity: 90 },
    { note: 43, accent: true, slide: true, velocity: 120 },
    { note: 36, velocity: 90 },
    { note: 41, accent: true, slide: true, velocity: 120 },
    { note: 39, velocity: 90 },
    { note: 36, accent: true, slide: true, velocity: 120 },
  ],
  stepDurationSec: 0.125,
  params: {
    cutoff: 0.35,
    resonance: 0.7,
    envMod: 0.55,
    decay: 0.5,
    accent: 0.7,
    volume: 0.8,
    waveform: 0,
  },
};

const t0 = performance.now();
const samples = renderOfflineHighFid303Pattern(pattern, {
  oversample: 4,
  sampleRate,
});
const latencyMs = performance.now() - t0;
const { buffer, peak } = floatTo16BitWav(samples, sampleRate);

mkdirSync(dirname(args.outPath), { recursive: true });
writeFileSync(args.outPath, buffer);

console.log(
  JSON.stringify(
    {
      engine: 'gpu-highfid topology via highfid-cpu oracle (Node harness)',
      outPath: args.outPath,
      frames: samples.length,
      sampleRate,
      oversample: 4,
      latencyMs: Math.round(latencyMs * 100) / 100,
      peak,
      note: 'Browser WebGpu303Engine uses WGSL when navigator.gpu is present',
    },
    null,
    2,
  ),
);
