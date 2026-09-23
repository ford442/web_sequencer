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
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExportMap } from '../tools/extract_wasm_export_map.mjs';
import { checkSingleThreadedModule } from '../tools/check_hyphon_st_module.mjs';

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

// PWA shell: public/sw.js and public/manifest.webmanifest must ship, and the
// build-time `hyphon-precache-manifest` Vite plugin (vite.config.ts) must
// have emitted precache-manifest.json listing files that actually exist —
// this is the gate that would have caught #1176/#1177-style dead artifacts
// (a service worker whose own precache shell 404s) before release.
{
  const swPath = path.join(distDir, 'sw.js');
  const manifestWebPath = path.join(distDir, 'manifest.webmanifest');
  const precacheManifestPath = path.join(distDir, 'precache-manifest.json');

  if (!fs.existsSync(swPath)) {
    console.error('[check-release-dist] dist/sw.js is missing.');
    process.exit(1);
  }
  if (/__HYPHON_BUILD_ID__/.test(fs.readFileSync(swPath, 'utf8'))) {
    console.error(
      '[check-release-dist] dist/sw.js still contains the __HYPHON_BUILD_ID__ placeholder — ' +
      'the hyphon-precache-manifest Vite plugin did not stamp it, so the browser will never ' +
      'detect a new release.',
    );
    process.exit(1);
  }
  if (!fs.existsSync(manifestWebPath)) {
    console.error('[check-release-dist] dist/manifest.webmanifest is missing.');
    process.exit(1);
  }
  if (!fs.existsSync(precacheManifestPath)) {
    console.error('[check-release-dist] dist/precache-manifest.json is missing.');
    process.exit(1);
  }

  const precacheManifest = JSON.parse(fs.readFileSync(precacheManifestPath, 'utf8'));
  const shell = precacheManifest.shell;
  if (!Array.isArray(shell) || shell.length === 0) {
    console.error('[check-release-dist] dist/precache-manifest.json has an empty or missing `shell` array.');
    process.exit(1);
  }

  const missingShellEntries = shell.filter((url) => {
    if (url === './') return false; // resolves to index.html, checked separately
    const rel = url.replace(/^\.\//, '');
    return !fs.existsSync(path.join(distDir, rel));
  });
  if (missingShellEntries.length) {
    console.error('[check-release-dist] precache-manifest.json lists shell file(s) missing from dist/:');
    for (const url of missingShellEntries) console.error(`  ${url}`);
    process.exit(1);
  }
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
  'drumkit-processor',
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


// ---------------------------------------------------------------------------
// AudioWorklet chunks must be self-contained.
//
// A worklet global scope has no module loader: an `import` or `export` that
// survives into an emitted worklet chunk throws at addModule() time, and only
// in production — dev serves the graph unbundled, so nothing fails locally.
// The check above proves each processor NAME is present somewhere in dist/;
// this proves the chunk that registers it can actually be loaded.
//
// Matching requires a QUOTED SPECIFIER rather than stripping literals first.
// Stripping is not safe on minified JS: a regex literal such as
// `e.match(/([^\/]+|\/)\/*$/)` contains `/*`, which a scanner reads as a
// comment opener and then swallows most of the file. Requiring `from"…"` (or a
// bare `import"…"`) instead is precise and stateless — and still ignores the
// Emscripten glue's template strings like `import ${e.module}.${e.name}`,
// which have no from-clause.
{
  // The chunk that calls registerProcessor() is the one the worklet loads.
  const workletChunks = distJsFiles.filter((p) =>
    /(^|[^\w.$])registerProcessor\s*\(/.test(fs.readFileSync(p, 'utf8')),
  );

  if (workletChunks.length < REQUIRED_WORKLET_PROCESSORS.length) {
    console.error(
      `[check-release-dist] expected at least ${REQUIRED_WORKLET_PROCESSORS.length} worklet chunk(s) ` +
      `calling registerProcessor(), found ${workletChunks.length}. A worklet was probably inlined ` +
      'into a shared chunk, which makes it unloadable in a worklet scope.',
    );
    process.exit(1);
  }

  // Every alternative demands a quoted specifier, so nothing inside a template
  // string can satisfy it. Minified output has no space before `from`.
  const Q = String.raw`["']`;
  const STATIC_IMPORT = new RegExp(
    [
      String.raw`(?:^|[;}\s])import\s*\{[^}]*\}\s*from\s*` + Q,       // import{a}from"…"
      String.raw`(?:^|[;}\s])import\s*\*\s*as\s+[\w$]+\s*from\s*` + Q, // import*as n from"…"
      String.raw`(?:^|[;}\s])import\s+[\w$]+\s*(?:,\s*\{[^}]*\}\s*)?from\s*` + Q, // import d[,{a}]from"…"
      String.raw`(?:^|[;}\s])import\s*` + Q,                              // bare import"…"
    ].join('|'),
  );
  const STATIC_EXPORT = new RegExp(
    [
      String.raw`(?:^|[;}\s])export\s*[{*]`,
      String.raw`(?:^|[;}\s])export\s+(?:default|const|let|var|function|class|async)\b`,
    ].join('|'),
  );

  const leaky = [];
  for (const p of workletChunks) {
    const src = fs.readFileSync(p, 'utf8');
    const offences = [];
    if (STATIC_IMPORT.test(src)) offences.push('import');
    if (STATIC_EXPORT.test(src)) offences.push('export');
    if (offences.length) {
      leaky.push(`${path.relative(distDir, p)} (${offences.join(', ')})`);
    }
  }

  if (leaky.length) {
    console.error(
      '[check-release-dist] AudioWorklet chunk(s) contain runtime import/export — ' +
      'a worklet scope has no module loader, so addModule() will throw in production:',
    );
    for (const msg of leaky) console.error(`  ${msg}`);
    console.error(
      '  Keep `worker: { format: "es" }` emitting one self-contained chunk per worklet; ' +
      'do not let manualChunks split a worklet across chunks.',
    );
    process.exit(1);
  }

  console.log(
    `[check-release-dist] ${workletChunks.length} worklet chunk(s) are self-contained.`,
  );
}

// ---------------------------------------------------------------------------
// Every emitted asset URL must resolve under the deploy base.
//
// `base` is './' (vitest.shared.ts), so the bundler's own output is
// base-relative. What that does NOT cover is a URL assembled at runtime —
// addModule('/foo.js'), wasmPaths = '/onnx-runtime/' — which resolves against
// the ORIGIN, not the base, and so 404s under a subdirectory deploy while
// working perfectly on a root-served dev server. That is the #1176/#1177
// failure mode: silent in dev, fatal in prod.
{
  const baseFailures = [];

  // 1. Bundler-emitted sibling references must point at files that exist.
  for (const p of distJsFiles) {
    const src = fs.readFileSync(p, 'utf8');
    // Emscripten glue carries a default `new URL('<mod>.wasm', import.meta.url)`
    // that the caller overrides by passing `wasmBinary` (the already-fetched
    // bytes) and/or a `locateFile` hook — see src/audio-worklets/*-processor.ts,
    // which fetch rubberband.wasm from the deploy base themselves. In such a
    // chunk the default path is dead, so its target is not a shipped-asset claim.
    const overridesWasmPath = /\blocateFile\b|\bwasmBinary\b/.test(src);
    for (const m of src.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) {
      const ref = m[1];
      if (/^(?:[a-z]+:)?\/\//i.test(ref)) {
        baseFailures.push(`${path.relative(distDir, p)} builds an absolute remote URL: ${ref}`);
        continue;
      }
      if (ref.startsWith('/')) {
        baseFailures.push(
          `${path.relative(distDir, p)} builds an origin-rooted URL: ${ref} ` +
          '(resolves against the origin, not the deploy base)',
        );
        continue;
      }
      const bare = ref.split('?')[0].split('#')[0];
      if (bare.endsWith('.wasm') && overridesWasmPath) continue;
      const target = path.join(path.dirname(p), bare);
      if (!fs.existsSync(target)) {
        baseFailures.push(`${path.relative(distDir, p)} references a missing sibling: ${ref}`);
      }
    }

    // 2. Runtime-assembled worklet/wasm URLs must not be origin-rooted.
    for (const m of src.matchAll(/addModule\(\s*["'](\/[^"']*)["']/g)) {
      baseFailures.push(
        `${path.relative(distDir, p)} calls addModule("${m[1]}") — an origin-rooted path ` +
        'that ignores the deploy base. Use an `?worker&url` import or import.meta.env.BASE_URL.',
      );
    }
    for (const m of src.matchAll(/wasmPaths\s*[:=]\s*["'](\/[^"']*)["']/g)) {
      baseFailures.push(
        `${path.relative(distDir, p)} sets wasmPaths to "${m[1]}" — an origin-rooted path ` +
        'that ignores the deploy base. Derive it from import.meta.env.BASE_URL.',
      );
    }
  }

  // 3. index.html asset references must be base-relative and present.
  if (fs.existsSync(indexHtmlPath)) {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const refs = [
      ...[...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]),
      ...[...html.matchAll(/<link[^>]*\shref=["']([^"']+)["']/gi)].map((m) => m[1]),
    ];
    for (const ref of refs) {
      if (/^(?:[a-z]+:)?\/\//i.test(ref) || ref.startsWith('data:')) continue;
      if (ref.startsWith('/')) {
        baseFailures.push(
          `index.html references "${ref}" from the origin root — it will 404 under a ` +
          'subdirectory deploy. Vite `base` is "./", so emitted refs should be relative.',
        );
        continue;
      }
      const target = path.join(distDir, ref.replace(/^\.\//, '').split('?')[0].split('#')[0]);
      if (!fs.existsSync(target)) {
        baseFailures.push(`index.html references a missing asset: ${ref}`);
      }
    }
  }

  if (baseFailures.length) {
    console.error('[check-release-dist] emitted URL(s) do not resolve under the deploy base:');
    for (const msg of baseFailures) console.error(`  ${msg}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// ONNX Runtime must load its wasm binary from our own build, not a CDN.
//
// `ort.env.wasm.wasmPaths` used to point at jsDelivr, pinned to a hardcoded
// version while package.json declared a caret range — so a patch bump would
// have served newer JS against older binaries with no error anywhere. Vite
// already emits ORT's binary as a content-hashed build asset and rewrites the
// runtime's own `new URL(..., import.meta.url)` reference to it, so the fix was
// to stop assigning wasmPaths at all (see src/services/ortRuntime.ts). This
// asserts that outcome rather than trusting it.
{
  const ortFailures = [];

  const ortWasm = walk(distDir).filter((p) => /ort-wasm[\w.-]*\.wasm$/.test(path.basename(p)));
  const ortChunks = distJsFiles.filter((p) => /ort-wasm[\w.-]*\.wasm/.test(fs.readFileSync(p, 'utf8')));

  if (ortChunks.length && !ortWasm.length) {
    ortFailures.push(
      'the bundle references an ORT wasm binary but none was emitted into dist/ — ' +
      'ONNX Runtime would 404 on first TTS use',
    );
  }

  // Every ORT binary the bundle names must actually exist next to the chunk
  // that names it. (The generic deploy-base check above skips `.wasm` targets
  // in chunks that override the path via locateFile/wasmBinary; ORT does not,
  // so it is checked explicitly here.)
  for (const p of ortChunks) {
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/new URL\(\s*["'](ort-wasm[\w.-]*\.wasm)["']\s*,\s*import\.meta\.url\s*\)/g)) {
      if (!fs.existsSync(path.join(path.dirname(p), m[1]))) {
        ortFailures.push(`${path.relative(distDir, p)} references a missing ORT binary: ${m[1]}`);
      }
    }
  }

  // No ORT consumer may reach a CDN: that puts a headline feature on a third
  // party and outside our COOP/COEP, which ORT's threading depends on.
  for (const p of distJsFiles) {
    if (/cdn\.jsdelivr\.net[^"']*onnxruntime|unpkg\.com[^"']*onnxruntime/.test(fs.readFileSync(p, 'utf8'))) {
      ortFailures.push(
        `${path.relative(distDir, p)} points ONNX Runtime at a CDN — the wasm binary must come ` +
        'from this build (do not assign ort.env.wasm.wasmPaths; see src/services/ortRuntime.ts)',
      );
    }
  }

  if (ortFailures.length) {
    console.error('[check-release-dist] ONNX Runtime wasm hosting:');
    for (const msg of ortFailures) console.error(`  ${msg}`);
    process.exit(1);
  }

  if (ortWasm.length) {
    const total = ortWasm.reduce((sum, p) => sum + fs.statSync(p).size, 0);
    console.log(
      `[check-release-dist] ONNX Runtime is self-hosted — ${ortWasm.length} binary/binaries, ` +
      `${(total / 1e6).toFixed(1)} MB, no CDN.`,
    );
  }
}

// Both hyphon_native link profiles ship (docs/wasm/BUILD_NOTES.md#threading-profiles):
// the pthread build for crossOriginIsolated pages, the single-threaded build for
// WebKit / no COOP+COEP / forceSingleThreaded. Each must carry the full export
// contract against its own glue and binary.
const HYPHON_PROFILES = [
  { map: 'hyphon_wasm_export_map.json', glue: 'hyphon_native.js', wasm: 'hyphon_native.wasm', singleThreaded: false },
  { map: 'hyphon_wasm_export_map.st.json', glue: 'hyphon_native.st.js', wasm: 'hyphon_native.st.wasm', singleThreaded: true },
];

function checkHyphonProfile(profile) {
  // hyphon_wasm_export_map.json must ship in dist/ with a non-empty, non-stale contract.
  const mapPath = path.join(distDir, profile.map);
  const gluePath = path.join(distDir, profile.glue);
  const wasmPath = path.join(distDir, profile.wasm);

  if (!fs.existsSync(mapPath)) {
    console.error(`[check-release-dist] dist/${profile.map} is missing.`);
    process.exit(1);
  }

  const exportMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const mapKeys = Object.keys(exportMap);
  if (!mapKeys.length) {
    console.error(`[check-release-dist] dist/${profile.map} has zero entries.`);
    process.exit(1);
  }

  const manifestPath = path.join(repoRoot, 'emscripten', 'wasm_export_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const requiredExports = manifest.required ?? [];
  const missingRequired = requiredExports.filter((name) => !(name in exportMap));
  if (missingRequired.length) {
    console.error(
      `[check-release-dist] ${profile.map} missing ${missingRequired.length} required export(s): ` +
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
        `[check-release-dist] dist/${profile.map} is a stale identity map; ` +
        `glue has minified names for: ${staleIdentity.slice(0, 5).join(', ')}` +
        (staleIdentity.length > 5 ? ` … (+${staleIdentity.length - 5} more)` : ''),
      );
      process.exit(1);
    }
  }

  if (!fs.existsSync(gluePath)) {
    console.error(`[check-release-dist] dist/${profile.glue} is missing (glue fallback for export map).`);
    process.exit(1);
  }

  if (!fs.existsSync(wasmPath)) {
    console.error(`[check-release-dist] dist/${profile.wasm} is missing.`);
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
      `[check-release-dist] dist/${profile.wasm} does not compile: ` +
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
      `[check-release-dist] dist/${profile.wasm} is missing ${unresolvable.length} required ` +
      `export(s): ${unresolvable.join(', ')}`,
    );
    console.error(
      `  Actual exports (${names.length}): ${preview}` +
      (names.length > 48 ? ` … (+${names.length - 48} more)` : ''),
    );
    console.error(
      `  The shipped binary is not the one dist/${profile.glue} was linked with. ` +
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
      `[check-release-dist] dist/${profile.map} names ${danglingMappings.length} ` +
      `symbol(s) absent from dist/${profile.wasm}:\n  ${danglingMappings.slice(0, 10).join('\n  ')}` +
      (danglingMappings.length > 10 ? `\n  … (+${danglingMappings.length - 10} more)` : ''),
    );
    console.error(`  Regenerate: node tools/extract_wasm_export_map.mjs dist/${profile.glue} <map>`);
    process.exit(1);
  }

  if (profile.singleThreaded) {
    const problems = checkSingleThreadedModule(fs.readFileSync(wasmPath));
    if (problems.length) {
      console.error(
        `[check-release-dist] dist/${profile.wasm} is not a single-threaded build:\n  ${problems.join('\n  ')}`,
      );
      process.exit(1);
    }
  }

  return { mapKeys: mapKeys.length, required: requiredExports.length };
}

const profileResults = HYPHON_PROFILES.map(checkHyphonProfile);

const rawTsInDist = distJsFiles.filter((p) => /\.tsx?$/.test(p));
if (rawTsInDist.length) {
  console.error('[check-release-dist] dist/ contains raw TypeScript assets:');
  for (const p of rawTsInDist) console.error(`  ${path.relative(repoRoot, p)}`);
  process.exit(1);
}

// Bundle-size budget (docs/PERFORMANCE_BUDGET.md#bundle-size-budget). Scoped to
// dist/assets/ — the directory Vite's bundler actually controls. Vendored
// native binaries (hyphon_native*, jc303*, rubberband.wasm) and the vendored
// Pyodide runtime (dist/pyodide/) live outside that graph and aren't budgeted
// here; ort-wasm-simd's own 20+ MB WASM binary is excluded the same way any
// .wasm is (see assetsDirExcludeExtensions), since it's runtime-fetched by
// onnxruntime-web on first TTS use, not part of what ships to every visitor.
const budgetPath = path.join(repoRoot, 'dist-budget.json');
const budget = fs.existsSync(budgetPath)
  ? JSON.parse(fs.readFileSync(budgetPath, 'utf8'))
  : null;
if (budget) {
  const budgetFailures = [];

  const indexHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf8') : '';
  const entrySrc = indexHtml.match(/<script[^>]*\stype=["']module["'][^>]*\ssrc=["']([^"']+)["']/i)?.[1];
  if (entrySrc) {
    const entryPath = path.join(distDir, entrySrc.replace(/^\.\//, ''));
    if (fs.existsSync(entryPath)) {
      const entrySize = fs.statSync(entryPath).size;
      if (entrySize > budget.entryChunkMaxBytes) {
        budgetFailures.push(
          `entry chunk ${path.relative(distDir, entryPath)} is ${entrySize.toLocaleString()} B, ` +
          `over budget of ${budget.entryChunkMaxBytes.toLocaleString()} B`,
        );
      }
    }
  }

  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
  const allDistFiles = walk(distDir);
  for (const p of allDistFiles) {
    if (IMAGE_EXTENSIONS.has(path.extname(p).toLowerCase())) {
      const size = fs.statSync(p).size;
      if (size > budget.imageAssetMaxBytes) {
        budgetFailures.push(
          `image asset ${path.relative(distDir, p)} is ${size.toLocaleString()} B, ` +
          `over budget of ${budget.imageAssetMaxBytes.toLocaleString()} B`,
        );
      }
    }
  }

  const assetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const excludeExts = new Set(budget.assetsDirExcludeExtensions ?? []);
    const assetFiles = walk(assetsDir).filter((p) => !excludeExts.has(path.extname(p).toLowerCase()));
    const assetSizes = assetFiles.map((p) => ({ path: p, size: fs.statSync(p).size }));
    const assetsTotal = assetSizes.reduce((sum, f) => sum + f.size, 0);
    if (assetsTotal > budget.assetsDirMaxBytes) {
      budgetFailures.push(
        `dist/assets total (excluding ${[...excludeExts].join(', ') || 'nothing'}) is ` +
        `${assetsTotal.toLocaleString()} B, over budget of ${budget.assetsDirMaxBytes.toLocaleString()} B`,
      );
      console.error('[check-release-dist] largest dist/assets files:');
      for (const f of assetSizes.sort((a, b) => b.size - a.size).slice(0, 10)) {
        console.error(`  ${f.size.toLocaleString()} B  ${path.relative(distDir, f.path)}`);
      }
    }
  }

  if (budgetFailures.length) {
    console.error('[check-release-dist] bundle-size budget exceeded (dist-budget.json):');
    for (const msg of budgetFailures) console.error(`  ${msg}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Compressed per-chunk budget (docs/PERFORMANCE_BUDGET.md#bundle-size-budget).
//
// Raw bytes are not the wire cost, so these rows gate on brotli. They are
// per-chunk rather than per-directory because once React and ORT move out of
// the entry, the next regression is not "the bundle grew" but "the vendor-onnx
// chunk quietly became 4 MB" — which a directory total would absorb.
//
// Budget values live in dist-budget.json, so raising one is a reviewed diff
// with a stated reason. See that file's `_procedure` field.
{
  const brotli = (p) => zlib.brotliCompressSync(fs.readFileSync(p)).length;
  const rows = [];
  const failures = [];

  const compressed = budget?.compressed;
  if (compressed) {
    const indexHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf8') : '';
    const entrySrc = indexHtml.match(/<script[^>]*\stype=["']module["'][^>]*\ssrc=["']([^"']+)["']/i)?.[1];
    const entryPath = entrySrc ? path.join(distDir, entrySrc.replace(/^\.\//, '')) : null;

    // Chunks reachable from the entry by STATIC import only — what a visitor
    // downloads before anything is interactive. A dynamic import() is
    // deliberately not followed: that is the whole point of deferring ORT.
    const eager = new Set();
    if (entryPath && fs.existsSync(entryPath)) {
      const rel = (f) => path.relative(distDir, f).split(path.sep).join('/');
      const queue = [entryPath];
      eager.add(rel(entryPath));
      while (queue.length) {
        const file = queue.pop();
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[\w${},*\s]*?\sfrom\s*)?["']([^"']+)["']/g)) {
          const spec = m[1];
          if (!spec.startsWith('.')) continue;
          const target = path.join(path.dirname(file), spec);
          if (!fs.existsSync(target)) continue;
          const key = rel(target);
          if (eager.has(key)) continue;
          eager.add(key);
          queue.push(target);
        }
      }
    }

    const named = (prefix) =>
      distJsFiles.filter((p) => path.basename(p).startsWith(prefix + '-'));

    const addRow = (label, file, max) => {
      if (!file || !fs.existsSync(file)) return;
      const size = brotli(file);
      const name = path.relative(distDir, file);
      rows.push({ label, name, size, max });
      if (typeof max === 'number' && size > max) {
        failures.push(
          `${label} (${name}) is ${size.toLocaleString()} B brotli, over budget of ` +
          `${max.toLocaleString()} B — ${(size - max).toLocaleString()} B over`,
        );
      }
    };

    addRow('entry JS', entryPath, compressed.entryChunkMaxBytes);
    addRow('vendor-react chunk', named('vendor-react')[0], compressed.vendorReactChunkMaxBytes);

    const onnxChunk = named('vendor-onnx')[0];
    addRow('vendor-onnx chunk', onnxChunk, compressed.vendorOnnxChunkMaxBytes);

    // The gate that matters more than the ORT chunk's size: it must not be
    // pulled into the eager graph. A single static `import * as ort` anywhere
    // undoes the deferral without changing any chunk's size.
    if (onnxChunk) {
      const key = path.relative(distDir, onnxChunk).split(path.sep).join('/');
      if (eager.has(key)) {
        failures.push(
          `vendor-onnx chunk (${key}) is reachable from the entry chunk by static import — ` +
          'ONNX Runtime must stay behind the dynamic import() in src/services/ortRuntime.ts, ' +
          'or every visitor pays for it before the sequencer is interactive',
        );
      }
    }

    const workletChunks = distJsFiles.filter((p) =>
      /(^|[^\w.$])registerProcessor\s*\(/.test(fs.readFileSync(p, 'utf8')),
    );
    const largestWorklet = workletChunks
      .map((p) => ({ p, size: brotli(p) }))
      .sort((a, b) => b.size - a.size)[0];
    if (largestWorklet) {
      addRow('largest worklet chunk', largestWorklet.p, compressed.largestWorkletChunkMaxBytes);
    }

    // Total wire cost of the Vite-built graph. Excludes .wasm for the same
    // reason the raw rows do: those are runtime-fetched, not shipped to every
    // visitor, and are already brotli-incompressible in practice.
    const assetsDirPath = path.join(distDir, 'assets');
    if (fs.existsSync(assetsDirPath)) {
      const excludeExts = new Set(budget.assetsDirExcludeExtensions ?? []);
      const files = walk(assetsDirPath).filter((p) => !excludeExts.has(path.extname(p).toLowerCase()));
      const total = files.reduce((sum, p) => sum + brotli(p), 0);
      rows.push({ label: 'dist/assets total', name: `${files.length} files`, size: total, max: compressed.assetsDirMaxBytes });
      if (typeof compressed.assetsDirMaxBytes === 'number' && total > compressed.assetsDirMaxBytes) {
        failures.push(
          `dist/assets total is ${total.toLocaleString()} B brotli, over budget of ` +
          `${compressed.assetsDirMaxBytes.toLocaleString()} B`,
        );
      }
    }

    console.log('[check-release-dist] compressed budget (brotli):');
    const pad = Math.max(...rows.map((r) => r.label.length), 0);
    for (const r of rows) {
      const max = typeof r.max === 'number' ? r.max.toLocaleString() : '—';
      const flag = typeof r.max === 'number' && r.size > r.max ? ' OVER' : '';
      console.log(
        `  ${r.label.padEnd(pad)}  ${r.size.toLocaleString().padStart(10)} B / ${max.padStart(10)} B  ${r.name}${flag}`,
      );
    }
  }

  if (failures.length) {
    console.error('[check-release-dist] compressed bundle budget exceeded (dist-budget.json):');
    for (const msg of failures) console.error(`  ${msg}`);
    console.error(
      '  To raise a budget, edit dist-budget.json in a reviewed commit and say why — ' +
      'see the `_procedure` field in that file.',
    );
    process.exit(1);
  }
}

const wasmSummary = profileResults
  .map((r, i) => `${HYPHON_PROFILES[i].wasm}: ${r.mapKeys} WASM export(s), ${r.required} resolved in the binary`)
  .join('; ');
console.log(
  allowMaps
    ? `[check-release-dist] OK — ${maps.length} source map(s) allowed, ${REQUIRED_WORKLET_PROCESSORS.length} worklet(s), ${wasmSummary}.`
    : `[check-release-dist] OK — no source maps, ${REQUIRED_WORKLET_PROCESSORS.length} worklet(s), ${wasmSummary}.`,
);
