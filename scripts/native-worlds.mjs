/**
 * Four Worlds registry for incremental native builds and preflight.
 *
 * Each world lists content-hashed inputs, expected outputs, and the exact
 * `pnpm run …` command that rebuilds it. Keep this file the single place that
 * names worlds so `check:native` and `build:native:changed` cannot drift.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAMP_REL = path.join('.cache', 'native', 'stamps.json');
export const CACHE_MANIFEST_REL = path.join('.cache', 'native', 'native-artifacts.json');

const AS_MODULES = [
  { id: 'as-oscillators', source: 'assembly/oscillators.ts', script: 'build:wasm:oscillators', stem: 'oscillators' },
  { id: 'as-freezer', source: 'assembly/trackFreezer.ts', script: 'build:wasm:freezer', stem: 'trackFreezer' },
  { id: 'as-fft', source: 'assembly/fft.ts', script: 'build:wasm:fft', stem: 'fft' },
  { id: 'as-audioexport', source: 'assembly/audioExport.ts', script: 'build:wasm:audioexport', stem: 'audioExport' },
  { id: 'as-xmexport', source: 'assembly/xmExport.ts', script: 'build:wasm:xmexport', stem: 'xmExport' },
];

export function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function loadPackageScripts(repoRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  return pkg.scripts ?? {};
}

export function loadMemoryBudget(repoRoot) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'emscripten', 'wasm_memory_budget.json'), 'utf8'),
  );
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Recursively list files under `dir`, skipping named directories.
 * Returns paths relative to `repoRoot`, POSIX-separated.
 */
export function walkFiles(repoRoot, relDir, { excludeDirNames = new Set() } = {}) {
  const abs = path.join(repoRoot, relDir);
  if (!exists(abs)) return [];
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      if (entry.isDirectory()) {
        if (excludeDirNames.has(entry.name)) continue;
        stack.push(path.join(current, entry.name));
        continue;
      }
      if (entry.isFile()) {
        const full = path.join(current, entry.name);
        out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
      }
    }
  }
  return out.sort();
}

function textInput(name, text) {
  return { kind: 'text', name, text: String(text ?? '') };
}

function fileInput(relPath) {
  return { kind: 'file', name: relPath };
}

function readSubmoduleCommit(repoRoot) {
  const gitFile = path.join(repoRoot, 'jc303_wasm', '.git');
  if (!exists(gitFile)) return 'missing';
  try {
    const raw = fs.readFileSync(gitFile, 'utf8').trim();
    if (raw.startsWith('gitdir:')) {
      const gitdir = raw.slice('gitdir:'.length).trim();
      const headPath = path.isAbsolute(gitdir)
        ? path.join(gitdir, 'HEAD')
        : path.join(repoRoot, 'jc303_wasm', gitdir, 'HEAD');
      if (!exists(headPath)) return 'missing-head';
      const head = fs.readFileSync(headPath, 'utf8').trim();
      if (head.startsWith('ref:')) {
        const ref = head.slice(4).trim();
        const refPath = path.join(path.dirname(headPath), ref);
        if (exists(refPath)) return fs.readFileSync(refPath, 'utf8').trim();
      }
      return head;
    }
    return raw.slice(0, 40);
  } catch {
    return 'unreadable';
  }
}

/**
 * @param {string} repoRoot
 * @param {Record<string, string>} [scripts]
 */
