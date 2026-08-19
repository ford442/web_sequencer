import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- scripts/*.mjs has no project-referenced types
import { defaultRepoRoot, defineWorlds, evaluateWorld, formatPreflightReport, hashInputs, unclaimedNativeSources } from '../../scripts/native-worlds.mjs';

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hyphon-native-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'in.c'), 'int x;\n');
  return root;
}

describe('native preflight', () => {
  it('reports the exact rebuild command when an output is missing', () => {
    const root = fixtureRoot();
    const world = {
      id: 'emcc',
      rebuildCommand: 'pnpm run build:emcc',
      inputs: [{ kind: 'file' as const, name: 'in.c' }],
      outputs: ['public/hyphon_native.wasm'],
    };
    const result = evaluateWorld(root, world, { inputHash: hashInputs(root, world.inputs) });
    expect(result.status).toBe('missing');
    expect(result.rebuildCommand).toBe('pnpm run build:emcc');
    expect(result.missingOutputs).toContain('public/hyphon_native.wasm');
    const report = formatPreflightReport([result]);
    expect(report).toContain('rebuild: pnpm run build:emcc');
    expect(report).toContain('missing: emcc');
  });

  it('reports stale when an input byte changes', () => {
    const root = fixtureRoot();
    writeFileSync(join(root, 'out.wasm'), 'wasm');
    const world = {
      id: 'rust',
      rebuildCommand: 'pnpm run build:wasm:rust',
      inputs: [{ kind: 'file' as const, name: 'in.c' }],
      outputs: ['out.wasm'],
    };
    const first = hashInputs(root, world.inputs);
    writeFileSync(join(root, 'in.c'), 'int y;\n');
    const result = evaluateWorld(root, world, { inputHash: first });
    expect(result.status).toBe('stale');
    expect(result.rebuildCommand).toBe('pnpm run build:wasm:rust');
    expect(formatPreflightReport([result])).toContain('rebuild: pnpm run build:wasm:rust');
  });

  it('passes when hashes match and outputs exist', () => {
    const root = fixtureRoot();
    writeFileSync(join(root, 'out.wasm'), 'wasm');
    const world = {
      id: 'as-fft',
      rebuildCommand: 'pnpm run build:wasm:fft',
      inputs: [{ kind: 'file' as const, name: 'in.c' }],
      outputs: ['out.wasm'],
    };
    const hash = hashInputs(root, world.inputs);
    const result = evaluateWorld(root, world, { inputHash: hash });
    expect(result.status).toBe('ok');
    expect(formatPreflightReport([result])).toContain('[check:native] OK');
  });

  it('claims every AssemblyScript source and emscripten build input', () => {
    const missing = unclaimedNativeSources(defaultRepoRoot(), defineWorlds(defaultRepoRoot()));
    expect(missing).toEqual([]);
  });

  it('root package scripts invoke pnpm, not npm', () => {
    const pkg = JSON.parse(readFileSync(join(defaultRepoRoot(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(cmd, name).not.toMatch(/\bnpm run\b/);
    }
  });

  it('maps C++ / Rust / AS worlds to targeted commands', () => {
    const worlds = defineWorlds(defaultRepoRoot());
    const byId = Object.fromEntries(
      worlds.map((w: { id: string; rebuildCommand: string }) => [w.id, w.rebuildCommand]),
    );
    expect(byId.emcc).toBe('pnpm run build:emcc');
    expect(byId.rust).toBe('pnpm run build:wasm:rust');
    expect(byId.jc303).toBe('pnpm run build:wasm:jc303');
    expect(byId['as-oscillators']).toBe('pnpm run build:wasm:oscillators');
  });

  it('jc303 world still stamps the historical pthread worker path', () => {
    const worlds = defineWorlds(defaultRepoRoot());
    const jc303 = worlds.find((w: { id: string }) => w.id === 'jc303');
    expect(jc303).toBeDefined();
    expect(jc303!.outputs).toContain('public/jc303-threaded.worker.js');
    expect(jc303!.inputs.some((i: { name: string }) => i.name === 'scripts/ensure-pthread-worker-stamp.mjs')).toBe(
      true,
    );
  });
});
