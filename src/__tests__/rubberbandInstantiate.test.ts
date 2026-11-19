/**
 * public/rubberband.wasm has no Emscripten glue (#1596 follow-up P3): the worklets
 * instantiate it with src/audio-worklets/rubberband/instantiate.ts. The import
 * object there must be exactly the manifest's `rubberband.imports`, which
 * tools/check_rubberband_module.mjs holds the linked wasm to — so a new import
 * fails the build, not the AudioWorklet.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RubberBandAbort, createRubberBandImports } from '../audio-worklets/rubberband/instantiate';

const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../emscripten/wasm_export_manifest.json'), 'utf8'),
) as { rubberband: { imports: Record<string, string[]>; runtime: string[] } };

function harness() {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const out: string[] = [];
  const err: string[] = [];
  const imports = createRubberBandImports(() => memory, { out: (l) => out.push(l), err: (l) => err.push(l) });
  const heap = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const cstr = (ptr: number, s: string) => {
    for (let i = 0; i < s.length; i++) heap[ptr + i] = s.charCodeAt(i);
    heap[ptr + s.length] = 0;
  };
  return { imports, heap, dv, out, err, cstr };
}

describe('rubberband/instantiate import object', () => {
  it('implements exactly the manifest rubberband.imports', () => {
    const { imports } = harness();
    const actual = Object.fromEntries(
      Object.entries(imports).map(([mod, bag]) => [mod, Object.keys(bag).sort()]),
    );
    const expected = Object.fromEntries(
      Object.entries(manifest.rubberband.imports).map(([mod, names]) => [mod, [...names].sort()]),
    );
    expect(actual).toEqual(expected);
  });

  it('refuses to grow the fixed heap', () => {
    const { imports } = harness();
    expect((imports.env.emscripten_resize_heap as (n: number) => number)(1 << 30)).toBe(0);
  });

  it('turns abort, exit and a failed assert into a thrown RubberBandAbort', () => {
    const { imports, cstr } = harness();
    expect(() => (imports.env._abort_js as () => void)()).toThrow(RubberBandAbort);
    expect(() => (imports.wasi_snapshot_preview1.proc_exit as (c: number) => void)(3)).toThrow(/exit\(3\)/);
    cstr(100, 'x > 0');
    cstr(200, 'R3Stretcher.cpp');
    cstr(300, 'process');
    expect(() => (imports.env.__assert_fail as (...a: number[]) => void)(100, 200, 42, 300))
      .toThrow('Assertion failed: x > 0, at R3Stretcher.cpp:42 process');
  });

  it('fd_write line-buffers stdout / stderr and reports the bytes written', () => {
    const { imports, dv, out, err, cstr } = harness();
    const fdWrite = imports.wasi_snapshot_preview1.fd_write as (...a: number[]) => number;
    cstr(1000, 'Rubber');
    cstr(1100, 'Band: warn\npartial');
    dv.setUint32(64, 1000, true); dv.setUint32(68, 6, true);
    dv.setUint32(72, 1100, true); dv.setUint32(76, 18, true);
    expect(fdWrite(2, 64, 2, 128)).toBe(0);
    expect(dv.getUint32(128, true)).toBe(24);
    expect(err).toEqual(['RubberBand: warn']);
    expect(out).toEqual([]);
    expect(fdWrite(5, 64, 1, 128)).toBe(8); // EBADF
  });

  it('clock_time_get writes nanoseconds for realtime and monotonic clocks', () => {
    const { imports, dv } = harness();
    const clock = imports.wasi_snapshot_preview1.clock_time_get as (id: number, p: bigint, ptr: number) => number;
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    expect(clock(0, 0n, 8)).toBe(0);
    expect(dv.getBigUint64(8, true)).toBe(1_234_000_000n);
    expect(clock(1, 0n, 8)).toBe(0);
    expect(clock(9, 0n, 8)).toBe(28);
    vi.restoreAllMocks();
  });
});
