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

/**
 * Parse Emscripten glue and return { bareName: minifiedName }.
 * Exported so tools/check_wasm_export_map.mjs can re-derive the map from the
 * glue and diff it against the committed JSON.
 */
export function parseExportMap(js) {
  const map = {};

  // Emscripten glue formats (release builds minify export names):
  //   Module["_open303_create"]=wasmExports["da"];
  //   _open303_destroy=Module["_open303_destroy"]=wasmExports["ea"];
  // Sometimes Emscripten output has spaces around the '=' operator:
  //   _open303_create = Module["_open303_create"] = wasmExports["open303_create"];
  const patterns = [
    /Module\["(_[^"]+)"\]\s*=\s*wasmExports\["([^"]+)"\]/g,
    /(_[a-zA-Z0-9_]+)\s*=\s*Module\["\1"\]\s*=\s*wasmExports\["([^"]+)"\]/g,
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(js)) !== null) {
      map[match[1].slice(1)] = match[2];
    }
  }

  return map;
}

function main() {
  const input = process.argv[2];
  const output = process.argv[3];

  if (!input || !output) {
    console.error('Usage: extract_wasm_export_map.mjs <hyphon_native.js> <out.json>');
    process.exit(1);
  }

  const map = parseExportMap(fs.readFileSync(input, 'utf8'));

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(map, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(map).length} export mappings to ${output}`);
}

// Only run when invoked directly, not when imported by the checker.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
