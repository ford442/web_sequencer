#!/usr/bin/env node
/**
 * Vendor the Pyodide runtime into public/pyodide/ so the app loads it from its own
 * origin.
 *
 * Why: index.html used to pull pyodide.js from cdn.jsdelivr.net. That breaks the
 * WAM2 Phase B CSP (docs/adr/0001-wam2-host.md: same-origin scripts/worklets only,
 * no remote script-src) and any offline or locked-down deploy. Pyodide is tens of
 * MB, so it is fetched on demand and gitignored rather than committed.
 *
 * Usage:
 *   pnpm run vendor:pyodide
 *   pnpm run vendor:pyodide -- --force        # re-download over an existing copy
 *   PYODIDE_BASE_URL=https://mirror/... pnpm run vendor:pyodide
 *
 * The version comes from emscripten/toolchain.json#pyodide.version — the same
 * place emscripten/pyodide_bootstrap.js reads it from, so the two cannot drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST_DIR = path.join(REPO_ROOT, 'public', 'pyodide');

const toolchain = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'emscripten', 'toolchain.json'), 'utf8'),
);
const VERSION = toolchain.pyodide.version;
const FILES = toolchain.pyodide.files;
const BASE_URL =
  process.env.PYODIDE_BASE_URL ?? `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full`;

const force = process.argv.includes('--force');

async function download(name) {
  const dest = path.join(DEST_DIR, name);
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`[pyodide] have ${name}`);
    return;
  }
  const url = `${BASE_URL}/${name}`;
  process.stdout.write(`[pyodide] GET ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log(`${(buf.length / 1048576).toFixed(1)} MB`);
}

/**
 * Transitive closure of the packages the bootstrap loads, resolved from the
 * vendored pyodide-lock.json. Once indexURL points at our own origin, Pyodide
 * resolves wheels against it too — so a runtime that shipped without these would
 * 404 on `loadPackage(['numpy', 'scipy'])` instead of quietly reaching the CDN.
 */
function resolvePackageFiles(packages) {
  const lock = JSON.parse(fs.readFileSync(path.join(DEST_DIR, 'pyodide-lock.json'), 'utf8'));
  const files = [];
  const seen = new Set();
  const queue = [...packages];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    const entry = lock.packages?.[name];
    if (!entry) {
      throw new Error(`package "${name}" is not in pyodide-lock.json for v${VERSION}`);
    }
    seen.add(name);
    files.push(entry.file_name);
    for (const dep of entry.depends ?? []) queue.push(dep);
  }
  return files;
}

async function main() {
  console.log(`[pyodide] vendoring v${VERSION} into public/pyodide/`);
  fs.mkdirSync(DEST_DIR, { recursive: true });
  for (const name of FILES) {
    await download(name);
  }
  const pkgFiles = resolvePackageFiles(toolchain.pyodide.packages ?? []);
  for (const name of pkgFiles) {
    await download(name);
  }
  console.log(`[pyodide] done — runtime + ${pkgFiles.length} package file(s), all same-origin.`);
}

main().catch((err) => {
  console.error(`[pyodide] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
