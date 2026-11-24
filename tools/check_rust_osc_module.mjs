#!/usr/bin/env node
/**
 * Assert that public/rust_osc.wasm is the module #1664 promises:
 *   - zero imports (instantiated by hand in an AudioWorkletGlobalScope with `{}`)
 *   - one defined memory, not shared, that cannot grow, sized exactly as the
 *     `rustOsc` section of emscripten/wasm_memory_budget.json says
 *   - exactly the `rustOsc` exports of emscripten/wasm_export_manifest.json
 *     (the oscillator and the Rust filter, #1672)
 *   - the ABI version the worklet binds to, and the v128 render path compiled in
 *     (a scalar-only build would make "SIMD Rust oscillator" a label, not a fact)
 *
 * Exported for scripts/build-rust-osc.mjs (fails the build), for
 * scripts/check-release-dist.mjs (fails the release) and for
 * src/__tests__/rustOscModule.test.ts.
 *
 * Usage: node tools/check_rust_osc_module.mjs public/rust_osc.wasm
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWasmMemories } from './check_mix_bus_module.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const RUST_OSC_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'emscripten/wasm_export_manifest.json'), 'utf8'),
).rustOsc;

/** The oscillator exports (`rosc_*`) and the Rust filter exports (`rflt_*`, #1672), one module. */
export const RUST_OSC_REQUIRED_EXPORTS = [...RUST_OSC_MANIFEST.required, ...RUST_OSC_MANIFEST.requiredFilter];

export const RUST_OSC_BUDGET = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'emscripten/wasm_memory_budget.json'), 'utf8'),
).rustOsc;

/** Must equal `ABI_VERSION` in rust-audio/src/lib.rs and the worklet's constant. */
export const RUST_OSC_ABI_VERSION = 2;

/** @returns {string[]} problems; empty when the module is acceptable. */
export function checkRustOscModule(buf) {
  const problems = [];
  let module;
  try {
    module = new WebAssembly.Module(buf);
  } catch (e) {
    return [`does not compile: ${e instanceof Error ? e.message : String(e)}`];
  }

  const imports = WebAssembly.Module.imports(module);
  if (imports.length) {
    problems.push(
      `expected zero imports, found ${imports.length}: `
      + imports.map((i) => `${i.module}.${i.name}`).join(', '),
    );
  }

  const memories = parseWasmMemories(buf);
  if (memories.length !== 1) {
    problems.push(`expected exactly one defined memory, found ${memories.length}`);
  } else {
    const [mem] = memories;
    const pages = RUST_OSC_BUDGET.initialMemoryPages;
    if (mem.shared) problems.push('memory is shared (would need a SharedArrayBuffer)');
    if (mem.maximum === null) problems.push('memory has no maximum (growth is unbounded)');
    else if (mem.maximum !== mem.initial) {
      problems.push(`memory can grow: initial ${mem.initial} pages, maximum ${mem.maximum}`);
    }
    if (mem.initial !== pages) {
      problems.push(`memory is ${mem.initial} pages, wasm_memory_budget.json rustOsc says ${pages}`);
    }
  }

  const exportNames = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
  if (!exportNames.has('memory')) problems.push('memory is not exported');
  const missing = RUST_OSC_REQUIRED_EXPORTS.filter((name) => !exportNames.has(name));
  if (missing.length) problems.push(`missing exports: ${missing.join(', ')}`);
  const allowed = new Set(['memory', ...RUST_OSC_REQUIRED_EXPORTS]);
  const extra = [...exportNames].filter((name) => !allowed.has(name));
  if (extra.length) problems.push(`exports not in the manifest's rustOsc section: ${extra.join(', ')}`);

  if (!problems.length) {
    const { exports } = new WebAssembly.Instance(module, {});
    const abi = exports.rosc_abi_version();
    if (abi !== RUST_OSC_ABI_VERSION) problems.push(`ABI version ${abi}, expected ${RUST_OSC_ABI_VERSION}`);
    if (exports.rosc_simd() !== 1) problems.push('rosc_simd() is 0: the v128 render path was not compiled in');
    const bytes = exports.rosc_max_frames() * 4;
    for (const name of ['rosc_freq_ptr', 'rosc_out_ptr']) {
      if (exports[name]() + bytes > exports.memory.buffer.byteLength) {
        problems.push(`${name} buffer runs past the end of memory`);
      }
    }
    if (exports.rosc_init(48000) !== 1) problems.push('rosc_init(48000) did not return 1');
    if (exports.rflt_buf_ptr() + bytes > exports.memory.buffer.byteLength) {
      problems.push('rflt_buf_ptr buffer runs past the end of memory');
    }
    if (exports.rflt_configure(48000, 1000, 0.7071, 0) !== 1) {
      problems.push('rflt_configure(48000, 1000, 0.7071, lowpass) did not return 1');
    }
    if (exports.rflt_configure(48000, 1000, 0.7071, 99) !== 0) {
      problems.push('rflt_configure accepted an unknown filter type');
    }
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/check_rust_osc_module.mjs <rust_osc.wasm>');
    process.exit(2);
  }
  const problems = checkRustOscModule(fs.readFileSync(file));
  if (problems.length) {
    console.error(`[check_rust_osc_module] ${file} is not a valid rust-* oscillator module:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `[check_rust_osc_module] ${file}: OK (no imports, fixed ${RUST_OSC_BUDGET.initialMemoryPages}-page memory, `
    + `SIMD, ABI ${RUST_OSC_ABI_VERSION})`,
  );
}
