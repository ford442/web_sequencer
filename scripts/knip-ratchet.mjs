#!/usr/bin/env node
/**
 * Dead-code ratchet: no new module may be unreachable from production code.
 *
 *   node scripts/knip-ratchet.mjs           # check (pnpm lint)
 *   node scripts/knip-ratchet.mjs --update  # rewrite knip-baseline.json
 *
 * Runs knip (knip.json) in production mode: entries are src/main.tsx (which
 * reaches every `?worker&url` worklet / worker and lazy import) plus scripts/**
 * and tools/**; tests and test helpers are not entries, so a module only its
 * own test imports counts as unused. #1134 deleted such a slice once and it grew
 * back, hence the gate.
 *
 * knip-baseline.json lists the files that were already orphaned when the gate
 * landed. Fails on any unused file not in it, and on a baseline entry that is
 * no longer unused (deleted or wired in) so the list only shrinks. --update
 * refuses to add a file; delete it or wire it in instead.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(root, 'knip-baseline.json')
const update = process.argv.includes('--update')

const run = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['knip', '--production', '--include', 'files', '--reporter', 'json', '--no-exit-code', '--no-progress'],
  {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, npm_config_update_notifier: 'false' },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
)
let report
try {
  report = JSON.parse(run.stdout)
} catch {
  console.error(`knip-ratchet: knip produced no JSON (exit ${run.status}).`)
  process.exit(2)
}

// JSON reporter: one issue per file, unused files under `files: [{ name }]`.
const unused = new Set((report.issues ?? []).flatMap((i) => (i.files ?? []).map((f) => f.name)))

let baseline = []
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).unusedFiles
} catch {
  if (!update) {
    console.error('knip-ratchet: knip-baseline.json missing; run with --update.')
    process.exit(2)
  }
}
const known = new Set(baseline)

const added = [...unused].filter((f) => !known.has(f)).sort()
const gone = [...known].filter((f) => !unused.has(f)).sort()

if (update) {
  if (added.length && baseline.length) {
    console.error(
      'knip-ratchet: refusing to baseline new orphans — delete them, or import them from production code:\n  ' +
        added.join('\n  '),
    )
    process.exit(1)
  }
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        $comment: [
          'Files knip (knip.json, production mode) already found unreachable when the',
          'gate landed. Shrink only: scripts/knip-ratchet.mjs fails on a new orphan and',
          'on an entry here that is no longer unused. Update with pnpm run lint:knip:update.',
        ],
        unusedFiles: [...unused].sort(),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`knip-ratchet: baseline updated (${unused.size} files).`)
  process.exit(0)
}

if (added.length) {
  console.error(
    'knip-ratchet: no production code reaches these files (a test import does not count).\n' +
      'Delete them, or wire them in from src/main.tsx / a worklet / a script:\n  ' +
      added.join('\n  '),
  )
  process.exit(1)
}
if (gone.length) {
  console.error(
    'knip-ratchet: baselined orphans are gone — lock it in with `pnpm run lint:knip:update` and commit knip-baseline.json:\n  ' +
      gone.join('\n  '),
  )
  process.exit(1)
}
console.log(`knip-ratchet OK (${known.size} baselined orphans, none new).`)
