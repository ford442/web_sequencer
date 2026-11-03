#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.
//
// Checks openrb338.wasm against upstream openrb-338's native renders, through the C ABI only,
// the way the 303 worklet will drive it.
//
//   node openrb338/tools/verify-wasm.mjs <openrb338.wasm> <reference dir>
//
// The reference dir comes from `cargo run --release --example reference_render`. At 44.1 kHz
// every sample must match bit for bit, whatever the render chunking; at 48 / 96 kHz (resampled)
// the level must stay within 0.5 dB. Also reports the render cost per 128-frame quantum.
// The optional low-pass group (`openrb_lp_*`, the patch bay's openrb low-pass) is checked the
// same way against `<reference dir>/lowpass/`: bit for bit at 44.1 kHz in every chunking.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [wasmPath, refDir] = process.argv.slice(2);
if (!wasmPath || !refDir) {
  console.error('usage: verify-wasm.mjs <openrb338.wasm> <reference dir>');
  process.exit(2);
}

const ABI_VERSION = 1; // OPENRB338_ABI_VERSION in src/audio-worklets/openrb338.ts
const REQUIRED = [
  'openrb303_abi_version', 'openrb303_create', 'openrb303_destroy', 'openrb303_set_mode',
  'openrb303_set_param', 'openrb303_note_on', 'openrb303_note_off', 'openrb303_all_notes_off',
  'openrb303_buffer', 'openrb303_render',
];

const module = await WebAssembly.compile(readFileSync(wasmPath));
const imports = WebAssembly.Module.imports(module);
if (imports.length > 0) {
  console.error('FAIL: the module has imports:', imports);
  process.exit(1);
}
const { exports: x } = await WebAssembly.instantiate(module, {});
for (const name of REQUIRED) {
  if (typeof x[name] !== 'function') {
    console.error(`FAIL: missing export ${name}`);
    process.exit(1);
  }
}
if (!(x.memory instanceof WebAssembly.Memory) || x.openrb303_abi_version() !== ABI_VERSION) {
  console.error('FAIL: no memory export or ABI mismatch');
  process.exit(1);
}

const MAX_FRAMES = 4096;

/** Render a scenario's host events at `rate`, in `chunks`-sized calls split at event frames. */
function render(mode, frames, events, rate, chunks) {
  const h = x.openrb303_create(rate, mode);
  if (h === 0) throw new Error(`create(${rate}, ${mode}) failed`);
  const ptr = x.openrb303_buffer(h, MAX_FRAMES) >>> 0;
  const scale = rate / 44100;
  const total = Math.floor(frames * scale);
  const evs = events.map(([f, kind, a, b]) => [Math.round(f * scale), kind, a, b]);
  const out = new Float32Array(total);
  let pos = 0;
  let next = 0;
  let c = 0;
  let renderMs = 0;
  while (pos < total) {
    while (next < evs.length && evs[next][0] <= pos) {
      const [, kind, a, b] = evs[next++];
      switch (kind) {
        case 'on': x.openrb303_note_on(h, a, b); break;
        case 'off': x.openrb303_note_off(h, a); break;
        case 'rest': x.openrb303_rest(h, a, b); break;
        case 'param': x.openrb303_set_param(h, a, b); break;
        case 'mode': x.openrb303_set_mode(h, a); break;
        case 'alloff': x.openrb303_all_notes_off(h); break;
        default: throw new Error(`unknown event ${kind}`);
      }
    }
    const limit = Math.min(next < evs.length ? evs[next][0] : total, total);
    const n = Math.min(chunks[c++ % chunks.length], limit - pos);
    const t0 = performance.now();
    x.openrb303_render(h, n);
    renderMs += performance.now() - t0;
    // A fresh view each call: the memory may have grown (no allocation happens here, but a
    // worklet should not rely on that either).
    out.set(new Float32Array(x.memory.buffer, ptr, n), pos);
    pos += n;
  }
  x.openrb303_destroy(h);
  return { out, renderMs };
}

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

const manifest = JSON.parse(readFileSync(join(refDir, 'manifest.json'), 'utf8'));
let failed = 0;
let audioSeconds = 0;
let renderMs = 0;
for (const sc of manifest) {
  const bytes = readFileSync(join(refDir, `${sc.name}.f32`));
  const ref = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const refBits = new Uint32Array(ref.buffer, ref.byteOffset, ref.length);
  const events = JSON.parse(readFileSync(join(refDir, `${sc.name}.events.json`), 'utf8'));
  if (ref.length !== sc.frames) throw new Error(`${sc.name}: reference length`);

  for (const chunks of [[128], [64], [37, 91, 200, 1, 128], [4096]]) {
    const { out, renderMs: ms } = render(sc.mode, sc.frames, events, 44100, chunks);
    const bits = new Uint32Array(out.buffer);
    let diff = -1;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== refBits[i]) { diff = i; break; }
    }
    if (diff >= 0) {
      failed++;
      console.log(`FAIL ${sc.name} @44.1k chunks=${chunks}: sample ${diff} ref ${ref[diff]} wasm ${out[diff]}`);
    }
    if (chunks[0] === 128 && chunks.length === 1) {
      audioSeconds += sc.frames / 44100;
      renderMs += ms;
    }
  }

  const levels = [];
  for (const rate of [48000, 96000]) {
    const { out } = render(sc.mode, sc.frames, events, rate, [128]);
    const finite = out.every(Number.isFinite);
    const db = 20 * Math.log10(rms(out) / rms(ref));
    levels.push(`${rate / 1000}k ${db >= 0 ? '+' : ''}${db.toFixed(3)} dB`);
    if (!finite || Math.abs(db) > 0.5) {
      failed++;
      console.log(`FAIL ${sc.name} @${rate}: finite=${finite} level ${db.toFixed(3)} dB`);
    }
  }
  const peak = ref.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  console.log(`ok   ${sc.name.padEnd(22)} ${sc.frames} frames, peak ${peak.toFixed(3)}, bit-exact @44.1k; ${levels.join(', ')}`);
}

