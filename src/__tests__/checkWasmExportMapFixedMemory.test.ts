/**
 * tools/check_wasm_export_map.mjs --wasm re-checks that the voice binary's memory
 * is FIXED at its budget, and --require-artifacts turns an absent artifact into a
 * failure (#1596 follow-up). Runs the real CLI against synthetic modules, so it
 * needs no native build.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const TOOL = join(ROOT, 'tools/check_wasm_export_map.mjs');
const budget = JSON.parse(readFileSync(join(ROOT, 'emscripten/wasm_memory_budget.json'), 'utf8')) as {
  hyphonNative: { initialMemoryMb: number };
};

const leb = (n: number): number[] => {
  const out: number[] = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return out;
};

/** A module importing env.memory (flags 0x03 shared+max, 0x01 max) and exporting one function `f`. */
function moduleWithMemory(initial: number, maximum: number, shared: boolean): Uint8Array {
  const limits = [shared ? 0x03 : 0x01, ...leb(initial), ...leb(maximum)];
  const entry = [0x03, ...Buffer.from('env'), 0x06, ...Buffer.from('memory'), 0x02, ...limits];
  const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [0x01, 0x60, 0x00, 0x00]),
    ...section(2, [0x01, ...entry]),
    ...section(3, [0x01, 0x00]),
    ...section(7, [0x01, 0x01, 0x66, 0x00, 0x00]),
    ...section(10, [0x01, 0x02, 0x00, 0x0b]),
  ]);
}

function run(args: string[]) {
  return spawnSync(process.execPath, [TOOL, '--skip-modules', ...args], { encoding: 'utf8' });
}

describe('check_wasm_export_map --wasm: fixed voice memory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'export-map-'));
  const map = join(dir, 'map.json');
  writeFileSync(map, JSON.stringify({}));
  const pages = (budget.hyphonNative.initialMemoryMb * 1024 * 1024) / 65536;

  it('fails a voice binary whose maximum differs from its initial size', () => {
    const wasm = join(dir, 'grow.wasm');
    writeFileSync(wasm, moduleWithMemory(pages, pages * 32, true));
    const r = run(['--map', map, '--wasm', wasm]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/memory can grow/);
  });

  it('accepts no growth beyond the fixed budget size (it only reports the missing exports)', () => {
    const wasm = join(dir, 'fixed.wasm');
    writeFileSync(wasm, moduleWithMemory(pages, pages, true));
    const r = run(['--map', map, '--wasm', wasm]);
    expect(r.stderr).not.toMatch(/memory can grow|memory initial/);
  });

  it('--require-artifacts fails on a missing map instead of warning', () => {
    const missing = join(dir, 'absent.json');
    expect(run(['--map', missing]).status).toBe(0);
    const r = run(['--require-artifacts', '--map', missing]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not found \(--require-artifacts\)/);
  });
});
