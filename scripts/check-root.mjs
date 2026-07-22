#!/usr/bin/env node
/**
 * Root hygiene gate — fails CI/lint if archaeological clutter returns.
 *
 * 1. Root *.py must match allowlist (deploy.py only).
 * 2. Root *.md must match allowlist (canonical docs only).
 * 3. Every relative link in DOCS.md must resolve to an existing file.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

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
checkDocsLinks();

if (errors.length > 0) {
  console.error('check:root failed:\n');
  for (const message of errors) {
    console.error(`  • ${message}`);
  }
  process.exit(1);
}

console.log('check:root OK');