// ---------------------------------------------------------------- low-pass group

const LP_VERSION = 1; // OPENRB_LP_VERSION in src/audio-worklets/openrbLowpass.ts
const LP_REQUIRED = [
  'openrb_lp_version', 'openrb_lp_create', 'openrb_lp_destroy', 'openrb_lp_set_param',
  'openrb_lp_reset', 'openrb_lp_buffer', 'openrb_lp_process', 'openrb_lp_is_bit_exact',
];
const LP_FREQUENCY = 0;
const LP_RESONANCE = 1;
let lpCases = 0;
let lpMs = 0;
let lpSeconds = 0;
if (LP_REQUIRED.some((name) => typeof x[name] !== 'function') || x.openrb_lp_version() !== LP_VERSION) {
  failed++;
  console.log('FAIL: the low-pass group (openrb_lp_*) is missing or has another version');
} else {
  const lpDir = join(refDir, 'lowpass');
  const lpManifest = JSON.parse(readFileSync(join(lpDir, 'manifest.json'), 'utf8'));
  const f32 = (file) => {
    const b = readFileSync(join(lpDir, file));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  for (const lc of lpManifest) {
    const input = f32(`${lc.name}.in.f32`);
    const ref = f32(`${lc.name}.f32`);
    const refBits = new Uint32Array(ref.buffer);
    for (const chunks of [[128], [64], [37, 91, 200, 1, 128], [4096]]) {
      const h = x.openrb_lp_create(44100);
      const ptr = x.openrb_lp_buffer(h, MAX_FRAMES) >>> 0;
      x.openrb_lp_set_param(h, LP_FREQUENCY, lc.frequency);
      x.openrb_lp_set_param(h, LP_RESONANCE, lc.resonance);
      const out = new Float32Array(lc.frames);
      let pos = 0;
      let next = 0;
      let c = 0;
      const t0 = performance.now();
      while (pos < lc.frames) {
        while (next < lc.moves.length && lc.moves[next][0] * 64 <= pos) {
          const [, knob, v] = lc.moves[next++];
          x.openrb_lp_set_param(h, knob === 'f' ? LP_FREQUENCY : LP_RESONANCE, v);
        }
        const limit = next < lc.moves.length ? lc.moves[next][0] * 64 : lc.frames;
        const n = Math.min(chunks[c++ % chunks.length], limit - pos);
        new Float32Array(x.memory.buffer, ptr, n).set(input.subarray(pos, pos + n));
        x.openrb_lp_process(h, n);
        out.set(new Float32Array(x.memory.buffer, ptr, n), pos);
        pos += n;
      }
      if (chunks.length === 1 && chunks[0] === 128) {
        lpMs += performance.now() - t0;
        lpSeconds += lc.frames / 44100;
      }
      x.openrb_lp_destroy(h);
      const bits = new Uint32Array(out.buffer);
      const diff = bits.findIndex((v, i) => v !== refBits[i]);
      if (diff >= 0) {
        failed++;
        console.log(`FAIL lowpass ${lc.name} chunks=${chunks}: sample ${diff} ref ${ref[diff]} wasm ${out[diff]}`);
      }
    }
    lpCases++;
    console.log(`ok   lowpass ${lc.name.padEnd(14)} ${lc.frames} frames, bit-exact @44.1k`);
  }
  const q = (lpSeconds * 44100) / 128;
  console.log(`low-pass cost: ${((lpMs * 1000) / q).toFixed(2)} µs per 128-frame quantum (one channel)`);
}

const quanta = (audioSeconds * 44100) / 128;
const usPerQuantum = (renderMs * 1000) / quanta;
console.log(
  `render cost: ${usPerQuantum.toFixed(2)} µs per 128-frame quantum ` +
  `(${((usPerQuantum / ((128 / 44100) * 1e6)) * 100).toFixed(2)}% of real time, one voice)`,
);
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log(
  `PASS: ${manifest.length} scenarios + ${lpCases} low-pass cases, openrb338.wasm == openrb-338 (native) bit for bit at 44.1 kHz`,
);
