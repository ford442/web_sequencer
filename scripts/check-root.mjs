#!/usr/bin/env node
/**
 * Root hygiene gate — fails CI/lint if archaeological clutter returns.
 *
 * 1. Every entry (file or directory) at the repo root must be on an explicit
 *    allowlist. Anything else — a stray screenshot, a one-shot patch script,
 *    a scratch `.txt`, a leftover output directory — fails the gate by name.
 * 2. Every relative link in DOCS.md must resolve to an existing file.
 * 3. No merge artifacts (*.orig, *.rej) anywhere in the tracked tree — they are
 *    build-safe but they poison greps, diffs and agent context.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Suffixes left behind by `git merge` / `git apply` conflicts. */
const MERGE_ARTIFACT_SUFFIXES = ['.orig', '.rej'];

/**
 * Directories that are not ours to police (deps, build output, vendored
 * SDKs). These are gitignored and never tracked, but can legitimately exist
 * on disk locally or in CI after install/build/test — the root-entry
 * allowlist below skips them rather than requiring them to be listed, and
 * the merge-artifact scan skips descending into them.
 */
const SCAN_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-ssr',
  'build',
  'emsdk',
  'coverage',
  'test-results',
  'playwright-report',
  '.pnpm-store',
  '.cache',
  '__pycache__',
]);

/**
 * Every file permitted to live directly at the repo root. Anything not here
 * (and not in ALLOWED_ROOT_DIRS below) fails the gate. Scratch output from an
 * agent session — screenshots, captured logs, one-shot patch scripts — never
 * belongs here; see AGENTS.md's "Root hygiene" pitfall for where it goes
 * instead.
 */
const ALLOWED_ROOT_FILES = new Set([
  // VCS / editor plumbing
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  // Canonical docs
  'README.md',
  'AGENTS.md',
  'DOCS.md',
  'CHANGELOG.md',
  'claude.md',
  'CLAUDE.md',
  // Agent swarm state — actively read/written by the weekly agent workflow
  // (see docs/weekly_plan.md), not a scratch file.
  '.swarm-state.md',
  // Package manager / workspace
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  // Build & language config
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tsconfig.eslint.json',
  'vite.config.ts',
  'eslint.config.js',
  'eslint-baseline.json',
  'postcss.config.js',
  'tailwind.config.js',
  'playwright.config.ts',
  // Vitest tiers
  'vitest.shared.ts',
  'vitest.unit.config.ts',
  'vitest.setup.ts',
  'vitest.setup.unit.ts',
  'vitest.integration.config.ts',
  'vitest.integration.files.ts',
  'vitest.setup.integration.ts',
  'vitest.perf.config.ts',
  'vitest.setup.perf.ts',
  // App entry
  'index.html',
  'metadata.json',
  // Deploy / release budget
  'deploy.py',
  'dist-budget.json',
  // Documented one-off setup/rebuild helpers — referenced by name from
  // README.md / docs/tts/TTS_DEPLOYMENT.md / docs/audio-engine/OPEN303_STACK_OVERFLOW_FIX.md.
  // Not "one-shot agent scratch": these are maintained, linked-to tools.
  'download_models.sh',
  'download_models.ps1',
  'rebuild_open303.sh',
  // Standalone SVG demo referenced by README.md and the `demo` npm script.
  'svg-demo.html',
]);

/**
 * Every directory permitted to live directly at the repo root. Anything not
 * here fails the gate — this catches future stray output directories
 * (`test-results/`, a leftover `videos/`, `playwright-report/`, …) the same
 * way ALLOWED_ROOT_FILES catches stray files.
 */
const ALLOWED_ROOT_DIRS = new Set([
  '.github', // CI workflows
  '.husky', // git hooks
  '.jules',
  '.Jules', // agent memory/state (see docs/weekly_plan.md)
  // The Four Worlds + the tools that build them
  'assembly',
  'rust-audio',
  'emscripten',
  'jc303_wasm',
  'rubberband',
  // App source, tests, docs, scripts
  'src',
  'public',
  'scripts',
  'tools',
  'docs',
  'tests',
  'test-fixtures',
  'ui-assets',
  // Sibling projects documented in AGENTS.md
  'Supertonic-Voice-Mixer',
  'web',
]);

const errors = [];

function checkRootEntries() {
  const entries = readdirSync(ROOT, { withFileTypes: true });
  for (const entry of entries) {
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && safeIsDirectory(join(ROOT, entry.name)));
    if (isDir) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      if (!ALLOWED_ROOT_DIRS.has(entry.name)) {
        errors.push(
          `Unexpected root directory: ${entry.name}/ (not in ALLOWED_ROOT_DIRS in scripts/check-root.mjs — move it under an existing directory, or add it with a stated reason)`,
        );
      }
      continue;
    }
    if (!ALLOWED_ROOT_FILES.has(entry.name)) {
      errors.push(
        `Unexpected root file: ${entry.name} (not in ALLOWED_ROOT_FILES in scripts/check-root.mjs — delete it, move it under scripts/ or tools/, or add it with a stated reason)`,
      );
    }
  }
}

function safeIsDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Walk the tree once, collecting merge artifacts. */
function collectMergeArtifacts(dir, found) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // unreadable directory is not a hygiene failure
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      collectMergeArtifacts(full, found);
      continue;
    }
    // Symlinks are reported as neither file nor directory by some platforms;
    // stat them so a linked-in artifact still counts.
    const isFile = entry.isFile() || (entry.isSymbolicLink() && safeIsFile(full));
    if (isFile && MERGE_ARTIFACT_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      found.push(full.slice(ROOT.length + 1));
    }
  }
  return found;
}

function safeIsFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function checkMergeArtifacts() {
  for (const relative of collectMergeArtifacts(ROOT, [])) {
    errors.push(`Merge artifact left in tree: ${relative} (delete it; *.orig / *.rej are banned)`);
  }
}

function checkDocsLinks() {
  const docsPath = join(ROOT, 'DOCS.md');
  if (!existsSync(docsPath)) {
    errors.push('DOCS.md is missing from repository root');
    return;
  }

  const content = readFileSync(docsPath, 'utf8');
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;

  while ((match = linkPattern.exec(content)) !== null) {
    const target = match[1].trim();
    if (!target || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) {
      continue;
    }

    const resolved = resolve(ROOT, target.split('#')[0]);
    if (!existsSync(resolved)) {
      errors.push(`DOCS.md broken link: (${target}) → ${resolved}`);
    }
  }
}

checkRootEntries();
checkMergeArtifacts();
checkDocsLinks();

if (errors.length > 0) {
  console.error('check:root failed:\n');
  for (const message of errors) {
    console.error(`  • ${message}`);
  }
  process.exit(1);
}

console.log('check:root OK');
