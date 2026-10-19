import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { resetHyphonNativeSessionForTests } from '../hyphonNativeSession';

/**
 * macro-processor on NativeVoiceProcessor: every message becomes a voice-core
 * event on the frame of its audioTime (notes carry velocity, the per-note
 * TIMBRE offset, slide and fine pitch in a0..a3), knob moves go through
 * macro_set_param_now, and each block copies the voice's planar stereo
 * buffer — left at the pointer, right one stride on — to the two outputs.
 */

const SAMPLE_RATE = 48000;
const BLOCK = 128;
const STRIDE = 4096;

class FakePort {
  onmessage: ((e: MessageEvent) => unknown) | null = null;
  readonly posted: Array<{ type: string; engineCount?: number; error?: string }> = [];
  postMessage(msg: { type: string }) {
    this.posted.push(msg);
  }
  addEventListener() {}
  removeEventListener() {}
  deliver(data: unknown) {
    return this.onmessage?.({ data } as MessageEvent);
  }
}

type Voice = {
  port: FakePort;
  process: (inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) => boolean;
};
type VoiceCtor = new () => Voice;
const registered = new Map<string, VoiceCtor>();
type Call = { fn: string; h: number; args: number[] };

const g = globalThis as {
  currentFrame?: number;
  sampleRate?: number;
  AudioWorkletProcessor?: new () => { port: FakePort };
  registerProcessor?: (name: string, ctor: VoiceCtor) => void;
};

beforeAll(async () => {
  g.AudioWorkletProcessor = class {
    readonly port = new FakePort();
  };
  g.registerProcessor = (name, ctor) => registered.set(name, ctor);
  g.sampleRate = SAMPLE_RATE;
  await import('../macro-processor');
});

afterAll(() => {
  delete g.currentFrame;
  delete g.sampleRate;
});

