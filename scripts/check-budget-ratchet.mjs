#!/usr/bin/env node
/**
 * Budget ratchet guard: a numeric row in dist-budget.json may only go UP in a
 * pull request that touches nothing but dist-budget.json (and docs/).
 *
 *   node scripts/check-budget-ratchet.mjs
 *
 * dist-budget.json's `_procedure` says a raise goes "in its own reviewed
 * commit" and "Never raise a row to make an unrelated PR go green". That is
 * prose; this makes it a check. It compares the PR's merge-base copy of the
 * file with HEAD's copy and fails when a row was raised (or a row was removed,
 * which un-budgets it) while the same PR also changes any path outside
 * `allowed`. Lowering a row and adding a new row never fail.
 *
 * Base: `origin/$GITHUB_BASE_REF`, else `origin/main`; the base copy is read at
 * `git merge-base <base> HEAD`, the changed paths come from
 * `git diff --name-only --no-renames <base>...HEAD`. Needs full history
 * (`fetch-depth: 0`). On a `pull_request` run an unresolvable base is a
 * failure, never a skip; anywhere else it prints why it skipped and exits 0.
 *
 * Not covered on purpose: edits to non-numeric fields (`_comment`,
 * `_procedure`, `assetsDirExcludeExtensions`) and to the gate script itself.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BUDGET_FILE = 'dist-budget.json';

/** Paths a budget-raising PR may also touch. A trailing `/` is a directory prefix. */
export const DEFAULT_ALLOWED = [BUDGET_FILE, 'docs/'];

/**
 * Every numeric leaf of the budget as `dotted.path -> number`. `_`-prefixed keys
 * (comments, procedure text) and arrays (the extension list) are skipped.
 * @returns {Map<string, number>}
 */
export function numericLeaves(obj, prefix = '') {
  const out = new Map();
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('_')) continue;
    const path = prefix + key;
    if (typeof value === 'number') out.set(path, value);
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [p, v] of numericLeaves(value, `${path}.`)) out.set(p, v);
    }
  }
  return out;
}

/**
 * @returns {{
 *   raised: {key: string, from: number, to: number}[],
 *   lowered: {key: string, from: number, to: number}[],
 *   added: {key: string, to: number}[],
 *   removed: {key: string, from: number}[],
 * }}
 */
export function diffBudgets(base, head) {
  const before = numericLeaves(base);
  const after = numericLeaves(head);
  const result = { raised: [], lowered: [], added: [], removed: [] };
  for (const [key, to] of after) {
    if (!before.has(key)) result.added.push({ key, to });
    else {
      const from = before.get(key);
      if (to > from) result.raised.push({ key, from, to });
      else if (to < from) result.lowered.push({ key, from, to });
    }
  }
  for (const [key, from] of before) if (!after.has(key)) result.removed.push({ key, from });
  return result;
}

function isAllowed(path, allowed) {
  return allowed.some((a) => (a.endsWith('/') ? path.startsWith(a) : path === a));
}

const fmt = (n) => n.toLocaleString('en-US');

/**
 * @param {{base: object|null|undefined, head: object, changedPaths: string[], allowed?: string[]}} input
 * @returns {{ok: boolean, failures: string[]}}
 */
export function checkBudgetRatchet({ base, head, changedPaths, allowed = DEFAULT_ALLOWED }) {
  const { raised, removed } = diffBudgets(base, head);
  const outside = changedPaths.filter((p) => !isAllowed(p, allowed));
  if (outside.length === 0) return { ok: true, failures: [] };

  const shown = outside.slice(0, 5).join(', ') + (outside.length > 5 ? `, … (+${outside.length - 5} more)` : '');
  const rule =
    `This PR also changes ${outside.length} path(s) outside ${allowed.join(', ')} (${shown}). ` +
    `A budget row may only be raised in a PR that changes nothing but ${BUDGET_FILE} (and docs/): ` +
    `split the raise into its own PR, or bring the bundle back under the existing row.`;
  const failures = [
    ...raised.map((r) => `${BUDGET_FILE}: ${r.key} raised ${fmt(r.from)} -> ${fmt(r.to)} (+${fmt(r.to - r.from)}). ${rule}`),
    ...removed.map((r) => `${BUDGET_FILE}: ${r.key} removed (was ${fmt(r.from)}), which un-budgets it. ${rule}`),
  ];
  return { ok: failures.length === 0, failures };
}

// ---------------------------------------------------------------- CLI ------

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
}

/** Resolve `{ref, mergeBase}` or throw with the reason. */
function resolveBase(env) {
  const ref = `origin/${env.GITHUB_BASE_REF || 'main'}`;
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new Error(`base ref ${ref} does not exist (fetch it, or check out with fetch-depth: 0)`);
  }
  try {
    return { ref, mergeBase: git(['merge-base', ref, 'HEAD']).trim() };
  } catch {
    throw new Error(`no merge-base between ${ref} and HEAD (shallow checkout? use fetch-depth: 0)`);
  }
}

function readBudgetAt(rev) {
  // `git show <rev>:<path>` fails both for a missing file and for a broken repo; ls-tree tells them apart.
  if (git(['ls-tree', '--name-only', rev, '--', BUDGET_FILE]).trim() === '') return null;
  return JSON.parse(git(['show', `${rev}:${BUDGET_FILE}`]));
}

export function main(env = process.env) {
  const onPr = env.GITHUB_EVENT_NAME === 'pull_request';
  let base;
  try {
    base = resolveBase(env);
  } catch (err) {
    if (onPr) {
      console.error(`budget-ratchet: FAIL - cannot resolve the PR base: ${err.message}`);
      return 1;
    }
    console.log(`budget-ratchet: skipped - ${err.message}. (Runs for real on pull_request.)`);
    return 0;
  }

  let baseBudget;
  let headBudget;
  let changedPaths;
  try {
    baseBudget = readBudgetAt(base.mergeBase);
    headBudget = readBudgetAt('HEAD');
    changedPaths = git(['diff', '--name-only', '--no-renames', `${base.ref}...HEAD`]).split('\n').filter(Boolean);
  } catch (err) {
    console.error(`budget-ratchet: FAIL - cannot read ${BUDGET_FILE} or the diff against ${base.ref}: ${err.message}`);
    return 1;
  }
  if (headBudget === null) {
    console.error(`budget-ratchet: FAIL - ${BUDGET_FILE} is missing at HEAD.`);
    return 1;
  }

  const diff = diffBudgets(baseBudget, headBudget);
  const { ok, failures } = checkBudgetRatchet({ base: baseBudget, head: headBudget, changedPaths });
  const summary = `${diff.raised.length} raised, ${diff.lowered.length} lowered, ${diff.added.length} added, ${diff.removed.length} removed`;
  if (!ok) {
    console.error(`budget-ratchet: FAIL (${summary}; base ${base.ref} @ ${base.mergeBase.slice(0, 8)})`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  const note = diff.raised.length + diff.removed.length > 0 ? ' (dedicated budget PR)' : '';
  console.log(`budget-ratchet: ok - ${summary}${note}; base ${base.ref} @ ${base.mergeBase.slice(0, 8)}`);
  for (const r of diff.raised) console.log(`  raised  ${r.key} ${fmt(r.from)} -> ${fmt(r.to)}`);
  for (const r of diff.lowered) console.log(`  lowered ${r.key} ${fmt(r.from)} -> ${fmt(r.to)}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
