#!/usr/bin/env node
/**
 * Module size ratchet.
 *
 * Soft budget: 700 lines per `src/**\/*.ts(x)` file. A file over budget must be
 * a row of the "## Modules over budget" table in
 * docs/refactoring/module-size-budget.md, and that row records its size:
 *
 *   | Lines | Module | Status |
 *   | 952   | `src/hooks/useAppState.tsx` | split plan ... |
 *
 * The recorded count is a ceiling that only goes down, the way
 * scripts/lint-ratchet.mjs treats eslint-baseline.json:
 *
 *   - a listed file that GREW past its recorded count fails;
 *   - a listed file that SHRANK fails until the row is lowered (so the gain is
 *     locked in) — `--update` does that;
 *   - a listed file that is back within budget (or gone) fails until its row is
 *     removed — `--update` does that too;
 *   - a file over budget with no row fails. `--update` never adds a row: a new
 *     exception needs a hand-written reason in review.
 *
 * Only the backticked `src/…` path on a table row under the "Modules over
 * budget" heading counts. A mention anywhere else in the doc — prose, another
 * section's table — does not (#1303: "`src/types.ts` is resolved" in prose
 * once exempted a 749-line resurrection of that file).
 *
 *   node scripts/check-module-size.mjs [--budget-doc <path>] [--update]
 *
 * `--budget-doc` points at a different budget doc (used by the regression
 * test in src/__tests__/checkModuleSize.test.ts).
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

const argv = process.argv.slice(2);
const update = argv.includes('--update');

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

/** Lines as `wc -l` counts them, plus an unterminated last line. */
function countLines(path) {
  const text = readFileSync(path, 'utf8');
  if (text.length === 0) return 0;
  const newlines = text.split('\n').length - 1;
  return text.endsWith('\n') ? newlines : newlines + 1;
}

function toRepoPath(absPath) {
  return relative(ROOT, absPath).split('\\').join('/');
}

function budgetDocPath() {
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
 * Rows of the exception table: markdown table lines (starting with `|`)
 * between the "## Modules over budget" heading and the next `## ` heading
 * that carry a backticked `src/...` path. `recorded` is the first cell as an
 * integer, or null when it is not one.
 */
function parseRows(lines) {
  const rows = [];
  let inSection = false;
  lines.forEach((line, index) => {
    if (/^##\s/.test(line)) {
      inSection = EXCEPTION_SECTION_HEADING.test(line);
      return;
    }
    if (!inSection || !line.trimStart().startsWith('|')) return;
    const paths = [...line.matchAll(/`(src\/[^`]+)`/g)].map((m) => m[1]);
    if (paths.length === 0) return;
    const firstCell = line.trim().slice(1).split('|')[0].replace(/\*/g, '').trim();
    const recorded = /^\d+$/.test(firstCell) ? Number(firstCell) : null;
    for (const path of paths) rows.push({ path, recorded, index });
  });
  return rows;
}

const docPath = budgetDocPath();
const docLines = readFileSync(docPath, 'utf8').split('\n');
const rows = parseRows(docLines);
const rowByPath = new Map(rows.map((row) => [row.path, row]));

const files = walk(SRC_DIR, []);
const sizes = new Map(files.map((file) => [toRepoPath(file), countLines(file)]));

const unlisted = [];
const grew = [];
const shrank = [];
const withinBudget = [];
const unreadable = [];

for (const [repoPath, lines] of sizes) {
  if (lines > BUDGET_LINES && !rowByPath.has(repoPath)) unlisted.push({ repoPath, lines });
}
for (const row of rows) {
  const lines = sizes.get(row.path) ?? (existsSync(join(ROOT, row.path)) ? countLines(join(ROOT, row.path)) : null);
  if (row.recorded === null) {
    unreadable.push({ ...row, lines });
  } else if (lines === null || lines <= BUDGET_LINES) {
    withinBudget.push({ ...row, lines });
  } else if (lines > row.recorded) {
    grew.push({ ...row, lines });
  } else if (lines < row.recorded) {
    shrank.push({ ...row, lines });
  }
}

const byLines = (a, b) => (b.lines ?? 0) - (a.lines ?? 0);
const pad = (n) => String(n ?? 'gone').padStart(5);

function report(title, entries, describe) {
  if (entries.length === 0) return;
  console.error(`${title}\n`);
  for (const entry of [...entries].sort(byLines)) console.error(`  ${describe(entry)}`);
  console.error('');
}

if (update) {
  if (grew.length > 0 || unlisted.length > 0 || unreadable.length > 0) {
    report('check-module-size: refusing to update — these files grew past their recorded size:', grew,
      (e) => `${pad(e.recorded)} -> ${pad(e.lines)}  ${e.path}`);
    report(`check-module-size: refusing to update — over ${BUDGET_LINES} lines with no row (add one by hand, with a reason):`, unlisted,
      (e) => `${pad(e.lines)}  ${e.repoPath}`);
    report('check-module-size: refusing to update — rows without a line count in the first cell:', unreadable,
      (e) => `line ${e.index + 1}  ${e.path}`);
    process.exit(1);
  }
  const drop = new Set(withinBudget.map((e) => e.index));
  const next = [];
  docLines.forEach((line, index) => {
    if (drop.has(index)) return;
    const lowered = shrank.find((e) => e.index === index);
    next.push(lowered ? line.replace(/^(\s*\|\s*\**)\d+/, `$1${lowered.lines}`) : line);
  });
  writeFileSync(docPath, next.join('\n'));
  for (const e of shrank) console.log(`check-module-size: ${e.path} ${e.recorded} -> ${e.lines}`);
  for (const e of withinBudget) console.log(`check-module-size: ${e.path} is within budget; row removed`);
  console.log(`check-module-size: budget table updated (${shrank.length} lowered, ${withinBudget.length} removed).`);
  process.exit(0);
}

const failures = grew.length + unlisted.length + shrank.length + withinBudget.length + unreadable.length;
if (failures > 0) {
  report(`check-module-size: ${grew.length} listed file(s) grew past the size recorded in the "Modules over budget" table:`, grew,
    (e) => `${pad(e.recorded)} -> ${pad(e.lines)}  ${e.path}`);
  if (grew.length > 0) {
    console.error('Split the file, or move code out of it, until it is back at (or under) its recorded size.\n');
  }
  report(`check-module-size: ${unlisted.length} file(s) exceed the ${BUDGET_LINES}-line soft budget and are not in the "Modules over budget" table of docs/refactoring/module-size-budget.md:`, unlisted,
    (e) => `${pad(e.lines)}  ${e.repoPath}`);
  if (unlisted.length > 0) {
    console.error(
      'Either split the file, or add a row for it to the "Modules over budget" table ' +
      '(its line count, its path in backticks, plus a one-line reason). A mention in prose does not count.\n',
    );
  }
  report('check-module-size: rows whose first cell is not a line count:', unreadable,
    (e) => `line ${e.index + 1}  ${e.path}`);
  report('check-module-size: listed files shrank — lock in the gain with `pnpm run check:module-size:update`:', shrank,
    (e) => `${pad(e.recorded)} -> ${pad(e.lines)}  ${e.path}`);
  report(`check-module-size: listed files are back within ${BUDGET_LINES} lines (or gone) — remove their rows with \`pnpm run check:module-size:update\`:`, withinBudget,
    (e) => `${pad(e.lines)}  ${e.path}`);
  process.exit(1);
}

console.log(
  `check-module-size: OK (${files.length} files scanned, budget ${BUDGET_LINES} lines, ${rows.length} recorded exceptions)`,
);
