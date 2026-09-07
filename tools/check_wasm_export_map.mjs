#!/usr/bin/env node
/**
 * Validate public/hyphon_wasm_export_map.json against the declared export
 * surface in emscripten/wasm_export_manifest.json.
 *
 * Checks:
 *   1. Every `required` export is present in the map (worklets would break otherwise).
 *   2. No export is present that is in neither `required` nor `optional` (export bloat).
 *   3. Minified names are unique — two logical exports mapping to the same symbol
 *      means the map is stale relative to the .wasm.
 *   4. With `--glue <hyphon_native.js>`: the committed map matches what the glue
 *      actually declares, so a rebuild that forgot to regenerate the map fails.
 *   5. With `--wasm <hyphon_native.wasm>`: every minified name in the map is a real
 *      export of the binary. The glue check alone cannot see this — an out-of-band
 *      `wasm-opt` run (tools/optimize.sh) rewrites the .wasm without touching the
 *      glue, so a pass that renamed exports would leave a map that still agrees
 *      with the glue and no longer resolves in the worklet.
 *
 * Usage:
 *   node tools/check_wasm_export_map.mjs [--map <file>] [--glue <hyphon_native.js>] [--wasm <file>]
 *
 * Exit codes: 0 ok / 1 validation failure / 0 with a warning when the map is
 * absent (WASM artifacts are gitignored, so a source-only CI job skips cleanly).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExportMap } from './extract_wasm_export_map.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    map: path.join(REPO_ROOT, 'public/hyphon_wasm_export_map.json'),
    manifest: path.join(REPO_ROOT, 'emscripten/wasm_export_manifest.json'),
    glue: null,
    wasm: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === '--map') { args.map = next; i++; }
    else if (argv[i] === '--manifest') { args.manifest = next; i++; }
    else if (argv[i] === '--glue') { args.glue = next; i++; }
    else if (argv[i] === '--wasm') { args.wasm = next; i++; }
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!fs.existsSync(args.map)) {
  console.warn(
    `[export-map] ${path.relative(REPO_ROOT, args.map)} not found — ` +
    'skipping (build WASM artifacts with `pnpm run build:emcc` to check them).',
  );
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
const map = JSON.parse(fs.readFileSync(args.map, 'utf8'));

const required = new Set(manifest.required ?? []);
const optional = new Set(manifest.optional ?? []);
const present = Object.keys(map);
const errors = [];

const missing = [...required].filter((name) => !(name in map));
if (missing.length) {
  errors.push(
    `Missing required exports (${missing.length}): ${missing.join(', ')}\n` +
    '  The build dropped an export the worklets call. Check EXPORTED_FUNCTIONS in ' +
    'emscripten/build.sh and the EMSCRIPTEN_KEEPALIVE wrappers.',
  );
}

const unexpected = present.filter((name) => !required.has(name) && !optional.has(name));
if (unexpected.length) {
  errors.push(
    `Unexpected exports (${unexpected.length}): ${unexpected.join(', ')}\n` +
    '  Either the app genuinely needs them — add to `required` in ' +
    'emscripten/wasm_export_manifest.json — or they are export bloat to prune.',
  );
}

const byMinified = new Map();
for (const [bare, minified] of Object.entries(map)) {
  if (byMinified.has(minified)) {
    errors.push(
      `Duplicate minified symbol "${minified}" for ${byMinified.get(minified)} and ${bare} — ` +
      'the export map is stale; regenerate it from the current glue.',
    );
  }
  byMinified.set(minified, bare);
}

if (args.glue) {
  if (!fs.existsSync(args.glue)) {
    errors.push(`--glue file not found: ${args.glue}`);
  } else {
    const fromGlue = parseExportMap(fs.readFileSync(args.glue, 'utf8'));
    const drift = [];
    for (const [bare, minified] of Object.entries(fromGlue)) {
      if (map[bare] !== minified) drift.push(`${bare}: glue=${minified} map=${map[bare] ?? '(absent)'}`);
    }
    for (const bare of Object.keys(map)) {
      if (!(bare in fromGlue)) drift.push(`${bare}: absent from glue`);
    }
    if (drift.length) {
      errors.push(
        `Export map is out of sync with ${path.relative(REPO_ROOT, args.glue)} (${drift.length}):\n  ` +
        drift.join('\n  ') +
        '\n  Regenerate: node tools/extract_wasm_export_map.mjs <glue> public/hyphon_wasm_export_map.json',
      );
    }
  }
}

if (args.wasm) {
  if (!fs.existsSync(args.wasm)) {
    errors.push(`--wasm file not found: ${args.wasm}`);
  } else {
    let binaryExports = null;
    try {
      const mod = new WebAssembly.Module(fs.readFileSync(args.wasm));
      binaryExports = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
    } catch (err) {
      errors.push(
        `Could not compile ${path.relative(REPO_ROOT, args.wasm)} to read its exports: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (binaryExports) {
      const absent = Object.entries(map)
        .filter(([, minified]) => !binaryExports.has(minified))
        .map(([bare, minified]) => `${bare} -> "${minified}"`);
      if (absent.length) {
        errors.push(
          `Export map names absent from ${path.relative(REPO_ROOT, args.wasm)} (${absent.length}):\n  ` +
          absent.join('\n  ') +
          '\n  The binary was rewritten after the map was generated (usually an ' +
          'out-of-band wasm-opt pass that renamed exports). Re-link, or re-run ' +
          'tools/optimize.sh, which regenerates and re-checks the map.',
        );
      }
    }
  }
}

if (errors.length) {
  console.error('[export-map] FAILED\n');
  for (const e of errors) console.error(`- ${e}\n`);
  process.exit(1);
}

const optionalPresent = present.filter((name) => optional.has(name));
console.log(
  `[export-map] OK — ${present.length} exports ` +
  `(${required.size} required, ${optionalPresent.length} optional present).`,
);
