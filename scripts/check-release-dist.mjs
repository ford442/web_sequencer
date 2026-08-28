#!/usr/bin/env node
/**
 * Release-bundle hygiene:
 *   - fail if Vite source maps shipped without opt-in
 *   - fail if any remote script/CDN origin survived into the built index.html
 *   - warn if the Pyodide runtime was not vendored
 *
 *   node scripts/check-release-dist.mjs
 *   HYPHON_SOURCEMAP=1 node scripts/check-release-dist.mjs   # allow .map
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'dist');
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

console.log(
  allowMaps
    ? `[check-release-dist] OK — ${maps.length} source map(s) allowed.`
    : '[check-release-dist] OK — no source maps, native-artifacts.json present.',
);