export function defineWorlds(repoRoot, scripts = loadPackageScripts(repoRoot)) {
  const budgetRel = 'emscripten/wasm_memory_budget.json';
  const asWorlds = AS_MODULES.map((mod) => ({
    id: mod.id,
    world: 'assemblyscript',
    rebuildCommand: `pnpm run ${mod.script}`,
    inputs: [
      fileInput(mod.source),
      fileInput(budgetRel),
      fileInput('package.json'),
      textInput(`script:${mod.script}`, scripts[mod.script] ?? ''),
    ],
    outputs: [
      `src/wasm/${mod.stem}.wasm`,
      `src/wasm/${mod.stem}.js`,
      `src/wasm/${mod.stem}.d.ts`,
    ],
    toolchain: 'asc',
  }));

  const rustSrc = walkFiles(repoRoot, 'rust-audio/src', { excludeDirNames: new Set(['target']) });

  const jc303WasmFiles = walkFiles(repoRoot, 'jc303_wasm/wasm', {
    excludeDirNames: new Set(['build_threaded', 'build_single', 'dist', 'build']),
  });
  const jc303SrcFiles = walkFiles(repoRoot, 'jc303_wasm/src', {
    excludeDirNames: new Set(['.git']),
  });

  const emccFiles = walkFiles(repoRoot, 'emscripten', {
    excludeDirNames: new Set(['temp_build', 'tests']),
  });
  const rubberbandSrc = walkFiles(repoRoot, 'rubberband/src', {
    excludeDirNames: new Set(['.git']),
  });
  const open303Dsp = walkFiles(repoRoot, 'jc303_wasm/src/dsp/open303', {
    excludeDirNames: new Set(['.git']),
  });

  return [
    ...asWorlds,
    {
      id: 'rust',
      world: 'rust',
      rebuildCommand: 'pnpm run build:wasm:rust',
      inputs: [
        ...rustSrc.map(fileInput),
        fileInput('rust-audio/Cargo.toml'),
        fileInput('rust-audio/Cargo.lock'),
      ],
      outputs: [
        'public/rust-wasm/rust_audio.js',
        'public/rust-wasm/rust_audio_bg.wasm',
      ],
      toolchain: 'rustc',
    },
    {
      id: 'jc303',
      world: 'jc303',
      rebuildCommand: 'pnpm run build:wasm:jc303',
      inputs: [
        ...jc303WasmFiles.map(fileInput),
        ...jc303SrcFiles.map(fileInput),
        fileInput('tools/build_jc303_omp.sh'),
        fileInput('scripts/ensure-pthread-worker-stamp.mjs'),
        fileInput('tools/jc303_cmake/CMakeLists.txt'),
        fileInput(budgetRel),
        textInput('jc303_wasm.submodule', readSubmoduleCommit(repoRoot)),
      ],
      outputs: [
        'public/jc303-single.js',
        'public/jc303-single.wasm',
        'public/jc303-single-worklet.js',
        'public/jc303-threaded.js',
        'public/jc303-threaded.wasm',
        'public/jc303-threaded.worker.js',
        'public/jc303-threaded-worklet.js',
      ],
      toolchain: 'emcc',
    },
    {
      id: 'emcc',
      world: 'emcc',
      rebuildCommand: 'pnpm run build:emcc',
      inputs: [
        ...emccFiles.map(fileInput),
        ...rubberbandSrc.map(fileInput),
        ...open303Dsp.map(fileInput),
        fileInput('emscripten/wasm_export_manifest.json'),
        fileInput('scripts/ensure-pthread-worker-stamp.mjs'),
        fileInput(budgetRel),
      ],
      outputs: [
        'public/hyphon_native.js',
        'public/hyphon_native.wasm',
        'public/hyphon_native.worker.js',
        'public/hyphon_wasm_export_map.json',
      ],
      toolchain: 'emcc',
    },
  ];
}

export function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function hashFile(absPath) {
  return hashBuffer(fs.readFileSync(absPath));
}

/**
 * Stable content hash of mixed file/text inputs.
 * Missing files contribute a sentinel so a newly-added required file is a miss.
 */
export function hashInputs(repoRoot, inputs) {
  const hasher = crypto.createHash('sha256');
  const sorted = [...inputs].sort((a, b) => a.name.localeCompare(b.name));
  for (const input of sorted) {
    hasher.update(input.name);
    hasher.update('\0');
    if (input.kind === 'text') {
      hasher.update('text\0');
      hasher.update(input.text);
    } else {
      const abs = path.join(repoRoot, input.name);
      if (!exists(abs)) {
        hasher.update('missing\0');
      } else {
        hasher.update('file\0');
        hasher.update(fs.readFileSync(abs));
      }
    }
    hasher.update('\n');
  }
  return hasher.digest('hex');
}

