#!/usr/bin/env node
/**
 * Bundle report: per-chunk raw/gzip/brotli sizes, and which chunks a visitor
 * actually downloads before anything is interactive.
 *
 * Deliberately dependency-free rather than using rollup-plugin-visualizer: CI
 * installs with --frozen-lockfile, and the numbers that matter here (compressed
 * size, and eager vs. lazy reachability) are the same ones dist-budget.json
 * gates on, so the report and the gate cannot drift.
 *
 *   node scripts/analyze-bundle.mjs
 *   node scripts/analyze-bundle.mjs --json          # machine-readable
 *   node scripts/analyze-bundle.mjs --compare base.json   # delta vs a saved --json report
 *                                                   # (markdown; report only, never fails)
 *   HYPHON_DIST_DIR=/tmp/bundle node scripts/analyze-bundle.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { compareReports, formatComparison } from './bundle-compare.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = process.env.HYPHON_DIST_DIR
  ? path.resolve(process.env.HYPHON_DIST_DIR)
  : path.join(repoRoot, 'dist');
const asJson = process.argv.includes('--json');
const compareIdx = process.argv.indexOf('--compare');
const comparePath = compareIdx >= 0 ? process.argv[compareIdx + 1] : null;
if (compareIdx >= 0 && !comparePath) {
  console.error('[analyze-bundle] --compare needs a baseline report path.');
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  console.error('[analyze-bundle] dist/ is missing — run `pnpm run build:web` first.');
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(distDir, p).split(path.sep).join('/');
const jsFiles = walk(distDir).filter((p) => p.endsWith('.js') && !p.endsWith('.map'));

// Static-import reachability from the entry: what is downloaded before the app
// is interactive. A dynamic import() is NOT followed — that is the whole point
// of deferring a chunk, so counting it as eager would hide the win.
const indexHtmlPath = path.join(distDir, 'index.html');
const html = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf8') : '';
const entrySrc = html.match(/<script[^>]*\stype=["']module["'][^>]*\ssrc=["']([^"']+)["']/i)?.[1];
const entryPath = entrySrc ? path.join(distDir, entrySrc.replace(/^\.\//, '')) : null;

const eager = new Set();
if (entryPath && fs.existsSync(entryPath)) {
  const queue = [entryPath];
  eager.add(rel(entryPath));
  while (queue.length) {
    const file = queue.pop();
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[\w${},*\s]*?\sfrom\s*)?["']([^"']+)["']/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const target = path.join(path.dirname(file), spec);
      if (!fs.existsSync(target) || eager.has(rel(target))) continue;
      eager.add(rel(target));
      queue.push(target);
    }
  }
}

const rows = jsFiles
  .map((p) => {
    const buf = fs.readFileSync(p);
    return {
      file: rel(p),
      raw: buf.length,
      gzip: zlib.gzipSync(buf).length,
      brotli: zlib.brotliCompressSync(buf).length,
      eager: eager.has(rel(p)),
    };
  })
  .sort((a, b) => b.brotli - a.brotli);

const sum = (list, key) => list.reduce((n, r) => n + r[key], 0);
const eagerRows = rows.filter((r) => r.eager);

// Same population dist-budget.json's assetsDirMaxBytes rows sum: everything
// under dist/assets/ except the excluded extensions (.wasm).
const budgetPath = path.join(repoRoot, 'dist-budget.json');
const budget = fs.existsSync(budgetPath) ? JSON.parse(fs.readFileSync(budgetPath, 'utf8')) : {};
const excludeExts = new Set(budget.assetsDirExcludeExtensions ?? ['.wasm']);
const assetsDir = path.join(distDir, 'assets');
const assets = fs.existsSync(assetsDir)
  ? walk(assetsDir)
      .filter((p) => !excludeExts.has(path.extname(p).toLowerCase()))
      .map((p) => {
        const buf = fs.readFileSync(p);
        return { file: rel(p), raw: buf.length, brotli: zlib.brotliCompressSync(buf).length };
      })
  : [];
const report = { entry: entryPath && rel(entryPath), rows, assets };

if (comparePath) {
  const baseline = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  console.log(formatComparison(compareReports(baseline, report, budget)));
} else if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const w = Math.max(...rows.map((r) => r.file.length), 4);
  console.log(`\n  ${'chunk'.padEnd(w)}  ${'raw'.padStart(11)}  ${'gzip'.padStart(10)}  ${'brotli'.padStart(10)}  load`);
  console.log(`  ${'-'.repeat(w)}  ${'-'.repeat(11)}  ${'-'.repeat(10)}  ${'-'.repeat(10)}  ----`);
  for (const r of rows) {
    console.log(
      `  ${r.file.padEnd(w)}  ${r.raw.toLocaleString().padStart(11)}  ` +
      `${r.gzip.toLocaleString().padStart(10)}  ${r.brotli.toLocaleString().padStart(10)}  ` +
      `${r.eager ? 'EAGER' : 'lazy'}`,
    );
  }
  console.log(
    `\n  eager (downloaded before interactive): ${eagerRows.length} chunk(s), ` +
    `${sum(eagerRows, 'raw').toLocaleString()} B raw / ${sum(eagerRows, 'brotli').toLocaleString()} B brotli`,
  );
  console.log(
    `  all JS: ${rows.length} chunk(s), ` +
    `${sum(rows, 'raw').toLocaleString()} B raw / ${sum(rows, 'brotli').toLocaleString()} B brotli\n`,
  );
}
