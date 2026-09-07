#!/usr/bin/env node
/**
 * Write native-artifacts.json (cache + optional dist copy).
 *
 *   node scripts/write-native-manifest.mjs
 *   node scripts/write-native-manifest.mjs --out dist/native-artifacts.json
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CACHE_MANIFEST_REL,
  defaultRepoRoot,
  defineWorlds,
  hashFile,
  loadMemoryBudget,
} from './native-worlds.mjs';

const SCHEMA_VERSION = 1;

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function toolVersion(repoRoot, cmd, args) {
  try {
    const r = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
    if (r.status !== 0) return null;
    const line = (r.stdout || r.stderr || '').trim().split('\n')[0];
    return line || null;
  } catch {
    return null;
  }
}

function gitRev(repoRoot, dir = '.') {
  try {
    const r = spawnSync('git', ['-C', path.join(repoRoot, dir), 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    });
    if (r.status !== 0) return null;
    return r.stdout.trim();
  } catch {
    return null;
  }
}

function artifactMeta(rel, world) {
  const threaded =
    world.world === 'emcc' ||
    rel.includes('threaded') ||
    (world.world === 'assemblyscript' && rel.includes('oscillators'));
  const requiresCoopCoep = world.world === 'emcc' || rel.includes('threaded');
  return { threaded, requiresCoopCoep };
}

function memoryFor(world, budget, rel) {
  if (world.world === 'emcc') {
    return {
      initialMb: budget.hyphonNative.initialMemoryMb,
      maximumMb: budget.hyphonNative.maximumMemoryMb,
      stackMb: budget.hyphonNative.stackSizeMb,
      pthreadPoolSize: budget.hyphonNative.pthreadPoolSize,
    };
  }
  if (world.world === 'rubberband') {
    // Owns its memory (not imported by the worklet), and NO_THREADING: no pool.
    return {
      initialMb: budget.rubberband.initialMemoryMb,
      maximumMb: budget.rubberband.maximumMemoryMb,
      stackMb: budget.rubberband.stackSizeMb,
      pthreadPoolSize: 0,
    };
  }
  if (world.world === 'jc303') {
    return {
      initialMb: budget.standaloneJc303.initialMemoryMb,
      maximumMb: budget.standaloneJc303.maximumMemoryMb,
      stackMb: budget.standaloneJc303.stackSizeMbRelease,
      pthreadPoolSize: rel.includes('threaded') ? budget.standaloneJc303.pthreadPoolSize : 0,
    };
  }
  return null;
}

function linkFlagsFor(world, rel) {
  const flags = ['ALLOW_MEMORY_GROWTH=1'];
  if (world.world === 'emcc' || rel.includes('threaded')) flags.unshift('USE_PTHREADS=1');
  return flags;
}

export function buildNativeManifest({ repoRoot = defaultRepoRoot(), profile = 'release' } = {}) {
  const worlds = defineWorlds(repoRoot);
  const budget = loadMemoryBudget(repoRoot);
  const artifacts = [];

  for (const world of worlds) {
    for (const rel of world.outputs) {
      const abs = path.join(repoRoot, rel);
      if (!exists(abs)) continue;
      const stat = fs.statSync(abs);
      const { threaded, requiresCoopCoep } = artifactMeta(rel, world);
      artifacts.push({
        id: path.posix.basename(rel),
        path: rel,
        sha256: hashFile(abs),
        bytes: stat.size,
        world: world.id,
        profile,
        threaded,
        requiresCoopCoep,
        memory: memoryFor(world, budget, rel),
        linkFlags: linkFlagsFor(world, rel),
      });
    }
  }

  const exportMapRel = 'public/hyphon_wasm_export_map.json';
  const exportManifestRel = 'emscripten/wasm_export_manifest.json';
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    profile,
    toolchains: {
      emcc: toolVersion(repoRoot, 'emcc', ['-dumpversion']) ??
        toolVersion(repoRoot, 'emcc', ['--version']),
      rustc: toolVersion(repoRoot, 'rustc', ['--version']),
      asc: pkg.devDependencies?.assemblyscript ?? null,
      node: process.version,
    },
    sources: {
      gitHead: gitRev(repoRoot, '.'),
      jc303Submodule: gitRev(repoRoot, 'jc303_wasm'),
    },
    exportContract: {
      mapPath: exportMapRel,
      mapSha256: exists(path.join(repoRoot, exportMapRel))
        ? hashFile(path.join(repoRoot, exportMapRel))
        : null,
      manifestSha256: exists(path.join(repoRoot, exportManifestRel))
        ? hashFile(path.join(repoRoot, exportManifestRel))
        : null,
    },
    artifacts,
  };
}

export function validateNativeManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return ['manifest is not an object'];
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!manifest.exportContract || typeof manifest.exportContract !== 'object') {
    errors.push('exportContract missing');
  }
  if (!Array.isArray(manifest.artifacts)) {
    errors.push('artifacts must be an array');
  } else {
    const seen = new Set();
    for (const art of manifest.artifacts) {
      for (const key of ['id', 'path', 'sha256', 'bytes', 'world']) {
        if (art[key] === undefined || art[key] === null || art[key] === '') {
          errors.push(`artifact missing ${key}`);
        }
      }
      const key = `${art.world}:${art.path}`;
      if (seen.has(key)) errors.push(`duplicate artifact ${key}`);
      seen.add(key);
    }
  }
  return errors;
}

export function writeNativeManifest({
  repoRoot = defaultRepoRoot(),
  profile = 'release',
  extraOut = null,
} = {}) {
  const manifest = buildNativeManifest({ repoRoot, profile });
  const errors = validateNativeManifest(manifest);
  if (errors.length) {
    throw new Error(`native-artifacts.json invalid:\n  ${errors.join('\n  ')}`);
  }
  const cachePath = path.join(repoRoot, CACHE_MANIFEST_REL);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(cachePath, json, 'utf8');
  if (extraOut) {
    const dest = path.isAbsolute(extraOut) ? extraOut : path.join(repoRoot, extraOut);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, json, 'utf8');
  }
  return manifest;
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  let extraOut = null;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--out') {
      extraOut = process.argv[i + 1];
      i += 1;
    }
  }
  const manifest = writeNativeManifest({ extraOut });
  console.log(
    `[native-artifacts] wrote ${CACHE_MANIFEST_REL}` +
      (extraOut ? ` and ${extraOut}` : '') +
      ` (${manifest.artifacts.length} artifacts).`,
  );
}
