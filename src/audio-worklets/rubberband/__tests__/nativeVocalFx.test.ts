import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  NativeVocalFx,
  RB_FX_ABI_VERSION,
  RB_FX_PARAM,
  RB_FX_PARAM_COUNT,
  RB_FX_REQUIRED_EXPORTS,
  probeNativeVocalFx,
} from '../nativeVocalFx';
import { createVocalFxBlock } from '../vocalFx';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const header = read('emscripten/rubberband_fx.h');
const buildSh = read('emscripten/build_rubberband.sh');

/** A module shaped like createRubberBandModule() output, with rb_fx stubs. */
function fakeFxModule(overrides: Record<string, unknown> = {}) {
  const memory = new ArrayBuffer(1 << 16);
  const module: Record<string, unknown> = {
    HEAPF32: new Float32Array(memory),
    HEAPF64: new Float64Array(memory),
  };
  for (const name of RB_FX_REQUIRED_EXPORTS) module[name] = vi.fn(() => 0);
  Object.assign(module, {
    _rb_fx_abi_version: () => RB_FX_ABI_VERSION,
    _rb_fx_param_count: () => RB_FX_PARAM_COUNT,
    _rb_fx_create: () => 8,
    _rb_fx_params: () => 1024,
    _rb_fx_channel: (_h: number, ch: number) => 4096 + ch * 1024,
    ...overrides,
  });
  return module;
}

describe('rb_fx ABI stays in step with the C++ header', () => {
  it('RB_FX_PARAM mirrors enum RbFxParam order and count', () => {
    const body = header.slice(header.indexOf('enum RbFxParam {'), header.indexOf('RB_FX_PARAM_COUNT\n'));
    const names = [...body.matchAll(/^\s*RB_FX_([A-Z0-9_]+)(?:\s*=\s*0)?,/gm)].map((m) => m[1]);
    expect(names).toEqual(Object.keys(RB_FX_PARAM));
    expect(Object.values(RB_FX_PARAM)).toEqual(names.map((_, i) => i));
    expect(RB_FX_PARAM_COUNT).toBe(names.length);
  });

  it('RB_FX_ABI_VERSION matches the header', () => {
    expect(header).toContain(`#define RB_FX_ABI_VERSION ${RB_FX_ABI_VERSION}`);
  });

  it('build_rubberband.sh exports exactly the functions the worklet probes for', () => {
    const list = buildSh.match(/RB_FX_EXPORTS=\(([^)]*)\)/);
    expect(list).not.toBeNull();
    const exported = list![1].trim().split(/\s+/).map((fn) => `_${fn}`);
    expect(exported.sort()).toEqual([...RB_FX_REQUIRED_EXPORTS].sort());
    for (const name of RB_FX_REQUIRED_EXPORTS) {
      expect(header).toContain(`${name.slice(1)}(`);
    }
  });
});

describe('build_rubberband.sh keeps the worklet loadable', () => {
  it('compiles the FX chain into the Rubber Band module (not hyphon_native)', () => {
    expect(buildSh).toContain('"$SCRIPT_DIR/rubberband_fx.cpp"');
    expect(read('emscripten/build.sh')).not.toContain('rubberband_fx');
  });

  it('keeps -msimd128 and -DNO_THREADING', () => {
    expect(buildSh).toMatch(/^\s*-msimd128 \\$/m);
    expect(buildSh).toMatch(/^\s*-DNO_THREADING \\$/m);
  });

  it('accepts Module.wasmBinary (worklets cannot fetch; emcc 4+ drops it by default)', () => {
    const api = buildSh.match(/INCOMING_MODULE_JS_API='([^']*)'/);
    expect(api).not.toBeNull();
    expect(JSON.parse(api![1])).toEqual(expect.arrayContaining(['wasmBinary', 'locateFile']));
  });

  it('exposes the heap views the worklet and NativeVocalFx read', () => {
    const methods = buildSh.match(/EXPORTED_RUNTIME_METHODS='([^']*)'/);
    expect(methods).not.toBeNull();
    expect(JSON.parse(methods![1])).toEqual(expect.arrayContaining(['HEAPF32', 'HEAPF64']));
  });

  it('native-worlds rebuilds the rubberband world when the FX sources change', async () => {
    // @ts-expect-error - plain .mjs build script
    const { defineWorlds } = await import('../../../../scripts/native-worlds.mjs');
    const worlds = defineWorlds(process.cwd()) as Array<{ id: string; inputs: Array<{ name: string }> }>;
    const paths = (id: string) => worlds.find((w) => w.id === id)!.inputs.map((i) => i.name);
    expect(paths('rubberband')).toEqual(expect.arrayContaining(['emscripten/rubberband_fx.cpp', 'emscripten/rubberband_fx.h']));
    expect(paths('emcc')).not.toContain('emscripten/rubberband_fx.cpp');
  });
});

