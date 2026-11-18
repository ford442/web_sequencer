#!/usr/bin/env node
/**
 * EXPORTED_FUNCTIONS for an em++ module, derived from
 * emscripten/wasm_export_manifest.json — the one list of every module's C API
 * (#1344 for hyphon_native; #1596 follow-up P3 for rubberband and mix_bus, whose
 * build scripts used to keep their own arrays by hand).
 *
 *   --module hyphonNative (default)  the manifest's top-level buckets:
 *       required + optional          exported (both threading profiles)
 *       debug                        exported by the debug build profile only
 *                                    (--profile debug): the stack high-water probe
 *       runtime                      never passed — Emscripten adds these itself
 *   --module rubberband | mixBus     that section's `required` (+ `optional`)
 *
 * Usage:
 *   node tools/hyphon_native_exports.mjs [--module <name>] [--manifest <file>] [--profile release|debug]
 * Prints a JSON array of underscore-prefixed names, e.g. ["_malloc","_free",…].
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The em++ modules the manifest declares. */
export const MANIFEST_MODULES = ['hyphonNative', 'rubberband', 'mixBus'];

/**
 * One module's buckets. hyphon_native's are the manifest's top level (they predate
 * the per-module sections and are read by many tools); the others are sections.
 * @returns {{ required: string[], optional: string[], runtime: string[], debug: string[] }}
 */
export function moduleSurface(manifest, module = 'hyphonNative') {
  if (!MANIFEST_MODULES.includes(module)) throw new Error(`unknown module "${module}"`);
  const src = module === 'hyphonNative' ? manifest : manifest[module];
  if (!src) throw new Error(`wasm_export_manifest.json has no "${module}" section`);
  return {
    required: src.required ?? [],
    optional: src.optional ?? [],
    runtime: src.runtime ?? [],
    debug: src.debug ?? [],
  };
}

/**
 * @param {object} manifest
 * @param {'release' | 'debug'} [profile]
 * @param {string} [module]
 */
export function exportedFunctions(manifest, profile = 'release', module = 'hyphonNative') {
  const s = moduleSurface(manifest, module);
  const names = [...s.required, ...s.optional, ...(profile === 'debug' ? s.debug : [])];
  return [...new Set(names)].map((name) => `_${name}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let manifestPath = path.join(REPO_ROOT, 'emscripten/wasm_export_manifest.json');
  let profile = 'release';
  let module = 'hyphonNative';
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--manifest') manifestPath = process.argv[++i];
    else if (arg === '--module') module = process.argv[++i];
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
  process.stdout.write(JSON.stringify(exportedFunctions(manifest, profile, module)));
}
