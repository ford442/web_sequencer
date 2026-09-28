#!/usr/bin/env node
/**
 * Module size gate.
 *
 * Soft budget: 700 lines per `src/**\/*.ts(x)` file. A file over budget only
 * fails this check if it is NOT listed (its repo-relative path, in backticks)
 * in a table row of the "## Modules over budget" section of
 * docs/refactoring/module-size-budget.md. A mention anywhere else in that doc
 * — prose, another section's table — does not count: a sentence like
 * "`src/types.ts` is resolved" must not quietly exempt the file if it ever
 * grows back (#1303 did exactly that). So every file already over budget
 * at the time this gate landed had to be recorded there once (with a reason:
 * "justified exception", "tracked follow-up", or a split plan), and this
 * script does not re-fail that historical inventory on every run. A brand
 * new file that grows past 700 lines without ever being written up in that
 * doc is what actually fails CI.
 *
 *   node scripts/check-module-size.mjs [--budget-doc <path>]
 *
 * `--budget-doc` points at a different budget doc (used by the regression
 * test in src/__tests__/checkModuleSize.test.ts).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_DIR = join(ROOT, 'src');
const DEFAULT_BUDGET_DOC = join(ROOT, 'docs', 'refactoring', 'module-size-budget.md');
const EXCEPTION_SECTION_HEADING = /^##\s+Modules over budget\b/;
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

function budgetDocPath(argv) {
  const flag = argv.indexOf('--budget-doc');
  if (flag === -1) return DEFAULT_BUDGET_DOC;
  const value = argv[flag + 1];
  if (!value) {
    console.error('check-module-size: --budget-doc needs a path');
    process.exit(2);
  }
  return resolve(value);
}

/**
 * Paths in the exception table: backticked `src/...` paths on markdown table
 * rows (lines starting with `|`) between the "## Modules over budget" heading
 * and the next `## ` heading. Nothing else in the doc exempts a file.
 */
function parseExemptPaths(docText) {
  const exempt = new Set();
  let inSection = false;
  for (const line of docText.split('\n')) {
    if (/^##\s/.test(line)) {
      inSection = EXCEPTION_SECTION_HEADING.test(line);
      continue;
    }
    if (!inSection || !line.trimStart().startsWith('|')) continue;
    for (const match of line.matchAll(/`(src\/[^`]+)`/g)) exempt.add(match[1]);
  }
  return exempt;
}

const exemptPaths = parseExemptPaths(readFileSync(budgetDocPath(process.argv.slice(2)), 'utf8'));

function isDocumented(repoPath) {
  return exemptPaths.has(repoPath);
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
    `and are not in the "Modules over budget" table of docs/refactoring/module-size-budget.md:\n`
  );
  for (const { repoPath, lines } of violations) {
    console.error(`  ${String(lines).padStart(5)}  ${repoPath}`);
  }
  console.error(
    `\nEither split the file, or add a row for it to the "Modules over budget" table in ` +
    `docs/refactoring/module-size-budget.md (its path in backticks, plus a one-line reason). ` +
    `A mention in prose does not count.`
  );
  process.exit(1);
}

console.log(`check-module-size: OK (${files.length} files scanned, budget ${BUDGET_LINES} lines)`);
