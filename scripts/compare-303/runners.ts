/**
 * Node-side backends for the 303 voice comparison (#1543): the native C++
 * engines through a host g++ build of `event_render.cpp`, and the openrb-338
 * wasm read from `openrb338/pkg/`.
 *
 * Nothing here is part of the app bundle. A backend whose prerequisite is
 * missing is left out of the returned runners, and the harness reports its
 * voices unavailable with the reason.
 */

import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  instantiateOpenrb338,
  renderOpenrb338,
} from '../../src/audio/offline/compare303/openrb338Voice';
import { serializeScriptForNative, type Voice303Script } from '../../src/audio/offline/compare303/script';
import type { BackendRunners } from '../../src/audio/offline/compare303/voices';

const run = promisify(execFile);

export interface RunnerSetup {
  runners: BackendRunners;
  /** What was built / found and what was missing, for the report. */
  notes: string[];
}

function readF32(path: string): Float32Array {
  const bytes = readFileSync(path);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function fileHash(paths: readonly string[]): string {
  const hash = createHash('sha1');
  for (const p of paths) hash.update(readFileSync(p));
  return hash.digest('hex').slice(0, 12);
}

function hasCompiler(): boolean {
  return spawnSync('g++', ['--version'], { stdio: 'ignore' }).status === 0;
}

function sourcesIn(dir: string, ext: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => join(dir, f)) : [];
}

async function buildNative(root: string, cacheDir: string, engine: 'open303' | 'jc303'): Promise<string> {
  const em = join(root, 'emscripten');
  const harness = join(em, 'tests/port_baseline/event_render.cpp');
  const wrapper = join(em, engine === 'jc303' ? 'jc303_wrapper.cpp' : 'open303_wrapper.cpp');
  const dsp = join(root, 'jc303_wasm/src/dsp');
  const rosic = engine === 'jc303' ? sourcesIn(join(dsp, 'open303'), '.cpp') : [];
  if (engine === 'jc303' && rosic.length === 0) {
    throw new Error('jc303_wasm submodule is not checked out (git submodule update --init jc303_wasm)');
  }
  const headers = sourcesIn(join(em, 'core'), '.h');
  const key = fileHash([harness, wrapper, ...headers, ...rosic]);
  const out = join(cacheDir, `event_render_${engine}_${key}`);
  if (existsSync(out)) return out;

  mkdirSync(cacheDir, { recursive: true });
  const args = [
    '-std=c++17', '-O2', '-w',
    `-DEVENT_RENDER_${engine.toUpperCase()}`,
    '-I', join(em, 'tests/emscripten_stub'),
    '-I', em,
    ...(engine === 'jc303' ? ['-I', join(dsp, 'open303'), '-I', dsp] : []),
    harness,
    ...rosic,
    '-o', out,
  ];
  await run('g++', args, { maxBuffer: 16 * 1024 * 1024 });
  return out;
}

async function renderNative(bin: string, modelId: string, script: Voice303Script): Promise<Float32Array> {
  const dir = join(tmpdir(), `compare303-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const events = join(dir, 'events.txt');
  const out = join(dir, 'out.f32');
  writeFileSync(events, serializeScriptForNative(script));
  await run(bin, [modelId, events, out], { maxBuffer: 16 * 1024 * 1024 });
  const samples = readF32(out);
  if (samples.length !== script.totalFrames) {
    throw new Error(`native render returned ${samples.length} samples, expected ${script.totalFrames}`);
  }
  return samples;
}

export async function setupRunners(options: {
  root: string;
  cacheDir: string;
  openrbWasm: string;
  /** `ts` skips the native builds entirely. */
  native: boolean;
}): Promise<RunnerSetup> {
  const runners: BackendRunners = {};
  const notes: string[] = [];

  if (options.native) {
    if (!hasCompiler()) {
      notes.push('g++ not found: native open303 / jc303 backends skipped');
    } else {
      for (const engine of ['open303', 'jc303'] as const) {
        try {
          const bin = await buildNative(options.root, options.cacheDir, engine);
          if (engine === 'open303') runners.nativeOpen303 = (id, script) => renderNative(bin, id, script);
          else runners.nativeJc303 = (script) => renderNative(bin, 'jc303', script);
          notes.push(`native ${engine}: ${bin}`);
        } catch (err) {
          notes.push(`native ${engine} unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  if (existsSync(options.openrbWasm)) {
    try {
      const exports = await instantiateOpenrb338(readFileSync(options.openrbWasm));
      runners.openrb338 = (mode, script) => Promise.resolve(renderOpenrb338(exports, mode, script));
      notes.push(`openrb338: ${options.openrbWasm}`);
    } catch (err) {
      notes.push(`openrb338 unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    notes.push(`openrb338: ${options.openrbWasm} not found (pnpm run build:wasm:openrb338)`);
  }

  return { runners, notes };
}
