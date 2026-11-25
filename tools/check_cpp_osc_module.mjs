#!/usr/bin/env node
/**
 * Assert that public/cpp_osc.wasm (and its scalar twin, public/cpp_osc_scalar.wasm,
 * #1667) is the module #1665 promises:
 *   - zero imports (instantiated by hand in an AudioWorkletGlobalScope with `{}`)
 *   - one defined memory, not shared, that cannot grow, sized exactly as the
 *     `cppOsc` section of emscripten/wasm_memory_budget.json says
 *   - exactly the `cppOsc` exports of emscripten/wasm_export_manifest.json
 *     (plus `memory` / `_initialize` and the section's `runtime` names): the
 *     oscillator's `cosc_*` and the C++ filter's `cflt_*` (#1673), one module
 *   - the build it claims to be (`--variant`, default `simd`): the SIMD build
 *     holds v128 code (its wasm_simd128.h paths were compiled in, not dropped by
 *     a missing -msimd128), and the scalar twin holds none, so it validates where
 *     WASM SIMD does not — a v128 creeping into it would break that silently
 *   - the ABI version the worklet binds to, and a working init
 *
 * Exported for emscripten/build_cpp_osc.sh (fails the build), for
 * scripts/check-release-dist.mjs (fails the release) and for
 * src/__tests__/cppOscModule.test.ts.
 *
 * Usage: node tools/check_cpp_osc_module.mjs public/cpp_osc.wasm [--variant simd|scalar]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWasmMemories } from './check_mix_bus_module.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const SECTION = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'emscripten/wasm_export_manifest.json'), 'utf8'),
).cppOsc;
export const CPP_OSC_REQUIRED_EXPORTS = SECTION.required;
/** Exports Emscripten adds on its own (the section's `runtime` bucket). */
const CPP_OSC_RUNTIME_EXPORTS = SECTION.runtime ?? [];

export const CPP_OSC_BUDGET = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'emscripten/wasm_memory_budget.json'), 'utf8'),
).cppOsc;

/** Must equal `kAbiVersion` in emscripten/cpp_osc.cpp and the worklet's constant. */
export const CPP_OSC_ABI_VERSION = 2;

/**
 * The two builds of emscripten/cpp_osc.cpp (emscripten/build_cpp_osc.sh) and the
 * file each ships as. src/engines/CppOscillator.ts loads `scalar` only where
 * the `simd` bytes do not validate.
 */
export const CPP_OSC_VARIANT_FILES = Object.freeze({
  simd: 'cpp_osc.wasm',
  scalar: 'cpp_osc_scalar.wasm',
});

/**
 * True when any function signature or declared local is a v128. Sound for what
 * it inspects (types and locals are unambiguous to parse), and that is where a
 * SIMD build shows up: clang keeps vectors in v128 locals. It does not decode
 * instruction bodies (src/audio-worklets/__tests__/cppOscSimd.realWasm.test.ts
 * reads the disassembly for that); it tells the two builds apart.
 */
export function usesV128(buf) {
  const bytes = new Uint8Array(buf);
  let pos = 8;
  const readLeb = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[pos++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if ((b & 0x80) === 0) return result;
    }
  };
  while (pos < bytes.length) {
    const id = bytes[pos++];
    const size = readLeb();
    const end = pos + size;
    if (id === 1) {
      // Type section: each entry is 0x60, params, results; v128 is 0x7b.
      const count = readLeb();
      for (let i = 0; i < count; i++) {
        if (bytes[pos++] !== 0x60) break;
        for (let group = 0; group < 2; group++) {
          const n = readLeb();
          for (let k = 0; k < n; k++) if (bytes[pos++] === 0x7b) return true;
        }
      }
    } else if (id === 10) {
      // Code section: each body opens with its local declarations.
      const count = readLeb();
      for (let i = 0; i < count; i++) {
        const bodySize = readLeb();
        const bodyEnd = pos + bodySize;
        const groups = readLeb();
        for (let g = 0; g < groups; g++) {
          readLeb();
          if (bytes[pos++] === 0x7b) return true;
        }
        pos = bodyEnd;
      }
    }
    pos = end;
  }
  return false;
}

