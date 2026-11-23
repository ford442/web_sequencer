#!/usr/bin/env node
/**
 * Assert that public/dwgs_osc.wasm is the module #1666 promises:
 *   - zero imports (instantiated by hand in an AudioWorkletGlobalScope with `{}`)
 *   - one defined memory, not shared, that cannot grow, sized exactly as the
 *     `dwgsOsc` section of emscripten/wasm_memory_budget.json says
 *   - exactly the `dwgsOsc` exports of emscripten/wasm_export_manifest.json
 *   - the ABI version and wave count the worklet binds to
 *   - scalar: no v128 in any signature or local, so it runs without WASM SIMD
 *   - it initialises, and renders a non-silent, finite block of every wave
 *
 * Exported for scripts/build-dwgs-osc.mjs (fails the build), for
 * scripts/check-release-dist.mjs (fails the release) and for
 * src/__tests__/dwgsOscModule.test.ts.
 *
 * Usage: node tools/check_dwgs_osc_module.mjs public/dwgs_osc.wasm
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usesV128 } from './check_cpp_osc_module.mjs';
import { parseWasmMemories } from './check_mix_bus_module.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DWGS_OSC_REQUIRED_EXPORTS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'emscripten/wasm_export_manifest.json'), 'utf8'),
).dwgsOsc.required;

export const DWGS_OSC_BUDGET = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'emscripten/wasm_memory_budget.json'), 'utf8'),
).dwgsOsc;

/** Must equal `ABI_VERSION` in dwgs-audio/src/lib.rs and the worklet's constant. */
export const DWGS_OSC_ABI_VERSION = 1;

/** Must equal `WAVE_COUNT` in dwgs-audio/src/lib.rs and `DWGS_WAVES.length`. */
export const DWGS_OSC_WAVE_COUNT = 17;

/** Frames rendered per wave by the smoke render (a 220 Hz note: ~1/3 cycle at 48 kHz). */
const CHECK_FRAMES = 64;

/** @returns {string[]} problems; empty when the module is acceptable. */
export function checkDwgsOscModule(buf) {
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
    const pages = DWGS_OSC_BUDGET.initialMemoryPages;
    if (mem.shared) problems.push('memory is shared (would need a SharedArrayBuffer)');
    if (mem.maximum === null) problems.push('memory has no maximum (growth is unbounded)');
    else if (mem.maximum !== mem.initial) {
      problems.push(`memory can grow: initial ${mem.initial} pages, maximum ${mem.maximum}`);
    }
    if (mem.initial !== pages) {
      problems.push(`memory is ${mem.initial} pages, wasm_memory_budget.json dwgsOsc says ${pages}`);
    }
  }

  const exportNames = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
  if (!exportNames.has('memory')) problems.push('memory is not exported');
  const missing = DWGS_OSC_REQUIRED_EXPORTS.filter((name) => !exportNames.has(name));
  if (missing.length) problems.push(`missing exports: ${missing.join(', ')}`);
  const allowed = new Set(['memory', ...DWGS_OSC_REQUIRED_EXPORTS]);
  const extra = [...exportNames].filter((name) => !allowed.has(name));
  if (extra.length) problems.push(`exports not in the manifest's dwgsOsc section: ${extra.join(', ')}`);

  if (usesV128(buf)) {
    problems.push('module uses v128: dwgs_osc.wasm is scalar so it runs without WASM SIMD');
  }

  if (!problems.length) {
    const { exports } = new WebAssembly.Instance(module, {});
    const abi = exports.dwgs_abi_version();
    if (abi !== DWGS_OSC_ABI_VERSION) problems.push(`ABI version ${abi}, expected ${DWGS_OSC_ABI_VERSION}`);
    const waves = exports.dwgs_wave_count();
    if (waves !== DWGS_OSC_WAVE_COUNT) problems.push(`dwgs_wave_count() is ${waves}, expected ${DWGS_OSC_WAVE_COUNT}`);
    const max = exports.dwgs_max_frames();
    for (const name of ['dwgs_freq_ptr', 'dwgs_out_ptr']) {
      if (exports[name]() + max * 4 > exports.memory.buffer.byteLength) {
        problems.push(`${name} buffer runs past the end of memory`);
      }
    }
    if (exports.dwgs_init(48000) !== 1) {
      problems.push('dwgs_init(48000) did not return 1');
    } else if (!problems.length) {
      const freq = new Float32Array(exports.memory.buffer, exports.dwgs_freq_ptr(), max);
      const out = new Float32Array(exports.memory.buffer, exports.dwgs_out_ptr(), max);
      freq[0] = 220;
      for (let wave = 0; wave < waves; wave++) {
        exports.dwgs_reset(0);
        if (exports.dwgs_render(wave, CHECK_FRAMES, 0) !== CHECK_FRAMES) {
          problems.push(`dwgs_render(${wave}) did not render ${CHECK_FRAMES} frames`);
          continue;
        }
        let energy = 0;
        let finite = true;
        for (let i = 0; i < CHECK_FRAMES; i++) {
          if (!Number.isFinite(out[i])) finite = false;
          energy += out[i] * out[i];
        }
        if (!finite) problems.push(`wave ${wave} rendered a non-finite sample`);
        else if (energy < 1e-4) problems.push(`wave ${wave} rendered silence`);
      }
    }
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/check_dwgs_osc_module.mjs <dwgs_osc.wasm>');
    process.exit(2);
  }
  const problems = checkDwgsOscModule(fs.readFileSync(file));
  if (problems.length) {
    console.error(`[check_dwgs_osc_module] ${file} is not a valid dwgs-* oscillator module:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `[check_dwgs_osc_module] ${file}: OK (no imports, fixed ${DWGS_OSC_BUDGET.initialMemoryPages}-page memory, `
    + `scalar, ${DWGS_OSC_WAVE_COUNT} waves, ABI ${DWGS_OSC_ABI_VERSION})`,
  );
}
