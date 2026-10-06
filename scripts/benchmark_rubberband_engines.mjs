#!/usr/bin/env node
/**
 * Rubber Band R2 (OptionEngineFaster) vs R3 (OptionEngineFiner) CPU benchmark
 * for the shipped stretch profiles (follow-up to #1297).
 *
 * Drives real-time mono RubberBandStretcher instances from public/rubberband.wasm
 * the way the rubberband worklet does (feed getSamplesRequired, retrieve one
 * 128-frame quantum) and reports per-quantum cost as % of the 48 kHz quantum
 * budget. N concurrent stretchers run back to back on one thread, which is the
 * audio-thread worst case for N voices. Node wasm speed is not browser
 * AudioWorklet speed; read the R3/R2 ratio, not the absolute numbers.
 *
 * Usage:
 *   pnpm exec vite-node scripts/benchmark_rubberband_engines.mjs
 *   pnpm exec vite-node scripts/benchmark_rubberband_engines.mjs --json test-results/rb-engines.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadRubberBandFxModule, makeVocalSignal, QUANTUM } from '../src/test/helpers/vocalFxHarness.ts';
import { RUBBERBAND_OPTIONS, getStretchProfileOptions } from '../src/engines/rubberband/stretchProfiles.ts';

const SAMPLE_RATE = 48000;
const QUANTUM_US = (QUANTUM / SAMPLE_RATE) * 1e6;
const WARMUP_QUANTA = 150;
const MEASURE_QUANTA = 750; // ~2 s of audio
const VOICE_COUNTS = [1, 4, 6, 12];
const PITCH_SCALES = [1.0, 1.26, 0.75];
const IO_FRAMES = 8192;

function parseArgs(argv) {
  const out = { jsonPath: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--json' && argv[i + 1]) out.jsonPath = resolve(argv[++i]);
  }
  return out;
}

const FINER = RUBBERBAND_OPTIONS.OptionEngineFiner;
const CONFIGS = [
  { name: 'vocal R2', mask: getStretchProfileOptions('vocal') },
  { name: 'vocal R3', mask: getStretchProfileOptions('vocal') | FINER },
  { name: 'harmonic R2', mask: getStretchProfileOptions('harmonic') },
  { name: 'harmonic R3', mask: getStretchProfileOptions('harmonic') | FINER },
  { name: 'fast R2', mask: getStretchProfileOptions('fast') },
];

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function runCase(wasm, vocal, ioPtr, mask, pitch, voices) {
  const heapBefore = wasm.HEAPF32.buffer.byteLength;
  const voiceStates = [];
  for (let v = 0; v < voices; v++) {
    const s = new wasm.RubberBandStretcher(SAMPLE_RATE, 1, mask, 1.0, 1.0);
    s.setPitchScale(pitch);
    // Stagger read cursors so voices are not phase-locked to the same frame.
    voiceStates.push({ s, cursor: (v * 4801) % (vocal.length - IO_FRAMES) });
  }

  const times = new Float64Array(MEASURE_QUANTA);
  for (let q = 0; q < WARMUP_QUANTA + MEASURE_QUANTA; q++) {
    const t0 = performance.now();
    for (const st of voiceStates) {
      // Same loop shape as rubberband-processor: feed until a quantum is available.
      while (st.s.available() < QUANTUM) {
        const need = Math.min(Math.max(st.s.getSamplesRequired(), 1), IO_FRAMES);
        if (st.cursor + need >= vocal.length) st.cursor = 0;
        wasm.HEAPF32.set(vocal.subarray(st.cursor, st.cursor + need), ioPtr >> 2);
        st.cursor += need;
        st.s.process(ioPtr, need, false);
      }
      st.s.retrieve(ioPtr, QUANTUM);
    }
    const us = (performance.now() - t0) * 1000;
    if (q >= WARMUP_QUANTA) times[q - WARMUP_QUANTA] = us;
  }
  const heapAfter = wasm.HEAPF32.buffer.byteLength;
  const latency = voiceStates[0].s.getLatency?.() ?? null;
  for (const st of voiceStates) st.s.delete?.();

  const sorted = Float64Array.from(times).sort();
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const pct = (us) => Math.round((us / QUANTUM_US) * 1000) / 10;
  return {
    meanPct: pct(mean),
    p50Pct: pct(percentile(sorted, 0.5)),
    p95Pct: pct(percentile(sorted, 0.95)),
    maxPct: pct(sorted[sorted.length - 1]),
    overruns: Array.from(times).filter((t) => t > QUANTUM_US).length,
    heapGrowthMb: Math.round(((heapAfter - heapBefore) / 1048576) * 10) / 10,
    heapMb: Math.round((heapAfter / 1048576) * 10) / 10,
    latencyFrames: latency,
  };
}

async function main() {
  const { jsonPath } = parseArgs(process.argv);
  const vocal = makeVocalSignal(SAMPLE_RATE, 10);
  const rows = [];

  for (const cfg of CONFIGS) {
    for (const pitch of PITCH_SCALES) {
      for (const voices of VOICE_COUNTS) {
        // Fresh module per case: heap growth is attributable to this case only.
        const wasm = await loadRubberBandFxModule();
        const ioPtr = wasm._malloc(IO_FRAMES * 4);
        const result = runCase(wasm, vocal, ioPtr, cfg.mask, pitch, voices);
        rows.push({ config: cfg.name, mask: cfg.mask, pitch, voices, ...result });
      }
    }
  }

  console.log(`\nquantum budget ${QUANTUM_US.toFixed(0)} us (${QUANTUM} frames @ ${SAMPLE_RATE} Hz); CPU % = cost of ALL N voices per quantum\n`);
  console.log('config        pitch  N   mean%   p50%   p95%   max%  overruns  heapMB(+grow)  latency');
  for (const r of rows) {
    console.log(
      `${r.config.padEnd(13)} ${String(r.pitch).padEnd(5)} ${String(r.voices).padStart(2)} `
      + `${String(r.meanPct).padStart(7)} ${String(r.p50Pct).padStart(6)} ${String(r.p95Pct).padStart(6)} ${String(r.maxPct).padStart(6)} `
      + `${String(r.overruns).padStart(9)}  ${String(r.heapMb).padStart(6)}(+${r.heapGrowthMb})  ${r.latencyFrames ?? '-'}`,
    );
  }

  console.log('\nR3 / R2 mean-CPU ratio');
  for (const profile of ['vocal', 'harmonic']) {
    for (const pitch of PITCH_SCALES) {
      const parts = VOICE_COUNTS.map((n) => {
        const r2 = rows.find((r) => r.config === `${profile} R2` && r.pitch === pitch && r.voices === n);
        const r3 = rows.find((r) => r.config === `${profile} R3` && r.pitch === pitch && r.voices === n);
        return `N=${n}: ${(r3.meanPct / Math.max(r2.meanPct, 0.01)).toFixed(1)}x`;
      });
      console.log(`  ${profile.padEnd(9)} pitch ${String(pitch).padEnd(5)} ${parts.join('  ')}`);
    }
  }

  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify({ sampleRate: SAMPLE_RATE, quantum: QUANTUM, rows }, null, 2));
    console.log(`\nwrote ${jsonPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
