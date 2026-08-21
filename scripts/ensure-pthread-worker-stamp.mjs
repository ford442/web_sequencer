#!/usr/bin/env node
/**
 * Copy an Emscripten pthread worker if the toolchain still emits one.
 * Otherwise write a small stamp file so native-world output checks stay green.
 *
 * Emscripten 3.1.51 (CI) writes `NAME.worker.js`. From 3.1.58 workers are
 * inlined into the main JS; 6.x no longer emits a separate worker at all
 * (emscripten#21701, #22598). `check:native` still lists the historical path.
 *
 * Usage:
 *   node scripts/ensure-pthread-worker-stamp.mjs --src-dir <dir> --stem jc303 --dest <path>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PTHREAD_WORKER_STAMP_BANNER =
  '// Hyphon native-world stamp: Emscripten >= 3.1.58 inlines pthread workers into the main JS.\n' +
  '// Emscripten 6.x does not emit a separate .worker.js (PR 21701 / 22598).\n' +
  '// Do not load this file at runtime — the glue in the companion .js module boots workers itself.\n';

export function parseEnsureWorkerArgs(argv) {
  const args = { srcDir: null, stem: null, dest: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--src-dir' && next) {
      args.srcDir = next;
      i += 1;
    } else if (a === '--stem' && next) {
      args.stem = next;
      i += 1;
    } else if (a === '--dest' && next) {
      args.dest = next;
      i += 1;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

/**
 * @returns {{ action: 'copied' | 'stubbed', dest: string, source: string | null }}
 */
export function ensurePthreadWorkerStamp({ srcDir, stem, dest }) {
  if (!srcDir || !stem || !dest) {
    throw new Error('ensurePthreadWorkerStamp requires srcDir, stem, and dest');
  }
  const candidates = [`${stem}.worker.js`, `${stem}.worker.mjs`];
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (const name of candidates) {
    const source = path.join(srcDir, name);
    if (fs.existsSync(source) && fs.statSync(source).isFile()) {
      fs.copyFileSync(source, dest);
      return { action: 'copied', dest, source };
    }
  }
  fs.writeFileSync(dest, PTHREAD_WORKER_STAMP_BANNER);
  return { action: 'stubbed', dest, source: null };
}

export function runEnsurePthreadWorkerCli(argv) {
  const args = parseEnsureWorkerArgs(argv);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/ensure-pthread-worker-stamp.mjs --src-dir DIR --stem NAME --dest PATH\n',
    );
    return 0;
  }
  const result = ensurePthreadWorkerStamp(args);
  if (result.action === 'copied') {
    process.stdout.write(`[pthread-worker] copied ${result.source} -> ${result.dest}\n`);
  } else {
    process.stdout.write(
      `[pthread-worker] no ${args.stem}.worker.js from this Emscripten; wrote stamp stub ${result.dest}\n`,
    );
  }
  return 0;
}

const invokedAsScript =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  try {
    process.exit(runEnsurePthreadWorkerCli(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
}
