import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- scripts/*.mjs has no project-referenced types
import { buildNativeManifest, validateNativeManifest } from '../../scripts/write-native-manifest.mjs';
// @ts-expect-error -- scripts/*.mjs has no project-referenced types
import { defaultRepoRoot } from '../../scripts/native-worlds.mjs';

const REPO_ROOT = defaultRepoRoot();
const schemaPath = join(REPO_ROOT, 'docs/schemas/native-artifacts.schema.json');

const REQUIRED_WHEN_PRESENT = [
  'hyphon_native.wasm',
  'hyphon_native.js',
  'hyphon_native.worker.js',
  'hyphon_wasm_export_map.json',
  'oscillators.wasm',
  'fft.wasm',
  'trackFreezer.wasm',
  'audioExport.wasm',
  'xmExport.wasm',
];

describe('native-artifacts manifest', () => {
  it('ships a checked-in schema', () => {
    expect(existsSync(schemaPath)).toBe(true);
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { required: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'toolchains',
        'exportContract',
        'artifacts',
      ]),
    );
  });

  it('builds a schema-valid manifest from whatever artifacts exist', () => {
    const manifest = buildNativeManifest({ repoRoot: REPO_ROOT, profile: 'release' });
    expect(validateNativeManifest(manifest)).toEqual([]);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.exportContract.mapPath).toBe('public/hyphon_wasm_export_map.json');
    const ids = new Set(manifest.artifacts.map((a: { id: string }) => a.id));
    for (const id of REQUIRED_WHEN_PRESENT) {
      const onDisk = manifest.artifacts.find((a: { id: string }) => a.id === id);
      if (onDisk) {
        expect(ids.has(id)).toBe(true);
        expect(onDisk.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(onDisk.bytes).toBeGreaterThan(0);
      }
    }
  });

  it('records hyphon_native memory from the budget, not ad-hoc numbers', () => {
    const budget = JSON.parse(
      readFileSync(join(REPO_ROOT, 'emscripten/wasm_memory_budget.json'), 'utf8'),
    ) as { hyphonNative: { initialMemoryMb: number; maximumMemoryMb: number; stackSizeMb: number } };
    const manifest = buildNativeManifest({ repoRoot: REPO_ROOT, profile: 'release' });
    const native = manifest.artifacts.find((a: { id: string }) => a.id === 'hyphon_native.wasm');
    if (!native) return;
    expect(native.memory).toMatchObject({
      initialMb: budget.hyphonNative.initialMemoryMb,
      maximumMb: budget.hyphonNative.maximumMemoryMb,
      stackMb: budget.hyphonNative.stackSizeMb,
    });
    expect(native.requiresCoopCoep).toBe(true);
    expect(native.threaded).toBe(true);
  });

  it('rejects a manifest missing artifacts', () => {
    const errors = validateNativeManifest({ schemaVersion: 1, exportContract: {} });
    expect(errors.some((e: string) => e.includes('artifacts'))).toBe(true);
  });
});
