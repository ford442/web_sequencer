#!/usr/bin/env node
/**
 * Assert that public/hyphon_native.st.wasm is really single-threaded:
 *   - imports exactly one memory, and it is NOT shared
 *   - no pthread / worker / emscripten_run_script imports
 * and that neither voice module (ST or pthread) carries a runtime it has no
 * caller for: libomp, embind, or emscripten_run_script (FORBIDDEN_SYMBOLS).
 *
 * WebAssembly.Module.imports() does not report `shared`, so the import section is
 * parsed directly. The symbol scan is over the raw bytes rather than a
 * `wasm-objdump -x` listing: it sees the same import / export / name-section
 * strings that listing prints, plus the runtimes' own data strings (libomp's
 * KMP_* environment names), and it needs no wabt install on the CI runner.
 *
 * Usage:
 *   node tools/check_hyphon_st_module.mjs public/hyphon_native.st.wasm
 *   node tools/check_hyphon_st_module.mjs --symbols-only public/hyphon_native.wasm
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_IMPORT = /pthread|emscripten_run_script|_emscripten_thread|mailbox|wasm_worker/;

/**
 * Byte strings that only appear in a module that links the runtime they name.
 * libomp: the __kmpc_* entry points and its KMP_* / OMP_* environment names.
 * embind: the _embind_register_* imports and the emval bridge.
 * emscripten_run_script: main()'s Pyodide hop, gone with emscripten/main.cpp.
 */
export const FORBIDDEN_SYMBOLS = [
  { runtime: 'libomp', marker: '__kmpc_' },
  { runtime: 'libomp', marker: 'KMP_AFFINITY' },
  { runtime: 'libomp', marker: 'OMP_NUM_THREADS' },
  { runtime: 'embind', marker: '_embind_' },
  { runtime: 'embind', marker: '_emval_' },
  { runtime: 'emscripten_run_script', marker: 'emscripten_run_script' },
];

/** @returns {string[]} problems; empty when no forbidden runtime is linked. */
export function checkForbiddenSymbols(buf) {
  const bytes = Buffer.from(buf);
  return FORBIDDEN_SYMBOLS.filter(({ marker }) => bytes.includes(marker)).map(
    ({ runtime, marker }) => `${runtime} is linked (found "${marker}")`,
  );
}

function readLeb(bytes, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const b = bytes[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
    if ((b & 0x80) === 0) return [result, pos];
  }
}

function readName(bytes, pos) {
  const [len, p] = readLeb(bytes, pos);
  return [new TextDecoder().decode(bytes.subarray(p, p + len)), p + len];
}

/** Parse the import section. Returns [{ module, name, kind, shared?, initial?, maximum? }]. */
export function parseWasmImports(buf) {
  const bytes = new Uint8Array(buf);
  let pos = 8;
  while (pos < bytes.length) {
    const id = bytes[pos++];
    let size;
    [size, pos] = readLeb(bytes, pos);
    if (id !== 2) {
      pos += size;
      continue;
    }
    const out = [];
    let count;
    [count, pos] = readLeb(bytes, pos);
    for (let i = 0; i < count; i++) {
      let module;
      let name;
      [module, pos] = readName(bytes, pos);
      [name, pos] = readName(bytes, pos);
      const kind = bytes[pos++];
      if (kind === 0) {
        [, pos] = readLeb(bytes, pos);
        out.push({ module, name, kind: 'function' });
      } else if (kind === 1) {
        pos++; // reftype
        const flags = bytes[pos++];
        [, pos] = readLeb(bytes, pos);
        if (flags & 1) [, pos] = readLeb(bytes, pos);
        out.push({ module, name, kind: 'table' });
      } else if (kind === 2) {
        const flags = bytes[pos++];
        let initial;
        let maximum;
        [initial, pos] = readLeb(bytes, pos);
        if (flags & 1) [maximum, pos] = readLeb(bytes, pos);
        out.push({ module, name, kind: 'memory', shared: (flags & 2) !== 0, initial, maximum });
      } else if (kind === 3) {
        pos += 2; // valtype + mutability
        out.push({ module, name, kind: 'global' });
      } else if (kind === 4) {
        pos++;
        [, pos] = readLeb(bytes, pos);
        out.push({ module, name, kind: 'tag' });
      } else {
        throw new Error(`unknown import kind ${kind}`);
      }
    }
    return out;
  }
  return [];
}

/** @returns {string[]} problems; empty when the module is a valid ST build. */
export function checkSingleThreadedModule(buf) {
  const problems = [];
  const imports = parseWasmImports(buf);
  const memories = imports.filter((i) => i.kind === 'memory');
  if (memories.length !== 1) {
    problems.push(`expected exactly one imported memory, found ${memories.length}`);
  }
  for (const m of memories) {
    if (m.shared) problems.push(`memory import ${m.module}.${m.name} is shared (pthread build?)`);
  }
  // Minified import names hide the symbol, so also scan the name section / glue-visible names.
  for (const i of imports) {
    if (FORBIDDEN_IMPORT.test(i.name)) problems.push(`forbidden import ${i.module}.${i.name}`);
  }
  problems.push(...checkForbiddenSymbols(buf));
  return problems;
}

function main() {
  const symbolsOnly = process.argv[2] === '--symbols-only';
  const file = process.argv[symbolsOnly ? 3 : 2];
  if (!file) {
    console.error('Usage: node tools/check_hyphon_st_module.mjs [--symbols-only] <hyphon_native[.st].wasm>');
    process.exit(2);
  }
  if (symbolsOnly) {
    const problems = checkForbiddenSymbols(fs.readFileSync(file));
    if (problems.length) {
      console.error(`[native-symbols] FAILED ${file}\n  - ${problems.join('\n  - ')}`);
      process.exit(1);
    }
    console.log(`[native-symbols] OK — no libomp, embind or emscripten_run_script in ${file}`);
    return;
  }
  const problems = checkSingleThreadedModule(fs.readFileSync(file));
  if (problems.length) {
    console.error(`[st-module] FAILED ${file}\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  const mem = parseWasmImports(fs.readFileSync(file)).find((i) => i.kind === 'memory');
  console.log(`[st-module] OK — non-shared imported memory (${mem.initial}..${mem.maximum ?? '∞'} pages)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
