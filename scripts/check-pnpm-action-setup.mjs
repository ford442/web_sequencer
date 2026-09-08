#!/usr/bin/env node
/**
 * Fail fast when GitHub Actions pin `pnpm/action-setup` `version:` while
 * package.json also declares `packageManager`.
 *
 * pnpm/action-setup@v4 hard-errors with "Multiple versions of pnpm specified"
 * and every job dies about one second in — before any repo script runs. The
 * same family — a manifest or lockfile edit landing without CI validating it —
 * has red-ed main on 2026-06-22, 2026-07-13 and 2026-09-07.
 *
 *   node scripts/check-pnpm-action-setup.mjs
 *   node scripts/check-pnpm-action-setup.mjs --root /path/to/fixture
 *   CHECK_PNPM_ACTION_SETUP_ROOT=/path/to/fixture node scripts/check-pnpm-action-setup.mjs
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveRoot() {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf('--root');
  if (flagIdx >= 0 && args[flagIdx + 1]) {
    return resolve(args[flagIdx + 1]);
  }
  if (process.env.CHECK_PNPM_ACTION_SETUP_ROOT) {
    return resolve(process.env.CHECK_PNPM_ACTION_SETUP_ROOT);
  }
  return resolve(__dirname, '..');
}

const ROOT = resolveRoot();
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');
const PACKAGE_JSON = join(ROOT, 'package.json');

const PNPM_SETUP_USES = /^\s*- uses:\s*pnpm\/action-setup(?:@\S+)?\s*$/;
const STEP_START = /^\s*- (?:uses|name|run|id):/;
const VERSION_KEY = /^\s*version:\s*\S/;

function readPackageManager(packageJsonPath) {
  if (!existsSync(packageJsonPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return typeof pkg.packageManager === 'string' && pkg.packageManager.trim()
      ? pkg.packageManager.trim()
      : null;
  } catch {
    return null;
  }
}

function leadingSpaces(line) {
  const match = line.match(/^( *)/);
  return match ? match[1].length : 0;
}

/**
 * Collect workflow-relative paths whose pnpm/action-setup step pins `version:`.
 */
function findPinnedActionSetupFiles(workflowsDir) {
  const pinned = [];
  if (!existsSync(workflowsDir)) return pinned;

  const files = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/i.test(name));
  for (const name of files) {
    const rel = join('.github', 'workflows', name);
    const text = readFileSync(join(workflowsDir, name), 'utf8');
    const lines = text.split(/\r?\n/);
    let inSetupStep = false;
    let setupIndent = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      if (PNPM_SETUP_USES.test(line)) {
        inSetupStep = true;
        setupIndent = leadingSpaces(line);
        continue;
      }

      if (!inSetupStep) continue;

      const indent = leadingSpaces(line);
      if (indent <= setupIndent && STEP_START.test(line)) {
        inSetupStep = false;
        if (PNPM_SETUP_USES.test(line)) {
          inSetupStep = true;
          setupIndent = indent;
        }
        continue;
      }

      if (VERSION_KEY.test(line)) {
        pinned.push(rel);
        break;
      }
    }
  }
  return pinned;
}

const packageManager = readPackageManager(PACKAGE_JSON);
const pins = findPinnedActionSetupFiles(WORKFLOWS_DIR);

if (packageManager && pins.length > 0) {
  console.error('[check-pnpm-action-setup] collision: package.json packageManager and workflow version pins');
  console.error(`  packageManager: ${packageManager}`);
  console.error('  pinned files:');
  for (const file of pins) {
    console.error(`    • ${file}`);
  }
  console.error('  Remove the pnpm/action-setup `version:` pins so the action reads packageManager.');
  process.exit(1);
}

console.log('[check-pnpm-action-setup] OK');
