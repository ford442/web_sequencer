#!/usr/bin/env node
/**
 * Assert that public/mix_bus.wasm is the module #1341 promises:
 *   - zero imports (no JS runtime, no imported or shared memory)
 *   - one defined memory that is NOT shared and cannot grow (maximum == initial)
 *   - every export the worker binds to, and the ABI version it expects
 *
 * WebAssembly.Module reflection reports neither `shared` nor `maximum`, so the
 * memory section is parsed directly. Exported for
 * src/__tests__/mixBusModule.test.ts.
 *
 * Usage: node tools/check_mix_bus_module.mjs public/mix_bus.wasm
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Keep in step with build_mix_bus.sh and src/audio/offline/mixBus/mixBusKernel.ts. */
export const MIX_BUS_REQUIRED_EXPORTS = [
  'mix_bus_abi_version',
  'mix_bus_block_frames',
  'mix_bus_in_ptr',
  'mix_bus_acc_ptr',
  'mix_bus_accumulate',
  'mix_bus_peak',
];

export const MIX_BUS_ABI_VERSION = 1;

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

/** Parse the memory section (id 5). Returns [{ shared, initial, maximum }] in pages. */
export function parseWasmMemories(buf) {
  const bytes = new Uint8Array(buf);
  let pos = 8;
  while (pos < bytes.length) {
    const id = bytes[pos++];
    let size;
    [size, pos] = readLeb(bytes, pos);
    if (id !== 5) {
      pos += size;
      continue;
    }
    const out = [];
    let count;
    [count, pos] = readLeb(bytes, pos);
    for (let i = 0; i < count; i++) {
      const flags = bytes[pos++];
      let initial;
      let maximum = null;
      [initial, pos] = readLeb(bytes, pos);
      if (flags & 0x01) [maximum, pos] = readLeb(bytes, pos);
      out.push({ shared: Boolean(flags & 0x02), initial, maximum });
    }
    return out;
  }
  return [];
}

/** @returns {string[]} problems; empty when the module is acceptable. */
export function checkMixBusModule(buf) {
  const problems = [];
  const module = new WebAssembly.Module(buf);

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
    if (mem.shared) problems.push('memory is shared (would need a SharedArrayBuffer)');
    if (mem.maximum === null) problems.push('memory has no maximum (growth is unbounded)');
    else if (mem.maximum !== mem.initial) {
      problems.push(`memory can grow: initial ${mem.initial} pages, maximum ${mem.maximum}`);
    }
  }

  const exportNames = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
  if (!exportNames.has('memory')) problems.push('memory is not exported');
  const missing = MIX_BUS_REQUIRED_EXPORTS.filter((name) => !exportNames.has(name));
  if (missing.length) problems.push(`missing exports: ${missing.join(', ')}`);

  if (!problems.length) {
    const { exports } = new WebAssembly.Instance(module, {});
    const abi = exports.mix_bus_abi_version();
    if (abi !== MIX_BUS_ABI_VERSION) {
      problems.push(`ABI version ${abi}, expected ${MIX_BUS_ABI_VERSION}`);
    }
    const blockBytes = exports.mix_bus_block_frames() * 4;
    for (const ptrName of ['mix_bus_in_ptr', 'mix_bus_acc_ptr']) {
      const ptr = exports[ptrName]();
      if (ptr + blockBytes > exports.memory.buffer.byteLength) {
        problems.push(`${ptrName} block runs past the end of memory`);
      }
    }
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/check_mix_bus_module.mjs <mix_bus.wasm>');
    process.exit(2);
  }
  const problems = checkMixBusModule(fs.readFileSync(file));
  if (problems.length) {
    console.error(`[check_mix_bus_module] ${file} is not a valid mix bus module:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[check_mix_bus_module] ${file}: OK (no imports, fixed unshared memory, ABI ${MIX_BUS_ABI_VERSION})`);
}
