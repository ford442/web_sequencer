/**
 * Phase B: the SDK is pinned in package.json, so `loadOfficialWamSdk()` has to
 * actually work — in Phase A it could not, and always fell into its catch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOfficialWamSdk, resetOfficialWamSdkCache } from '../sdk/loadOfficialSdk';
import { OFFICIAL_WAM_SDK_PACKAGE, OFFICIAL_WAM_SDK_VERSION } from '../types';

const REPO_ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

afterEach(() => {
  resetOfficialWamSdkCache();
  delete (globalThis as Record<string, unknown>).AudioWorkletNode;
});

describe('official WAM2 SDK pin', () => {
  it('is pinned exactly, and as a devDependency', () => {
    // A devDependency, not a runtime dependency: it must never be reachable from
    // the main entry, and this repo cannot be built without devDeps anyway.
    expect(pkg.devDependencies?.[OFFICIAL_WAM_SDK_PACKAGE]).toBe(OFFICIAL_WAM_SDK_VERSION);
    expect(pkg.dependencies?.[OFFICIAL_WAM_SDK_PACKAGE]).toBeUndefined();
  });

  it('is present in the lockfile at the pinned version', () => {
    const lock = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    expect(lock).toContain(`${OFFICIAL_WAM_SDK_PACKAGE}@${OFFICIAL_WAM_SDK_VERSION}`);
  });

  it('explains itself instead of throwing where AudioWorkletNode is undefined', async () => {
    // The SDK evaluates `class WamNode extends AudioWorkletNode` at module scope,
    // so importing it anywhere that global is missing is a ReferenceError. Node,
    // jsdom and worklet scopes all qualify.
    expect(typeof (globalThis as Record<string, unknown>).AudioWorkletNode).toBe('undefined');
    const load = await loadOfficialWamSdk();
    expect(load.module).toBeNull();
    expect(load.unavailableReason).toMatch(/AudioWorkletNode is undefined/);
    expect(load.version).toBe(OFFICIAL_WAM_SDK_VERSION);
  });

  it('really resolves the package once that global exists', async () => {
    // The Phase A loader could never reach this: a bare specifier behind
    // @vite-ignore is unresolvable at runtime, so the import always threw.
    (globalThis as Record<string, unknown>).AudioWorkletNode = class {};
    const load = await loadOfficialWamSdk();
    expect(load.unavailableReason).toBeUndefined();
    expect(load.module).not.toBeNull();
    const mod = load.module as Record<string, unknown>;
    expect(typeof mod.WebAudioModule).toBe('function');
    expect(typeof mod.WamNode).toBe('function');
    expect(typeof mod.addFunctionModule).toBe('function');
  });

  it('memoizes a successful load', async () => {
    (globalThis as Record<string, unknown>).AudioWorkletNode = class {};
    const a = await loadOfficialWamSdk();
    const b = await loadOfficialWamSdk();
    expect(a).toBe(b);
  });
});
