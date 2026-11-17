#!/usr/bin/env node
/**
 * EXPORTED_FUNCTIONS for hyphon_native, derived from
 * emscripten/wasm_export_manifest.json — the one list of the module's C API
 * (#1344: build.sh used to keep its own copy by hand).
 *
 *   required + optional       exported (both threading profiles)
 *   debug                     exported by the debug build profile only
 *                             (--profile debug): the stack high-water probe
 *   runtime                   never passed to EXPORTED_FUNCTIONS — Emscripten adds
 *                             these itself
 *
 * Usage: node tools/hyphon_native_exports.mjs [--manifest <file>] [--profile release|debug]
 * Prints a JSON array of underscore-prefixed names, e.g. ["_malloc","_free",…].
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{ required?: string[], optional?: string[], debug?: string[] }} manifest
 * @param {'release' | 'debug'} [profile]
 */
export function exportedFunctions(manifest, profile = 'release') {
  const names = [
    ...(manifest.required ?? []),
    ...(manifest.optional ?? []),
    ...(profile === 'debug' ? manifest.debug ?? [] : []),
  ];
  return [...new Set(names)].map((name) => `_${name}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let manifestPath = path.join(REPO_ROOT, 'emscripten/wasm_export_manifest.json');
  let profile = 'release';
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--manifest') manifestPath = process.argv[++i];
    else if (arg === '--profile') {
      profile = process.argv[++i];
      if (profile !== 'release' && profile !== 'debug') {
        console.error(`Unknown profile: ${profile}`);
        process.exit(1);
      }
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  process.stdout.write(JSON.stringify(exportedFunctions(manifest, profile)));
}
