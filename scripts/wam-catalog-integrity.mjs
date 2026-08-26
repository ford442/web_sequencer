#!/usr/bin/env node
/**
 * Recompute SHA-256 integrity for community packages in public/wam/catalog.json.
 *
 * The catalog is an allowlist: the installer refuses to import a community
 * package whose bytes do not hash to the value recorded here. Editing a package
 * therefore breaks it on purpose until this runs.
 *
 *   pnpm run wam:integrity          # rewrite catalog.json with current hashes
 *   pnpm run wam:integrity -- --check   # verify only, non-zero exit on drift
 *
 * `--check` is what CI runs, so a package edited without refreshing the catalog
 * fails the build instead of failing silently in a browser.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'public/wam/catalog.json');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

const checkOnly = process.argv.includes('--check');

/** Mirrors isSafeCommunityEntry() in src/audio/wam/catalogSource.ts. */
const COMMUNITY_ENTRY_RE = /^wam\/community\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*\.js$/;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  if (catalog.schema !== 2) {
    console.error(`[wam:integrity] unsupported catalog schema ${catalog.schema} (expected 2)`);
    process.exit(1);
  }

  const drift = [];
  let changed = false;

  for (const pkg of catalog.packages) {
    if (pkg.origin !== 'community') continue;

    if (!COMMUNITY_ENTRY_RE.test(pkg.entry ?? '')) {
      console.error(
        `[wam:integrity] "${pkg.id}": entry ${JSON.stringify(pkg.entry)} is not a safe relative ` +
          'path under wam/community/ — the installer would reject it.',
      );
      process.exit(1);
    }

    const abs = path.join(PUBLIC_DIR, pkg.entry);
    if (!fs.existsSync(abs)) {
      console.error(`[wam:integrity] "${pkg.id}": ${pkg.entry} does not exist`);
      process.exit(1);
    }
    const actual = sha256(fs.readFileSync(abs));
    const declared = pkg.integrity?.value;
    if (declared !== actual) {
      drift.push({ id: pkg.id, entry: pkg.entry, declared: declared ?? '(none)', actual });
      pkg.integrity = { alg: 'sha256', value: actual };
      changed = true;
    }
  }

  if (checkOnly) {
    if (drift.length) {
      console.error('[wam:integrity] FAILED — catalog integrity does not match the files on disk:');
      for (const d of drift) {
        console.error(`  ${d.id} (${d.entry})`);
        console.error(`    catalog: ${d.declared}`);
        console.error(`    file:    ${d.actual}`);
      }
      console.error('  Fix with: pnpm run wam:integrity');
      process.exit(1);
    }
    const count = catalog.packages.filter((p) => p.origin === 'community').length;
    console.log(`[wam:integrity] OK — ${count} community package(s) match the catalog.`);
    return;
  }

  if (changed) {
    fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    for (const d of drift) {
      console.log(`[wam:integrity] updated ${d.id}: ${d.actual}`);
    }
  } else {
    console.log('[wam:integrity] no changes — catalog already matches.');
  }
}

main();
