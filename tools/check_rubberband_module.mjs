#!/usr/bin/env node
/**
 * Assert that public/rubberband.wasm is real-time safe for the AudioWorklets
 * that load it, and that the hand instantiation in
 * src/audio-worklets/rubberband/instantiate.ts can satisfy it
 * (#1596 follow-up P2/P3, BUILD_NOTES#rubberband-fixed-memory):
 *   - one defined, non-shared memory that cannot grow (maximum == initial), of the
 *     budget's size when one is given
 *   - no embind runtime and no C++ exception runtime: there is no glue any more,
 *     and the module links with -lexports.js, so the wasm's own import names are
 *     where `_embind_*`, `_emval_*`, `__cxa_*` and the -fexceptions `invoke_*`
 *     trampolines would show up
 *   - no wasm exception tag (-fwasm-exceptions)
 *   - exactly the `rubberband` section of emscripten/wasm_export_manifest.json as
 *     exports: every `required` name, nothing outside `required` + `runtime`
 *   - only the imports that section lists (what instantiate.ts implements)
 *
 * Usage:
 *   node tools/check_rubberband_module.mjs public/rubberband.wasm [initialMemoryMb]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWasmMemories } from './check_mix_bus_module.mjs';

/** The stretcher C ABI (rubberband_wrapper.cpp); see src/audio-worklets/rubberband/stretcher.ts. */
export const RB_ABI_VERSION = 1;

/** The `rubberband` section of emscripten/wasm_export_manifest.json. */
export const RUBBERBAND_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../emscripten/wasm_export_manifest.json'), 'utf8'),
).rubberband;

export const RUBBERBAND_MANIFEST_EXPORTS = RUBBERBAND_MANIFEST.required;

/** Import names of a runtime no worklet-loaded module may carry. */
export const FORBIDDEN_IMPORTS = [
  { runtime: 'embind', pattern: /embind|^_emval_|^_embind_/ },
  { runtime: 'C++ exceptions', pattern: /^__cxa_|^invoke_|^__resumeException$|^llvm_eh_/ },
];

/** A module whose names are single letters was linked without -lexports.js. */
function looksMinified(names) {
  return names.length > 0 && names.every((n) => n.length <= 2);
}

/** @returns {string[]} problems; empty when the module is acceptable. */
export function checkRubberBandModule(buf, initialMemoryMb = null, section = RUBBERBAND_MANIFEST) {
  const problems = [];
  const module = new WebAssembly.Module(buf);
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);

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

  if (looksMinified(exports.map((e) => e.name))) {
    problems.push('export names are minified (link with -lexports.js): instantiate.ts binds them by name');
    return problems;
  }

  for (const { runtime, pattern } of FORBIDDEN_IMPORTS) {
    const hit = imports.find((i) => pattern.test(i.name));
    if (hit) problems.push(`${runtime} runtime is linked (imports ${hit.module}.${hit.name})`);
  }
  if (imports.some((i) => i.kind === 'tag') || exports.some((e) => e.kind === 'tag')) {
    problems.push('uses a wasm exception tag (-fwasm-exceptions)');
  }

  const allowedImports = section.imports ?? {};
  const unknown = imports.filter((i) => !(allowedImports[i.module] ?? []).includes(i.name));
  if (unknown.length) {
    problems.push(
      `imports instantiate.ts does not implement: ${unknown.map((i) => `${i.module}.${i.name} (${i.kind})`).join(', ')} ` +
      '— add them to the manifest\'s rubberband.imports and to rubberband/instantiate.ts',
    );
  }

  const present = new Set(exports.map((e) => e.name));
  const missing = section.required.filter((name) => !present.has(name));
  if (missing.length) problems.push(`missing exports: ${missing.join(', ')}`);
  const declared = new Set([...section.required, ...(section.runtime ?? [])]);
  const extra = [...present].filter((name) => !declared.has(name));
  if (extra.length) problems.push(`exports not in the manifest's rubberband section: ${extra.join(', ')}`);
  if (!present.has('__wasm_call_ctors')) problems.push('no __wasm_call_ctors export (link with --no-entry)');

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, mb] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node tools/check_rubberband_module.mjs <rubberband.wasm> [initialMemoryMb]');
    process.exit(2);
  }
  const problems = checkRubberBandModule(fs.readFileSync(file), mb === undefined ? null : Number(mb));
  if (problems.length) {
    console.error(`[check_rubberband_module] ${file} is not real-time safe:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[check_rubberband_module] ${file}: OK (fixed unshared memory, no embind, no exceptions, no glue)`);
}
