import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { logEngineFallback, loadHyphonWasmExportMap } = vi.hoisted(() => ({
  logEngineFallback: vi.fn(),
  loadHyphonWasmExportMap: vi.fn(),
}));

vi.mock('../../utils/engineTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/engineTelemetry')>();
  return { ...actual, logEngineFallback, loadHyphonWasmExportMap };
});

import { Open303Oscillator } from '../Open303Oscillator';
import { ProphecyOscillator } from '../ProphecyOscillator';
import {
  OPEN303_REQUIRED_WASM_EXPORTS,
  PROPHECY_REQUIRED_WASM_EXPORTS,
} from '../../audio-worklets/hyphonNativeImports';

/**
 * A deployed hyphon_native.wasm whose export names the map cannot resolve
 * (minified names + an empty map, or a module older than the worklets) used to
 * be posted to the worklet anyway: "missing exports" was logged, then the
 * engine sat out its 8000 ms init timeout before falling back. The main thread
 * already knows the worklet will refuse such a module, so it must fall back
 * without loading the worklet at all.
 */

/** Smallest valid module: one `() -> ()` function exported under every given name. */
function wasmExporting(names: readonly string[]): ArrayBuffer {
  const enc = new TextEncoder();
  const uleb = (n: number): number[] => {
    const out: number[] = [];
    do {
      let b = n & 0x7f;
      n >>>= 7;
      if (n) b |= 0x80;
      out.push(b);
    } while (n);
    return out;
  };
  const section = (id: number, body: number[]) => [id, ...uleb(body.length), ...body];
  const exports = names.flatMap((name) => {
    const bytes = [...enc.encode(name)];
    return [...uleb(bytes.length), ...bytes, 0x00, 0x00];
  });
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [0x01, 0x60, 0x00, 0x00]),
    ...section(3, [0x01, 0x00]),
    ...section(7, [...uleb(names.length), ...exports]),
    ...section(10, [0x01, 0x02, 0x00, 0x0b]),
  ]).buffer;
}

/** The stale deploy: emcc-minified export names, and an export map of `{}`. */
const MINIFIED = wasmExporting(['R', 'S', 'T', 'U', 'V']);

function makeContext(addModule: ReturnType<typeof vi.fn>): AudioContext {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  return {
    currentTime: 0,
    sampleRate: 48000,
    audioWorklet: { addModule },
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() })),
    createBiquadFilter: vi.fn(() => ({
      type: 'lowpass', frequency: param(), Q: param(), gain: param(),
      connect: vi.fn(), disconnect: vi.fn(),
    })),
    createOscillator: vi.fn(() => ({
      type: 'sawtooth', frequency: param(),
      start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
    })),
    destination: {},
  } as unknown as AudioContext;
}

function serveWasm(bytes: ArrayBuffer): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(bytes.slice(0), { status: 200 }))));
}

const fallbackReasons = () => logEngineFallback.mock.calls.map(([, , reason]) => String(reason));

describe('hyphon_native export mismatch fails fast', () => {
  beforeEach(() => {
    logEngineFallback.mockClear();
    loadHyphonWasmExportMap.mockReset();
    loadHyphonWasmExportMap.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Open303 falls back without loading the worklet when exports do not resolve', async () => {
    serveWasm(MINIFIED);
    const addModule = vi.fn(() => Promise.resolve());
    const osc = new Open303Oscillator();

    await expect(osc.init(makeContext(addModule), '/open303-processor.js')).resolves.toBe(true);

    expect(addModule).not.toHaveBeenCalled();
    expect(osc.isReady).toBe(true);
    expect(osc.isFallback).toBe(true);
    expect(fallbackReasons().some((r) => r.includes('open303_create'))).toBe(true);
  });

  it('Prophecy reports failure without loading the worklet when exports do not resolve', async () => {
    serveWasm(MINIFIED);
    const addModule = vi.fn(() => Promise.resolve());
    const osc = new ProphecyOscillator();

    await expect(osc.init(makeContext(addModule), '/prophecy-processor.js')).resolves.toBe(false);

    expect(addModule).not.toHaveBeenCalled();
    expect(fallbackReasons().some((r) => r.includes('prophecy_create'))).toBe(true);
  });

  it('an empty map still loads the worklet when the module keeps its export names', async () => {
    // Identity names (the -lexports.js build) need no map at all.
    serveWasm(wasmExporting([...OPEN303_REQUIRED_WASM_EXPORTS, ...PROPHECY_REQUIRED_WASM_EXPORTS]));

    const open303Load = vi.fn(() => Promise.reject(new Error('stop after the gate')));
    await new Open303Oscillator().init(makeContext(open303Load), '/open303-processor.js');
    expect(open303Load).toHaveBeenCalledTimes(1);

    const prophecyLoad = vi.fn(() => Promise.reject(new Error('stop after the gate')));
    await new ProphecyOscillator().init(makeContext(prophecyLoad), '/prophecy-processor.js');
    expect(prophecyLoad).toHaveBeenCalledTimes(1);
  });
});
