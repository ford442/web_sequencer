#!/usr/bin/env node
/**
 * Four Worlds native builder.
 *
 *   node scripts/native-build.mjs --all       # rebuild every world
 *   node scripts/native-build.mjs --changed   # rebuild missing/stale only
 */
import { spawnSync } from 'node:child_process';
import {
  defaultRepoRoot,
  defineWorlds,
  evaluateAll,
  evaluateWorld,
  formatPreflightReport,
  readStamps,
  writeStamps,
} from './native-worlds.mjs';
import { writeNativeManifest } from './write-native-manifest.mjs';

function parseArgs(argv) {
  const args = { mode: 'changed' };
  for (const a of argv.slice(2)) {
    if (a === '--all') args.mode = 'all';
    else if (a === '--changed') args.mode = 'changed';
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function runCommand(repoRoot, command) {
  const parts = command.split(/\s+/).filter(Boolean);
  console.log(`\n[native-build] $ ${command}\n`);
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}`);
  }
}

const args = parseArgs(process.argv);
const repoRoot = defaultRepoRoot();
const worlds = defineWorlds(repoRoot);
const stamps = readStamps(repoRoot);

const planned = args.mode === 'all'
  ? worlds.map((w) => ({
      ...evaluateWorld(repoRoot, w, null),
      status: 'stale',
      reason: 'forced --all',
    }))
  : evaluateAll(repoRoot, worlds, stamps);

const todo = planned.filter((r) => r.status !== 'ok');
if (todo.length === 0) {
  process.stdout.write(formatPreflightReport(planned));
  writeNativeManifest({ repoRoot, profile: process.env.HYPHON_BUILD_PROFILE || 'release' });
  process.exit(0);
}

console.log(`[native-build] ${args.mode}: rebuilding ${todo.map((t) => t.id).join(', ')}`);

const rebuilt = [];
for (const item of todo) {
  const world = worlds.find((w) => w.id === item.id);
  runCommand(repoRoot, world.rebuildCommand);
  const afterOne = evaluateWorld(repoRoot, world, {
    inputHash: hashInputsFor(world),
  });
  if (afterOne.status === 'missing') {
    process.stderr.write(formatPreflightReport([afterOne]));
    process.stderr.write(`[native-build] ${world.id} finished but outputs are still missing.\n`);
    process.exit(1);
  }
  writeStamps(repoRoot, [world], [{ ...afterOne, status: 'ok', inputHash: hashInputsFor(world) }]);
  rebuilt.push(item.id);
}

function hashInputsFor(world) {
  return evaluateWorld(repoRoot, world, null).inputHash;
}

writeNativeManifest({ repoRoot, profile: process.env.HYPHON_BUILD_PROFILE || 'release' });
console.log(`[native-build] done — rebuilt: ${rebuilt.join(', ') || '(none)'}`);
