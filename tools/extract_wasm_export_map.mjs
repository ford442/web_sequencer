#!/usr/bin/env node
/**
 * Parse hyphon_native.js glue and emit a JSON map:
 *   { "open303_create": "qa", "prophecy_process": "Fa", ... }
 *
 * AudioWorklets instantiate hyphon_native.wasm directly and need this map
 * because wasm-opt minifies export names in release builds.
 */
import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
const output = process.argv[3];

if (!input || !output) {
  console.error('Usage: extract_wasm_export_map.mjs <hyphon_native.js> <out.json>');
  process.exit(1);
}

const js = fs.readFileSync(input, 'utf8');
const map = {};

// Emscripten glue formats (release builds minify export names):
//   Module["_open303_create"]=wasmExports["da"];
//   _open303_destroy=Module["_open303_destroy"]=wasmExports["ea"];
const patterns = [
  /Module\["(_[^"]+)"\]=wasmExports\["([^"]+)"\]/g,
  /(_[a-zA-Z0-9_]+)=Module\["\1"\]=wasmExports\["([^"]+)"\]/g,
];

for (const re of patterns) {
  let match;
  while ((match = re.exec(js)) !== null) {
    map[match[1].slice(1)] = match[2];
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(map, null, 2) + '\n');
console.log(`Wrote ${Object.keys(map).length} export mappings to ${output}`);
