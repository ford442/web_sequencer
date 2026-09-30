#!/usr/bin/env node
/**
 * Root hygiene gate — fails CI/lint if archaeological clutter returns.
 *
 * 1. Root *.py must match allowlist (deploy.py only).
 * 2. Root *.md must match allowlist (canonical docs only).
 * 3. Every relative link in DOCS.md must resolve to an existing file.
 * 4. No merge artifacts (*.orig, *.rej) anywhere in the tracked tree — they are
 *    build-safe but they poison greps, diffs and agent context.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Suffixes left behind by `git merge` / `git apply` conflicts. */
const MERGE_ARTIFACT_SUFFIXES = ['.orig', '.rej'];

/** Directories that are not ours to police (deps, build output, vendored SDKs). */
const SCAN_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'emsdk',
  'coverage',
  'test-results',
  'playwright-report',
  '.pnpm-store',
]);

const ALLOWED_ROOT_PY = new Set(['deploy.py']);
const ALLOWED_ROOT_MD = new Set([
  'README.md',
  'AGENTS.md',
  'DOCS.md',
  'CHANGELOG.md',
  'claude.md',
  'CLAUDE.md',
]);

const errors = [];

function listRootFiles(ext) {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name.endsWith(ext))
    .map((entry) => entry.name);
}

function checkRootPy() {
  for (const name of listRootFiles('.py')) {
    if (!ALLOWED_ROOT_PY.has(name)) {
      errors.push(`Unexpected root *.py: ${name} (allowlist: ${[...ALLOWED_ROOT_PY].join(', ')})`);
    }
  }
}

function checkRootMd() {
  for (const name of listRootFiles('.md')) {
    if (!ALLOWED_ROOT_MD.has(name)) {
      errors.push(`Unexpected root *.md: ${name} (allowlist: ${[...ALLOWED_ROOT_MD].sort().join(', ')})`);
    }
  }
}

/** Walk the tree once, collecting merge artifacts. */
function collectMergeArtifacts(dir, found) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // unreadable directory is not a hygiene failure
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      collectMergeArtifacts(full, found);
      continue;
    }
    // Symlinks are reported as neither file nor directory by some platforms;
    // stat them so a linked-in artifact still counts.
    const isFile = entry.isFile() || (entry.isSymbolicLink() && safeIsFile(full));
    if (isFile && MERGE_ARTIFACT_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      found.push(full.slice(ROOT.length + 1));
    }
  }
  return found;
}

function safeIsFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function checkMergeArtifacts() {
  for (const relative of collectMergeArtifacts(ROOT, [])) {
    errors.push(`Merge artifact left in tree: ${relative} (delete it; *.orig / *.rej are banned)`);
  }
}

function checkDocsLinks() {
  const docsPath = join(ROOT, 'DOCS.md');
  if (!existsSync(docsPath)) {
    errors.push('DOCS.md is missing from repository root');
    return;
  }

  const content = readFileSync(docsPath, 'utf8');
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;

  while ((match = linkPattern.exec(content)) !== null) {
    const target = match[1].trim();
    if (!target || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) {
      continue;
    }

    const resolved = resolve(ROOT, target.split('#')[0]);
    if (!existsSync(resolved)) {
      errors.push(`DOCS.md broken link: (${target}) → ${resolved}`);
    }
  }
}

checkRootPy();
checkRootMd();
checkMergeArtifacts();
checkDocsLinks();

if (errors.length > 0) {
  console.error('check:root failed:\n');
  for (const message of errors) {
    console.error(`  • ${message}`);
  }
  process.exit(1);
}

console.log('check:root OK');