/**
 * @param {ArrayBuffer | Uint8Array} buf
 * @param {{ variant?: 'simd' | 'scalar' }} [options]
 * @returns {string[]} problems; empty when the module is acceptable.
 */
export function checkCppOscModule(buf, { variant = 'simd' } = {}) {
  const problems = [];
  if (!Object.hasOwn(CPP_OSC_VARIANT_FILES, variant)) return [`unknown variant '${variant}' (simd or scalar)`];
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
    const pages = CPP_OSC_BUDGET.initialMemoryPages;
    if (mem.shared) problems.push('memory is shared (would need a SharedArrayBuffer)');
    if (mem.maximum === null) problems.push('memory has no maximum (growth is unbounded)');
    else if (mem.maximum !== mem.initial) {
      problems.push(`memory can grow: initial ${mem.initial} pages, maximum ${mem.maximum}`);
    }
    if (mem.initial !== pages) {
      problems.push(`memory is ${mem.initial} pages, wasm_memory_budget.json cppOsc says ${pages}`);
    }
  }

  const v128 = usesV128(buf);
  if (variant === 'scalar' && v128) {
    problems.push('module uses v128: the scalar build must stay scalar (it is the no-SIMD fallback for rust-*)');
  } else if (variant === 'simd' && !v128) {
    problems.push('module uses no v128: the SIMD build was compiled without -msimd128 (its wasm_simd128.h paths are missing)');
  }

  const exportNames = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
  if (!exportNames.has('memory')) problems.push('memory is not exported');
  const missing = CPP_OSC_REQUIRED_EXPORTS.filter((name) => !exportNames.has(name));
  if (missing.length) problems.push(`missing exports: ${missing.join(', ')}`);
  const allowed = new Set(['memory', '_initialize', ...CPP_OSC_REQUIRED_EXPORTS, ...CPP_OSC_RUNTIME_EXPORTS]);
  const extra = [...exportNames].filter((name) => !allowed.has(name));
  if (extra.length) problems.push(`exports not in the manifest's cppOsc section: ${extra.join(', ')}`);

  if (!problems.length) {
    const { exports } = new WebAssembly.Instance(module, {});
    exports._initialize?.();
    const abi = exports.cosc_abi_version();
    if (abi !== CPP_OSC_ABI_VERSION) problems.push(`ABI version ${abi}, expected ${CPP_OSC_ABI_VERSION}`);
    const bytes = exports.cosc_max_frames() * 4;
    for (const name of ['cosc_freq_ptr', 'cosc_out_ptr', 'cflt_buf_ptr']) {
      if (exports[name]() + bytes > exports.memory.buffer.byteLength) {
        problems.push(`${name} buffer runs past the end of memory`);
      }
    }
    if (exports.cosc_init(48000) !== 1) problems.push('cosc_init(48000) did not return 1');
    if (exports.cflt_configure(48000, 1000, 0.7071, 0) !== 1) {
      problems.push('cflt_configure(48000, 1000, 0.7071, lowpass) did not return 1');
    }
    if (exports.cflt_configure(48000, 1000, 0.7071, 99) !== 0) {
      problems.push('cflt_configure accepted an unknown filter type');
    }
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--variant');
  const variant = flag >= 0 ? args[flag + 1] : 'simd';
  const file = args.find((a, i) => !a.startsWith('--') && (flag < 0 || i !== flag + 1));
  if (!file) {
    console.error('usage: node tools/check_cpp_osc_module.mjs <cpp_osc.wasm> [--variant simd|scalar]');
    process.exit(2);
  }
  const problems = checkCppOscModule(fs.readFileSync(file), { variant });
  if (problems.length) {
    console.error(`[check_cpp_osc_module] ${file} is not a valid cpp-* oscillator module:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `[check_cpp_osc_module] ${file}: OK (no imports, fixed ${CPP_OSC_BUDGET.initialMemoryPages}-page memory, `
    + `${variant}, ABI ${CPP_OSC_ABI_VERSION})`,
  );
}
