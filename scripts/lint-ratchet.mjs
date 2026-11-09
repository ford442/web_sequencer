#!/usr/bin/env node
/**
 * Lint ratchet: violation counts for every rule that eslint.config.js keeps
 * 'off' may only go down.
 *
 *   node scripts/lint-ratchet.mjs           # check (CI)
 *   node scripts/lint-ratchet.mjs --update  # rewrite eslint-baseline.json
 *
 * Runs ESLint with ESLINT_RATCHET=1 (all deferred rules -> error) and compares
 * per-rule counts with eslint-baseline.json. Fails when a count goes UP, when a
 * rule with violations has no baseline entry, or when a count went DOWN without
 * the baseline being lowered (so gains are locked in). --update refuses to
 * raise a count; edit the file by hand and justify it in review if you must.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(root, 'eslint-baseline.json')
const update = process.argv.includes('--update')

const dir = mkdtempSync(join(tmpdir(), 'lint-ratchet-'))
const out = join(dir, 'eslint.json')
const run = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['eslint', '.', '-f', 'json', '-o', out],
  { cwd: root, env: { ...process.env, ESLINT_RATCHET: '1' }, stdio: ['ignore', 'inherit', 'inherit'] },
)
let results
try {
  results = JSON.parse(readFileSync(out, 'utf8'))
} catch {
  console.error(`lint-ratchet: ESLint produced no JSON (exit ${run.status}).`)
  process.exit(2)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const counts = {}
for (const file of results) {
  for (const m of file.messages) {
    const key = m.ruleId ?? '(parse-error)'
    counts[key] = (counts[key] ?? 0) + 1
  }
}

let baseline = {}
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
} catch {
  if (!update) {
    console.error('lint-ratchet: eslint-baseline.json missing; run with --update.')
    process.exit(2)
  }
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

if (update) {
  const next = { ...baseline }
  for (const [rule, n] of Object.entries(counts)) {
    if (rule in baseline && n > baseline[rule]) {
      console.error(`lint-ratchet: refusing to raise ${rule}: ${baseline[rule]} -> ${n}`)
      process.exit(1)
    }
    next[rule] = n
  }
  for (const rule of Object.keys(next)) if (!(rule in counts)) next[rule] = 0
  writeFileSync(baselinePath, JSON.stringify(sorted(next), null, 2) + '\n')
  console.log('lint-ratchet: baseline updated.')
  process.exit(0)
}

const up = []
const down = []
for (const rule of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  const now = counts[rule] ?? 0
  const base = baseline[rule]
  if (base === undefined) {
    if (now > 0) up.push(`${rule}: ${now} violations, no baseline entry`)
  } else if (now > base) up.push(`${rule}: ${base} -> ${now}`)
  else if (now < base) down.push(`${rule}: ${base} -> ${now}`)
}

if (up.length) {
  console.error('lint-ratchet: violation counts increased:\n  ' + up.join('\n  '))
  process.exit(1)
}
if (down.length) {
  console.error(
    'lint-ratchet: counts dropped — lock in the gain with `pnpm run lint:ratchet:update` and commit eslint-baseline.json:\n  ' +
      down.join('\n  '),
  )
  process.exit(1)
}
console.log(`lint-ratchet OK (${Object.keys(baseline).length} rules tracked).`)
