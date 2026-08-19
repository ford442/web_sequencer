import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PTHREAD_WORKER_STAMP_BANNER, ensurePthreadWorkerStamp } from '../../scripts/ensure-pthread-worker-stamp.mjs';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'hyphon-pthread-worker-'));
}

describe('ensurePthreadWorkerStamp', () => {
  it('copies a real Emscripten 3.1-style worker.js when present', () => {
    const root = tempDir();
    const srcDir = join(root, 'build');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'jc303.worker.js'), '/* real pthread worker */\n');
    const dest = join(root, 'public', 'jc303-threaded.worker.js');
    const result = ensurePthreadWorkerStamp({ srcDir, stem: 'jc303', dest });
    expect(result.action).toBe('copied');
    expect(readFileSync(dest, 'utf8')).toBe('/* real pthread worker */\n');
  });

  it('copies .worker.mjs when that is what the toolchain emitted', () => {
    const root = tempDir();
    const srcDir = join(root, 'build');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'hyphon_native.worker.mjs'), 'export {}\n');
    const dest = join(root, 'public', 'hyphon_native.worker.js');
    const result = ensurePthreadWorkerStamp({ srcDir, stem: 'hyphon_native', dest });
    expect(result.action).toBe('copied');
    expect(readFileSync(dest, 'utf8')).toBe('export {}\n');
  });

  it('writes a stamp stub when Emscripten 6 inlines the worker (no file)', () => {
    const root = tempDir();
    const srcDir = join(root, 'build');
    mkdirSync(srcDir);
    const dest = join(root, 'public', 'jc303-threaded.worker.js');
    const result = ensurePthreadWorkerStamp({ srcDir, stem: 'jc303', dest });
    expect(result.action).toBe('stubbed');
    expect(result.source).toBeNull();
    const body = readFileSync(dest, 'utf8');
    expect(body).toBe(PTHREAD_WORKER_STAMP_BANNER);
    expect(body).toContain('inlines pthread workers');
  });
});

describe('jc303 / emcc build scripts wire the stamp helper', () => {
  const repoRoot = join(__dirname, '../..');

  it('build_jc303_omp.sh invokes the helper for the threaded variant', () => {
    const sh = readFileSync(join(repoRoot, 'tools/build_jc303_omp.sh'), 'utf8');
    expect(sh).toContain('scripts/ensure-pthread-worker-stamp.mjs');
    expect(sh).toContain('--stem jc303');
    expect(sh).not.toMatch(/cp -f jc303\.worker\.js .*2>\/dev\/null \|\| true/);
  });

  it('emscripten/build.sh invokes the helper after a successful link', () => {
    const sh = readFileSync(join(repoRoot, 'emscripten/build.sh'), 'utf8');
    expect(sh).toContain('scripts/ensure-pthread-worker-stamp.mjs');
    expect(sh).toContain('--stem hyphon_native');
  });
});