describe('probeNativeVocalFx', () => {
  it('accepts a module with every export and a matching ABI', () => {
    expect(probeNativeVocalFx(fakeFxModule())).toMatchObject({ ok: true });
  });

  it('names a stale build when no rb_fx exports exist', () => {
    const probe = probeNativeVocalFx({ HEAPF32: new Float32Array(4), _malloc: () => 0 });
    expect(probe).toEqual({ ok: false, reason: expect.stringContaining('pnpm run build:wasm:rubberband') });
  });

  it('lists partially missing exports', () => {
    const probe = probeNativeVocalFx(fakeFxModule({ _rb_fx_process: undefined }));
    expect(probe).toEqual({ ok: false, reason: expect.stringContaining('_rb_fx_process') });
  });

  it('rejects an ABI or param-count mismatch', () => {
    expect(probeNativeVocalFx(fakeFxModule({ _rb_fx_abi_version: () => 99 }))).toEqual({
      ok: false, reason: expect.stringContaining('ABI 99'),
    });
    expect(probeNativeVocalFx(fakeFxModule({ _rb_fx_param_count: () => 3 }))).toEqual({
      ok: false, reason: expect.stringContaining('param count 3'),
    });
  });

  it('rejects glue without heap views', () => {
    expect(probeNativeVocalFx(fakeFxModule({ HEAPF64: undefined }))).toMatchObject({ ok: false });
    expect(probeNativeVocalFx(null)).toMatchObject({ ok: false });
  });
});

describe('NativeVocalFx', () => {
  it('writes every block field into the double param block at its ABI index', () => {
    const module = fakeFxModule();
    const probe = probeNativeVocalFx(module);
    if (!probe.ok) throw new Error(probe.reason);
    const fx = new NativeVocalFx(probe.module, 48000);

    const block = createVocalFxBlock();
    let v = 0.25;
    for (const key of Object.keys(block) as Array<keyof typeof block>) {
      if (key === 'hasPhonemeContext') block.hasPhonemeContext = true;
      else (block[key] as number) = (v += 1.0625);
    }
    fx.process(block, new Float32Array(128), new Float32Array(128));

    const params = (module.HEAPF64 as Float64Array).subarray(1024 >> 3, (1024 >> 3) + RB_FX_PARAM_COUNT);
    expect(params[RB_FX_PARAM.HAS_PHONEME_CONTEXT]).toBe(1);
    const camel = (k: string) => k.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const [name, index] of Object.entries(RB_FX_PARAM)) {
      if (name === 'HAS_PHONEME_CONTEXT') continue;
      expect(params[index], name).toBe(block[camel(name) as keyof typeof block]);
    }
    expect(module._rb_fx_process).toHaveBeenCalledWith(8, 4096, 5120, 128);
  });

  it('throws (so the worklet can fall back) when rb_fx_create fails', () => {
    const probe = probeNativeVocalFx(fakeFxModule({ _rb_fx_create: () => 0 }));
    if (!probe.ok) throw new Error(probe.reason);
    expect(() => new NativeVocalFx(probe.module, 48000)).toThrow(/rb_fx_create/);
  });
});
