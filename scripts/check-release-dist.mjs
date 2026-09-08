#!/usr/bin/env node
/**
 * Release-bundle hygiene:
 *   - fail if Vite source maps shipped without opt-in
 *   - fail if any remote script/CDN origin survived into the built index.html
 *   - warn if the Pyodide runtime was not vendored
 *
 *   node scripts/check-release-dist.mjs
 *   HYPHON_SOURCEMAP=1 node scripts/check-release-dist.mjs   # allow .map
 *   HYPHON_DIST_DIR=/tmp/bundle node scripts/check-release-dist.mjs   # check a fixture
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExportMap } from '../tools/extract_wasm_export_map.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// HYPHON_DIST_DIR lets the test suite point the checks at a fixture bundle.
const distDir = process.env.HYPHON_DIST_DIR
  ? path.resolve(process.env.HYPHON_DIST_DIR)
  : path.join(repoRoot, 'dist');
const allowMaps = process.env.HYPHON_SOURCEMAP === '1' || process.env.HYPHON_SOURCEMAP === 'hidden';

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

if (!fs.existsSync(distDir)) {
  console.error('[check-release-dist] dist/ is missing — run `pnpm run build:web` first.');
  process.exit(1);
}

const maps = walk(distDir).filter((p) => p.endsWith('.map'));
if (!allowMaps && maps.length) {
  console.error('[check-release-dist] source maps present but HYPHON_SOURCEMAP is unset:');
  for (const p of maps.slice(0, 20)) {
    console.error(`  ${path.relative(repoRoot, p)}`);
  }
  if (maps.length > 20) console.error(`  … and ${maps.length - 20} more`);
  process.exit(1);
}

if (!fs.existsSync(path.join(distDir, 'native-artifacts.json'))) {
  console.error('[check-release-dist] dist/native-artifacts.json is missing.');
  process.exit(1);
}

// The WAM2 Phase B CSP (docs/adr/0001-wam2-host.md) is same-origin scripts only
// and no `unsafe-eval`. Both used to be violated from index.html — a jsDelivr
// Pyodide <script> and a `new Function` importer. Catch a regression in the built
// output, where it actually matters, not just in the source file.
const indexHtmlPath = path.join(distDir, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  const scriptSrcs = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  const remoteScripts = scriptSrcs.filter((src) => /^(https?:)?\/\//i.test(src));
  if (remoteScripts.length) {
    console.error('[check-release-dist] dist/index.html loads scripts from a remote origin:');
    for (const src of remoteScripts) console.error(`  ${src}`);
    console.error('  The CSP allows same-origin scripts only — vendor the asset instead.');
    process.exit(1);
  }
  if (/new\s+Function\s*\(/.test(html)) {
    console.error(
      '[check-release-dist] dist/index.html contains `new Function(` — that needs ' +
      "`unsafe-eval`, which the CSP forbids. Use `import(/* @vite-ignore */ url)`.",
    );
    process.exit(1);
  }
}

if (!fs.existsSync(path.join(distDir, 'pyodide', 'pyodide.js'))) {
  console.warn(
    '[check-release-dist] WARNING: dist/pyodide/ is empty — the Pyodide oscillators ' +
    'will fail at runtime and nothing falls back to a CDN by design. ' +
    'Run `pnpm run vendor:pyodide` before `pnpm run build:web`.',
  );
}

// Worklets that must ship in every production bundle (imported from reachable code paths).
const REQUIRED_WORKLET_PROCESSORS = [
  'clock-processor',
  'open303-processor',
  'prophecy-processor',
  'sustain-processor',
  'RubberBandProcessor',
  'master-loudness-processor',
];

const distJsFiles = walk(distDir).filter((p) => p.endsWith('.js') && !p.endsWith('.map'));
const distJsBundle = distJsFiles.map((p) => fs.readFileSync(p, 'utf8')).join('\n');

const missingProcessors = REQUIRED_WORKLET_PROCESSORS.filter(
  (name) => !distJsBundle.includes(name),
);

if (missingProcessors.length) {
  console.error(
    '[check-release-dist] required worklet processor name(s) missing from dist/ JS bundles:',
  );
  for (const name of missingProcessors) console.error(`  ${name}`);
  console.error(
    '  Ensure each worklet is imported via ?worker&url from a reachable code path.',
  );
  process.exit(1);
}

if (/addModule\s*\([^)]*\.tsx?/.test(distJsBundle)) {
  console.error(
    '[check-release-dist] dist/ JS still references raw .ts/.tsx paths in addModule() — ' +
    'use ?worker&url imports instead.',
  );
  process.exit(1);
}

// hyphon_wasm_export_map.json must ship in dist/ with a non-empty, non-stale contract.
const mapPath = path.join(distDir, 'hyphon_wasm_export_map.json');
const gluePath = path.join(distDir, 'hyphon_native.js');
const wasmPath = path.join(distDir, 'hyphon_native.wasm');

if (!fs.existsSync(mapPath)) {
  console.error('[check-release-dist] dist/hyphon_wasm_export_map.json is missing.');
  process.exit(1);
}

const exportMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const mapKeys = Object.keys(exportMap);
if (!mapKeys.length) {
  console.error('[check-release-dist] dist/hyphon_wasm_export_map.json has zero entries.');
  process.exit(1);
}

const manifestPath = path.join(repoRoot, 'emscripten', 'wasm_export_manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const requiredExports = manifest.required ?? [];
const missingRequired = requiredExports.filter((name) => !(name in exportMap));
if (missingRequired.length) {
  console.error(
    `[check-release-dist] export map missing ${missingRequired.length} required export(s): ` +
    missingRequired.join(', '),
  );
  process.exit(1);
}

if (fs.existsSync(gluePath)) {
  const fromGlue = parseExportMap(fs.readFileSync(gluePath, 'utf8'));
  const staleIdentity = requiredExports.filter(
    (name) => exportMap[name] === name && fromGlue[name] && fromGlue[name] !== name,
  );
  if (staleIdentity.length) {
    console.error(
      '[check-release-dist] dist/hyphon_wasm_export_map.json is a stale identity map; ' +
      `glue has minified names for: ${staleIdentity.slice(0, 5).join(', ')}` +
      (staleIdentity.length > 5 ? ` … (+${staleIdentity.length - 5} more)` : ''),
    );
    process.exit(1);
  }
}

if (!fs.existsSync(gluePath)) {
  console.error('[check-release-dist] dist/hyphon_native.js is missing (glue fallback for export map).');
  process.exit(1);
}

if (!fs.existsSync(wasmPath)) {
  console.error('[check-release-dist] dist/hyphon_native.wasm is missing.');
  process.exit(1);
}

// The map/glue checks above only prove the two *text* artifacts agree with each
// other. They say nothing about the binary that actually ships, and a dist whose
// .wasm came from a different link than its glue passes every one of them — which
// is how a build reached production where the Open303 and Prophecy worklets
// instantiated hyphon_native.wasm successfully and then found neither open303_*
// nor prophecy_* on it, silently degrading both to their JS fallbacks.
//
// So resolve every required export the way the worklets do, against the real
// export table: through the map, else the glue map, else the bare/underscored
// name (src/audio-worklets/hyphonNativeImports.ts#normalizeWasmExports).
let binaryExports;
try {
  const mod = new WebAssembly.Module(fs.readFileSync(wasmPath));
  binaryExports = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
} catch (err) {
  console.error(
    '[check-release-dist] dist/hyphon_native.wasm does not compile: ' +
    `${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

const glueMap = fs.existsSync(gluePath) ? parseExportMap(fs.readFileSync(gluePath, 'utf8')) : {};

function resolvesInBinary(bare) {
  return [exportMap[bare], glueMap[bare], bare, `_${bare}`].some(
    (name) => name && binaryExports.has(name),
  );
}

const unresolvable = requiredExports.filter((name) => !resolvesInBinary(name));
if (unresolvable.length) {
  const names = [...binaryExports].sort();
  const preview = names.slice(0, 48).join(', ');
  console.error(
    `[check-release-dist] dist/hyphon_native.wasm is missing ${unresolvable.length} required ` +
    `export(s): ${unresolvable.join(', ')}`,
  );
  console.error(
    `  Actual exports (${names.length}): ${preview}` +
    (names.length > 48 ? ` … (+${names.length - 48} more)` : ''),
  );
  console.error(
    '  The shipped binary is not the one dist/hyphon_native.js was linked with. ' +
    'Rebuild both together (`pnpm run build:release`) — do not copy a .wasm in by hand.',
  );
  process.exit(1);
}

// A mapped name that is not a real export is dead weight at best and a stale map
// at worst; report it even when the bare-name fallback above rescued the API.
const danglingMappings = Object.entries(exportMap)
  .filter(([, minified]) => !binaryExports.has(minified))
  .map(([bare, minified]) => `${bare} -> "${minified}"`);
if (danglingMappings.length) {
  console.error(
    `[check-release-dist] dist/hyphon_wasm_export_map.json names ${danglingMappings.length} ` +
    `symbol(s) absent from dist/hyphon_native.wasm:\n  ${danglingMappings.slice(0, 10).join('\n  ')}` +
    (danglingMappings.length > 10 ? `\n  … (+${danglingMappings.length - 10} more)` : ''),
  );
  console.error('  Regenerate: node tools/extract_wasm_export_map.mjs dist/hyphon_native.js <map>');
  process.exit(1);
}

const rawTsInDist = distJsFiles.filter((p) => /\.tsx?$/.test(p));
if (rawTsInDist.length) {
  console.error('[check-release-dist] dist/ contains raw TypeScript assets:');
  for (const p of rawTsInDist) console.error(`  ${path.relative(repoRoot, p)}`);
  process.exit(1);
}

const wasmSummary =
  `${mapKeys.length} WASM export(s), ${requiredExports.length} resolved in the binary`;
console.log(
  allowMaps
    ? `[check-release-dist] OK — ${maps.length} source map(s) allowed, ${REQUIRED_WORKLET_PROCESSORS.length} worklet(s), ${wasmSummary}.`
    : `[check-release-dist] OK — no source maps, ${REQUIRED_WORKLET_PROCESSORS.length} worklet(s), ${wasmSummary}.`,
);
