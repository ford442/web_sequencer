#!/usr/bin/env node
/**
 * Release-bundle hygiene: fail if Vite source maps shipped without opt-in.
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

console.log(
  allowMaps
    ? `[check-release-dist] OK — ${maps.length} source map(s) allowed.`
    : '[check-release-dist] OK — no source maps, native-artifacts.json present.',
);
