#!/usr/bin/env node
/**
 * Fail closed if native artifacts are missing or stale vs content hashes.
 * Does not rebuild. Prints the exact `pnpm run …` command per world.
 *
 * Usage: node scripts/native-preflight.mjs
 */
import {
  defaultRepoRoot,
  defineWorlds,
  evaluateAll,
  formatPreflightReport,
  readStamps,
} from './native-worlds.mjs';

const repoRoot = defaultRepoRoot();
const worlds = defineWorlds(repoRoot);
const stamps = readStamps(repoRoot);
const results = evaluateAll(repoRoot, worlds, stamps);
const report = formatPreflightReport(results);
process.stdout.write(report);
process.exit(results.every((r) => r.status === 'ok') ? 0 : 1);
