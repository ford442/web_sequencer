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
      id: 'as-fft',
      rebuildCommand: 'pnpm run build:wasm:fft',
      inputs: [{ kind: 'file' as const, name: 'in.c' }],
      outputs: ['out.wasm'],
    };
    const first = hashInputs(root, world.inputs);
    writeFileSync(join(root, 'in.c'), 'int y;\n');
    const result = evaluateWorld(root, world, { inputHash: first });
    expect(result.status).toBe('stale');
    expect(result.rebuildCommand).toBe('pnpm run build:wasm:fft');
    expect(formatPreflightReport([result])).toContain('rebuild: pnpm run build:wasm:fft');
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

  it('maps C++ / AS worlds to targeted commands', () => {
    const worlds = defineWorlds(defaultRepoRoot());
    const byId = Object.fromEntries(
      worlds.map((w: { id: string; rebuildCommand: string }) => [w.id, w.rebuildCommand]),
    );
    expect(byId.emcc).toBe('pnpm run build:emcc');
    // The standalone public/jc303* world is retired: JC303 runs inside hyphon_native.
    expect(byId.jc303).toBeUndefined();
    expect(byId['as-oscillators']).toBe('pnpm run build:wasm:oscillators');
    // rust-audio/ is the rust-* oscillator family again (#1664): its own world,
    // rebuilt by its own command, so a kernel edit never re-links hyphon_native.
    expect(byId['rust-osc']).toBe('pnpm run build:wasm:rust');
    expect(byId.rust).toBeUndefined();
    // cpp-* (#1665) is a standalone em++ module with its own world, not part of
    // hyphon_native: a kernel edit rebuilds public/cpp_osc.wasm only.
    expect(byId['cpp-osc']).toBe('pnpm run build:wasm:cpp');
    // dwgs-* (#1666) is its own no_std crate (dwgs-audio/) and its own world.
    expect(byId['dwgs-osc']).toBe('pnpm run build:wasm:dwgs');
  });

  type World = { id: string; outputs: string[]; inputs: { name: string }[] };

  it('expects no *.worker.js: the pinned emcc inlines pthread workers', () => {
    const worlds = defineWorlds(defaultRepoRoot()) as World[];
    const outputs = worlds.flatMap((w) => w.outputs);
    expect(outputs.filter((o) => o.endsWith('.worker.js'))).toEqual([]);
  });

  it('rebuilds every em++ world when the Emscripten pin moves', () => {
    const worlds = defineWorlds(defaultRepoRoot()) as World[];
    for (const id of ['emcc', 'rubberband', 'mixbus', 'cpp-osc']) {
      const world = worlds.find((w) => w.id === id);
      expect(world, id).toBeDefined();
      expect(world!.inputs.map((i) => i.name), id).toContain('emscripten/toolchain.json');
    }
    // The cpp-* kernel (#1665) is owned by its own world, never hyphon_native's.
    const inputsOf = (id: string) => worlds.find((w) => w.id === id)?.inputs.map((i) => i.name) ?? [];
    for (const owned of ['emscripten/cpp_osc.cpp', 'emscripten/build_cpp_osc.sh']) {
      expect(inputsOf('emcc'), owned).not.toContain(owned);
      expect(inputsOf('cpp-osc'), owned).toContain(owned);
    }
  });
});