describe('macro-processor', () => {
  let calls: Call[];
  let withMacroApi: boolean;
  let withoutExports: string[];

  const initData = () => ({
    type: 'init-wasm',
    data: { wasmBytes: new ArrayBuffer(8), sampleRate: SAMPLE_RATE, isThreaded: false, memoryPages: 256, exportMap: {} },
  });

  async function boot() {
    const voice = new (registered.get('macro-processor')!)();
    await voice.port.deliver(initData());
    return voice;
  }

  function render(voice: Voice, frame: number) {
    g.currentFrame = frame;
    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    voice.process([], [out], {});
    return out;
  }

  beforeEach(() => {
    resetHyphonNativeSessionForTests();
    calls = [];
    withMacroApi = true;
    withoutExports = [];
    const RealMemory = WebAssembly.Memory;
    let memory: WebAssembly.Memory;
    vi.spyOn(WebAssembly, 'Memory').mockImplementation(function (desc: WebAssembly.MemoryDescriptor) {
      memory = new RealMemory({ initial: 1, maximum: 4, shared: desc.shared });
      return memory;
    } as unknown as typeof WebAssembly.Memory);
    vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
    vi.spyOn(WebAssembly.Module, 'imports').mockReturnValue([{ module: 'a', name: 'a', kind: 'memory' }]);
    vi.spyOn(WebAssembly, 'instantiate').mockImplementation(((_m: WebAssembly.Module, imports: WebAssembly.Imports) => {
      const record = (fn: string, ret = 1) => (h: number, ...args: number[]) => {
        calls.push({ fn, h, args });
        return ret;
      };
      const macro = withMacroApi ? {
        macro_create: () => 7,
        macro_destroy: record('macro_destroy'),
        macro_init: record('macro_init'),
        macro_push_event: record('macro_push_event'),
        macro_cancel_notes: record('macro_cancel_notes'),
        macro_all_notes_off: record('macro_all_notes_off'),
        macro_set_param_now: record('macro_set_param_now'),
        macro_engine_count: () => 24,
        macro_stride: () => STRIDE,
        macro_render: (h: number, blockStart: number, frames: number) => {
          calls.push({ fn: 'macro_render', h, args: [blockStart, frames] });
          // Planar stereo: left 0.25 at the pointer, right -0.5 one stride on.
          new Float32Array(memory.buffer, 1024, frames).fill(0.25);
          new Float32Array(memory.buffer, 1024 + STRIDE * 4, frames).fill(-0.5);
          return 1024;
        },
      } : {};
      for (const name of withoutExports) delete (macro as Record<string, unknown>)[name];
      const exports = {
        memory: (imports as { a: { a: WebAssembly.Memory } }).a.a,
        __wasm_call_ctors: () => {},
        ...macro,
      };
      return Promise.resolve({ exports } as unknown as WebAssembly.Instance);
    }) as unknown as typeof WebAssembly.instantiate);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetHyphonNativeSessionForTests();
  });

  it('reports ready with the model count and initialises at the context rate', async () => {
    const voice = await boot();
    expect(voice.port.posted.find((m) => m.type === 'ready')?.engineCount).toBe(24);
    expect(calls.find((c) => c.fn === 'macro_init')).toEqual({ fn: 'macro_init', h: 7, args: [SAMPLE_RATE, 4096] });
  });

  it('turns notes, params and stops into events on their frames', async () => {
    const voice = await boot();
    calls = [];
    await voice.port.deliver({ type: 'noteOn', data: { note: 60, velocity: 0.9, audioTime: 2, timbre: 0.2, slide: true, fine: 0.5, morph: -0.1 } });
    await voice.port.deliver({ type: 'noteOff', data: { note: 60, audioTime: 2.5 } });
    await voice.port.deliver({ type: 'set-param', data: { paramId: 1, value: 0.4, audioTime: 1 } });
    await voice.port.deliver({ type: 'set-params', data: { params: [2, 0.3, 3, 0.7], audioTime: 1.5 } });
    await voice.port.deliver({ type: 'releaseAll', data: { audioTime: 3 } });
    await voice.port.deliver({ type: 'allNotesOff', data: {} });
    expect(calls).toEqual([
      { fn: 'macro_push_event', h: 7, args: [96000, 1, 60, 0.9, 0.2, 1, 0.5, -0.1] },
      { fn: 'macro_push_event', h: 7, args: [120000, 2, 60, 0, 0, 0, 0, 0] },
      { fn: 'macro_push_event', h: 7, args: [48000, 4, 1, 0.4, 0, 0, 0, 0] },
      { fn: 'macro_push_event', h: 7, args: [72000, 4, 2, 0.3, 0, 0, 0, 0] },
      { fn: 'macro_push_event', h: 7, args: [72000, 4, 3, 0.7, 0, 0, 0, 0] },
      { fn: 'macro_push_event', h: 7, args: [144000, 3, 0, 0, 0, 0, 0, 0] },
      { fn: 'macro_cancel_notes', h: 7, args: [] },
      { fn: 'macro_all_notes_off', h: 7, args: [] },
    ]);
  });

  it('applies knob moves now through macro_set_param_now', async () => {
    const voice = await boot();
    calls = [];
    await voice.port.deliver({ type: 'set-params-now', data: { params: [1, 0.6, 11, 0.2] } });
    expect(calls).toEqual([
      { fn: 'macro_set_param_now', h: 7, args: [1, 0.6] },
      { fn: 'macro_set_param_now', h: 7, args: [11, 0.2] },
    ]);
  });

  it('copies the planar stereo block to left and right', async () => {
    const voice = await boot();
    calls = [];
    const [left, right] = render(voice, 96000);
    expect(calls).toEqual([{ fn: 'macro_render', h: 7, args: [96000, BLOCK] }]);
    expect(left[0]).toBe(0.25);
    expect(left[BLOCK - 1]).toBe(0.25);
    expect(right[0]).toBe(-0.5);
    expect(right[BLOCK - 1]).toBe(-0.5);
  });

  it('refuses a hyphon_native without the macro API by name (the parts then substitute)', async () => {
    withMacroApi = false;
    const voice = await boot();
    const error = voice.port.posted.find((m) => m.type === 'error');
    expect(error?.error).toContain('macro_* API not found');
    const [left, right] = render(voice, 0);
    expect(left.every((s) => s === 0) && right.every((s) => s === 0)).toBe(true);
  });

  it('names exactly the exports an older macro build lacks', async () => {
    withoutExports = ['macro_set_param_now'];
    const voice = await boot();
    const error = voice.port.posted.find((m) => m.type === 'error')?.error ?? '';
    // Only the absent export is named as missing; the rest is the export list.
    expect(error).toMatch(/missing macro_set_param_now\. WASM exports/);
  });
});
