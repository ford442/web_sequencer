import { describe, expect, it, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `ort.env` is a process-wide singleton. Supertonic, HybridNeuralPipeline and
 * CtcForcedAligner each used to write it from their own init path, so the
 * consumer that happened to initialise first decided the wasm URL and thread
 * count for all three — an order-dependent global that nothing tested.
 *
 * These tests pin the invariant that replaced it: exactly one writer, and a
 * result that does not depend on which consumer got there first.
 */

const envState = () => ({
  wasmPaths: '',
  numThreads: 0,
  simd: false,
});

let wasmEnv = envState();

vi.mock('onnxruntime-web', () => ({
  get env() {
    return { wasm: wasmEnv };
  },
  Tensor: class {},
  InferenceSession: { create: vi.fn() },
}));

beforeEach(async () => {
  wasmEnv = envState();
  vi.resetModules();
});

describe('ortRuntime', () => {
  it('configures ort.env exactly once, no matter how many callers ask', async () => {
    const { loadOrt, __resetOrtRuntimeForTests } = await import('../ortRuntime');
    __resetOrtRuntimeForTests();

    await loadOrt();
    expect(wasmEnv.numThreads).toBeGreaterThanOrEqual(1);
    expect(wasmEnv.simd).toBe(true);

    // A later caller must not be able to move the global out from under the
    // consumer that already built sessions against it.
    wasmEnv.numThreads = 99;
    await loadOrt();
    expect(wasmEnv.numThreads).toBe(99);
  });

  it('memoises the module so concurrent callers share one import', async () => {
    const { loadOrt, __resetOrtRuntimeForTests } = await import('../ortRuntime');
    __resetOrtRuntimeForTests();

    const [a, b] = await Promise.all([loadOrt(), loadOrt()]);
    expect(a).toBe(b);
  });

  it('yields the same wasmPaths and numThreads in either consumer order', async () => {
    // Drive the two real consumer entry points in both orders and compare the
    // global they leave behind. This is the regression the single-writer design
    // exists to prevent.
    const orders: Array<[string, string]> = [
      ['../Supertonic', '@/engines/rubberband/alignment/ctcForcedAligner'],
      ['@/engines/rubberband/alignment/ctcForcedAligner', '../Supertonic'],
    ];

    const results: Array<{ simd: boolean; numThreads: number }> = [];

    for (const [first, second] of orders) {
      vi.resetModules();
      wasmEnv = envState();

      const { loadOrt, __resetOrtRuntimeForTests } = await import('../ortRuntime');
      __resetOrtRuntimeForTests();

      // Importing a consumer must not touch ort.env by itself — the module-scope
      // side effects that made this order-dependent are gone.
      await import(/* @vite-ignore */ first);
      await import(/* @vite-ignore */ second);
      expect(wasmEnv.numThreads).toBe(0);
      expect(wasmEnv.simd).toBe(false);

      await loadOrt();
      results.push({ simd: wasmEnv.simd, numThreads: wasmEnv.numThreads });
    }

    expect(results[0]).toEqual(results[1]);
  });

  it('never assigns wasmPaths, leaving Vite\'s self-hosted asset URL intact', async () => {
    // Vite rewrites ORT's own `new URL(...)` reference to a content-hashed
    // binary emitted from the same resolved package. Assigning wasmPaths would
    // override that with an unhashed, hand-built URL — which is how the
    // jsDelivr pin got there in the first place.
    const { loadOrt, __resetOrtRuntimeForTests } = await import('../ortRuntime');
    __resetOrtRuntimeForTests();

    await loadOrt();
    expect(wasmEnv.wasmPaths).toBe('');
  });
});

describe('ort.env has a single writer in the source tree', () => {
  /**
   * A source-level guard, because the runtime tests above can only observe the
   * writers that happen to run. This one fails the moment a new consumer adds
   * its own `ort.env.wasm.* = …` anywhere outside ortRuntime.ts.
   */
  it('assigns ort.env.wasm.* only from src/services/ortRuntime.ts', () => {
    const srcRoot = path.resolve(__dirname, '../..');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const rel = path.relative(srcRoot, full).split(path.sep).join('/');
          if (rel === 'services/ortRuntime.ts') continue;
          const src = fs.readFileSync(full, 'utf8');
          // Assignment to the ORT wasm env, e.g. `ort.env.wasm.numThreads = 4`.
          if (/\benv\s*\.\s*wasm\s*\.\s*(numThreads|simd|wasmPaths|proxy)\s*=/.test(src)) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(srcRoot);

    expect(
      offenders,
      'ort.env is a process-wide singleton: route new configuration through ' +
        'configureOrt() in src/services/ortRuntime.ts instead of writing it directly.',
    ).toEqual([]);
  });
});
