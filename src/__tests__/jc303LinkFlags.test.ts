import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- scripts/*.mjs has no project-referenced types
import { readWasmMemoryLimits } from '../../scripts/wasmMemoryLimits.mjs';

const REPO_ROOT = join(__dirname, '../..');
const WASM_PAGE_BYTES = 65536;
const wasmPath = join(REPO_ROOT, 'public/jc303-single.wasm');

const budget = JSON.parse(
  readFileSync(join(REPO_ROOT, 'emscripten/wasm_memory_budget.json'), 'utf8'),
) as {
  standaloneJc303: { initialMemoryMb: number; maximumMemoryMb: number };
};

describe('standalone JC-303 effective link settings', () => {
  it('public/jc303-single.wasm initial pages match the budget when the artifact exists', () => {
    if (!existsSync(wasmPath)) {
      return;
    }
    const limits = readWasmMemoryLimits(readFileSync(wasmPath));
    expect(limits, 'memory section or imported memory').toBeTruthy();
    const expectedInitial = (budget.standaloneJc303.initialMemoryMb * 1024 * 1024) / WASM_PAGE_BYTES;
    const expectedMax = (budget.standaloneJc303.maximumMemoryMb * 1024 * 1024) / WASM_PAGE_BYTES;
    expect(limits!.min).toBe(expectedInitial);
    // Pre-contract artifacts grow to the engine default (2 GiB / 32768 pages).
    // After tools/jc303_cmake is used, max must equal the budget.
    if (limits!.max != null && limits!.max !== 32768) {
      expect(limits!.max).toBe(expectedMax);
    }
  });

  it('fails in CI after a native JC-303 build if the artifact is absent', () => {
    if (process.env.CI === 'true' && process.env.HYPHON_REQUIRE_JC303_WASM === '1') {
      expect(existsSync(wasmPath), 'public/jc303-single.wasm missing after build:wasm:jc303').toBe(true);
    }
  });
});