export function missingOutputs(repoRoot, outputs) {
  return outputs.filter((rel) => !exists(path.join(repoRoot, rel)));
}

/**
 * @returns {{
 *   id: string,
 *   status: 'ok' | 'missing' | 'stale',
 *   rebuildCommand: string,
 *   inputHash: string,
 *   missingOutputs: string[],
 *   reason: string | null,
 * }}
 */
export function evaluateWorld(repoRoot, world, stamp = null) {
  const inputHash = hashInputs(repoRoot, world.inputs);
  const missing = missingOutputs(repoRoot, world.outputs);
  if (missing.length) {
    return {
      id: world.id,
      status: 'missing',
      rebuildCommand: world.rebuildCommand,
      inputHash,
      missingOutputs: missing,
      reason: `missing outputs: ${missing.join(', ')}`,
    };
  }
  if (!stamp || stamp.inputHash !== inputHash) {
    const reason = !stamp
      ? 'no previous stamp'
      : 'input hash changed';
    return {
      id: world.id,
      status: 'stale',
      rebuildCommand: world.rebuildCommand,
      inputHash,
      missingOutputs: [],
      reason,
    };
  }
  return {
    id: world.id,
    status: 'ok',
    rebuildCommand: world.rebuildCommand,
    inputHash,
    missingOutputs: [],
    reason: null,
  };
}

export function evaluateAll(repoRoot, worlds, stamps = {}) {
  return worlds.map((world) => evaluateWorld(repoRoot, world, stamps[world.id] ?? null));
}

export function formatPreflightReport(results) {
  const failed = results.filter((r) => r.status !== 'ok');
  if (failed.length === 0) {
    return `[check:native] OK — ${results.length} worlds match stamps and outputs.\n`;
  }
  const lines = [`[check:native] FAILED — ${failed.length} world(s) need a rebuild\n`];
  for (const r of failed) {
    lines.push(`[check:native] ${r.status}: ${r.id}`);
    if (r.reason) lines.push(`  reason: ${r.reason}`);
    lines.push(`  rebuild: ${r.rebuildCommand}`);
  }
  return `${lines.join('\n')}\n`;
}

export function readStamps(repoRoot) {
  const p = path.join(repoRoot, STAMP_REL);
  if (!exists(p)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data.worlds ?? data;
  } catch {
    return {};
  }
}

export function writeStamps(repoRoot, worlds, results, extra = {}) {
  const dest = path.join(repoRoot, STAMP_REL);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const prev = readStamps(repoRoot);
  const next = { ...prev };
  for (const world of worlds) {
    const result = results.find((r) => r.id === world.id);
    if (result && result.status === 'ok') {
      next[world.id] = {
        inputHash: result.inputHash,
        rebuiltAt: extra.now ?? new Date().toISOString(),
        rebuildCommand: world.rebuildCommand,
      };
    }
  }
  fs.writeFileSync(
    dest,
    `${JSON.stringify({ schemaVersion: 1, worlds: next }, null, 2)}\n`,
    'utf8',
  );
}

/** Every assembly/*.ts and emscripten *.{cpp,h,js,json,sh} (except tests/) must be claimed. */
export function unclaimedNativeSources(repoRoot, worlds = defineWorlds(repoRoot)) {
  const claimed = new Set();
  for (const world of worlds) {
    for (const input of world.inputs) {
      if (input.kind === 'file') claimed.add(input.name);
    }
  }
  const required = [
    ...walkFiles(repoRoot, 'assembly'),
    ...walkFiles(repoRoot, 'emscripten', { excludeDirNames: new Set(['temp_build', 'tests']) })
      .filter((rel) => /\.(cpp|h|js|json|sh|a)$/.test(rel)),
  ];
  return required.filter((rel) => !claimed.has(rel));
}
