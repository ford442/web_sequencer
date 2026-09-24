#!/usr/bin/env node
/**
 * Module size gate.
 *
 * Soft budget: 700 lines per `src/**\/*.ts(x)` file. A file over budget only
 * fails this check if it is NOT mentioned (by its repo-relative path) in
 * docs/refactoring/module-size-budget.md — so every file already over budget
 * at the time this gate landed had to be recorded there once (with a reason:
 * "justified exception", "tracked follow-up", or a split plan), and this
 * script does not re-fail that historical inventory on every run. A brand
 * new file that grows past 700 lines without ever being written up in that
 * doc is what actually fails CI.
 *
 *   node scripts/check-module-size.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_DIR = join(ROOT, 'src');
const BUDGET_DOC = join(ROOT, 'docs', 'refactoring', 'module-size-budget.md');
const BUDGET_LINES = 700;
const TRACKED_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '.git']);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (TRACKED_EXTENSIONS.has(extname(entry.name))) out.push(full);
  }
  return out;
}

function countLines(path) {
  const text = readFileSync(path, 'utf8');
  if (text.length === 0) return 0;
  return text.split('\n').length;
}

function toRepoPath(absPath) {
  return relative(ROOT, absPath).split('\\').join('/');
}

const budgetDocText = readFileSync(BUDGET_DOC, 'utf8');

function isDocumented(repoPath) {
  return budgetDocText.includes(repoPath);
}

const files = walk(SRC_DIR, []);
const violations = [];
for (const file of files) {
  const repoPath = toRepoPath(file);
  const lines = countLines(file);
  if (lines > BUDGET_LINES && !isDocumented(repoPath)) {
    violations.push({ repoPath, lines });
  }
}

if (violations.length > 0) {
  violations.sort((a, b) => b.lines - a.lines);
  console.error(
    `check-module-size: ${violations.length} file(s) exceed the ${BUDGET_LINES}-line soft budget ` +
    `and are not listed in docs/refactoring/module-size-budget.md:\n`
  );
  for (const { repoPath, lines } of violations) {
    console.error(`  ${String(lines).padStart(5)}  ${repoPath}`);
  }
  console.error(
    `\nEither split the file, or add it to docs/refactoring/module-size-budget.md ` +
    `(its path in backticks, plus a one-line reason).`
  );
  process.exit(1);
}

console.log(`check-module-size: OK (${files.length} files scanned, budget ${BUDGET_LINES} lines)`);
