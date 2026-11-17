#!/usr/bin/env node
/**
 * Assert that public/rubberband.wasm is real-time safe for the AudioWorklets
 * that load it (#1596 follow-up P2, BUILD_NOTES#rubberband-fixed-memory):
 *   - one defined, non-shared memory that cannot grow (maximum == initial), of the
 *     budget's size when one is given
 *   - no embind runtime and no C++ exception runtime in the glue: this module's
 *     wasm import / export names are minified, so the glue (which binds them by
 *     their JS library names) is where `_embind_*`, `_emval_*`, `__cxa_*` and the
 *     -fexceptions `invoke_*` trampolines show up
 *   - no wasm exception tag (-fwasm-exceptions)
 *   - every rb_* / rb_fx_* export the worklets bind to, as a Module property
 *
 * Usage:
 *   node tools/check_rubberband_module.mjs public/rubberband.wasm src/audio-worklets/rubberband-lib.js [initialMemoryMb]
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWasmMemories } from './check_mix_bus_module.mjs';

/** The stretcher C ABI (rubberband_wrapper.cpp); see src/audio-worklets/rubberband/stretcher.ts. */
export const RB_ABI_VERSION = 1;

/** Glue markers of a runtime no worklet-loaded module may carry. */
export const FORBIDDEN_GLUE_MARKERS = [
  { runtime: 'embind', pattern: /\bembind|_embind_|_emval_|\bregisterType\b/ },
  { runtime: 'C++ exceptions', pattern: /__cxa_|\binvoke_[a-z]+\b|\bgetCppExceptionThrownObject\b/ },
];

/** @returns {string[]} problems; empty when the module is acceptable. */
export function checkRubberBandModule(buf, glue, initialMemoryMb = null, requiredExports = []) {
  const problems = [];
  const module = new WebAssembly.Module(buf);

  const memories = parseWasmMemories(buf);
  if (memories.length !== 1) {
    problems.push(`expected exactly one defined memory, found ${memories.length}`);
  } else {
    const [mem] = memories;
    if (mem.shared) problems.push('memory is shared');
    if (mem.maximum === null) problems.push('memory has no maximum (growth is unbounded)');
    else if (mem.maximum !== mem.initial) {
      problems.push(`memory can grow: initial ${mem.initial} pages, maximum ${mem.maximum} (link with ALLOW_MEMORY_GROWTH=0)`);
    }
    if (initialMemoryMb !== null) {
      const pages = (initialMemoryMb * 1024 * 1024) / 65536;
      if (mem.initial !== pages) problems.push(`memory is ${mem.initial} pages, budget is ${pages} (${initialMemoryMb} MB)`);
    }
  }

  for (const { runtime, pattern } of FORBIDDEN_GLUE_MARKERS) {
    const hit = pattern.exec(glue);
    if (hit) problems.push(`${runtime} runtime is linked (glue mentions "${hit[0]}")`);
  }
  if (WebAssembly.Module.imports(module).some((i) => i.kind === 'tag')
      || WebAssembly.Module.exports(module).some((e) => e.kind === 'tag')) {
    problems.push('uses a wasm exception tag (-fwasm-exceptions)');
  }

  // The glue publishes each export as Module["_name"] = wasmExports["<minified>"].
  const missing = requiredExports.filter((name) => !glue.includes(`Module["_${name}"]`));
  if (missing.length) problems.push(`missing exports: ${missing.join(', ')}`);

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, gluePath, mb] = process.argv.slice(2);
  if (!file || !gluePath) {
    console.error('usage: node tools/check_rubberband_module.mjs <rubberband.wasm> <rubberband-lib.js> [initialMemoryMb]');
    process.exit(2);
  }
  const glue = fs.readFileSync(gluePath, 'utf8');
  const problems = checkRubberBandModule(fs.readFileSync(file), glue, mb === undefined ? null : Number(mb), [
    'rb_abi_version', 'rb_create', 'rb_destroy', 'rb_process', 'rb_retrieve', 'rb_available',
    'rb_fx_create', 'rb_fx_process',
  ]);
  if (problems.length) {
    console.error(`[check_rubberband_module] ${file} is not real-time safe:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[check_rubberband_module] ${file}: OK (fixed unshared memory, no embind, no exceptions)`);
}
