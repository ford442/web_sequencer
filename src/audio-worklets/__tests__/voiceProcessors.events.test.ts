import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { resetHyphonNativeSessionForTests } from '../hyphonNativeSession';
import { NATIVE_VOICE_MAX_BLOCK_FRAMES } from '../hyphonNativeImports';

/**
 * #1344 P4: prophecy-processor and drumkit-processor on NativeVoiceProcessor.
 * Each message becomes a voice-core event on the frame of its audioTime, the
 * drum kit joins the audio session's shared instance (it used to instantiate
 * its own), and each block renders with its start frame.
 */

const SAMPLE_RATE = 44100;
const BLOCK = 128;

class FakePort {
  onmessage: ((e: MessageEvent) => unknown) | null = null;
  readonly posted: Array<{ type: string; heap?: { heapCount?: number; voices?: number } }> = [];
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

const g = globalThis as unknown as {
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
  await import('../prophecy-processor');
  await import('../drumkit-processor');
});

afterAll(() => {
  delete g.currentFrame;
  delete g.sampleRate;
});

describe('voice processors on the event API', () => {
  let calls: Call[];
  let instantiations: number;
  let live: Set<number>;

  const initData = () => ({
    type: 'init-wasm',
    data: { wasmBytes: new ArrayBuffer(8), sampleRate: SAMPLE_RATE, isThreaded: false, memoryPages: 256, exportMap: {} },
  });

  async function boot(name: 'prophecy-processor' | 'drumkit-processor') {
    const voice = new (registered.get(name)!)();
    await voice.port.deliver(initData());
    expect(voice.port.posted.map((m) => m.type)).toContain('ready');
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
    instantiations = 0;
    live = new Set();
    const RealMemory = WebAssembly.Memory;
    let memory: WebAssembly.Memory;
    vi.spyOn(WebAssembly, 'Memory').mockImplementation(function (desc: WebAssembly.MemoryDescriptor) {
      memory = new RealMemory({ initial: 1, maximum: 4, shared: desc.shared });
      return memory;
    } as unknown as typeof WebAssembly.Memory);
    vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
    vi.spyOn(WebAssembly.Module, 'imports').mockReturnValue([{ module: 'a', name: 'a', kind: 'memory' }]);
    vi.spyOn(WebAssembly, 'instantiate').mockImplementation(((_m: WebAssembly.Module, imports: WebAssembly.Imports) => {
      instantiations++;
      let nextHandle = 1;
      const record = (fn: string, ret = 1) => (h: number, ...args: number[]) => {
        calls.push({ fn, h, args });
        return ret;
      };
      const voiceApi = (api: string) => ({
        [`${api}_create`]: () => {
          const h = nextHandle++;
          live.add(h);
          return h;
        },
        [`${api}_destroy`]: (h: number) => live.delete(h),
        [`${api}_init`]: record(`${api}_init`),
        [`${api}_push_event`]: record(`${api}_push_event`),
        [`${api}_cancel_notes`]: record(`${api}_cancel_notes`),
        [`${api}_all_notes_off`]: record(`${api}_all_notes_off`),
        [`${api}_render`]: (h: number, blockStart: number, frames: number) => {
          calls.push({ fn: `${api}_render`, h, args: [blockStart, frames] });
          new Float32Array(memory.buffer, 2048, frames).fill(0.25);
          // Planar right channel for the stereo drum kit, one stride on.
          new Float32Array(memory.buffer, 2048 + 4 * NATIVE_VOICE_MAX_BLOCK_FRAMES, frames).fill(-0.5);
          return 2048;
        },
      });
      const exports = {
        memory: (imports as { a: { a: WebAssembly.Memory } }).a.a,
        __wasm_call_ctors: () => {},
        ...voiceApi('prophecy'),
        ...voiceApi('drumkit'),
      };
      return Promise.resolve({ exports } as unknown as WebAssembly.Instance);
    }) as unknown as typeof WebAssembly.instantiate);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetHyphonNativeSessionForTests();
  });

  it('prophecy: notes and params become events on their frames; stop cancels then resets', async () => {
    const voice = await boot('prophecy-processor');
    const h = calls.find((c) => c.fn === 'prophecy_init')!.h;
    expect(calls.find((c) => c.fn === 'prophecy_init')!.args).toEqual([SAMPLE_RATE, 4096]);
    calls = [];

    await voice.port.deliver({ type: 'noteOn', data: { note: 57, velocity: 100, audioTime: 2 } });
    await voice.port.deliver({ type: 'noteOff', data: { note: 57, audioTime: 2.5 } });
    await voice.port.deliver({ type: 'set-param', data: { paramId: 1, value: 0.4 } });
    await voice.port.deliver({ type: 'allNotesOff', data: {} });
    expect(calls).toEqual([
      { fn: 'prophecy_push_event', h, args: [88200, 1, 57, 100, 0, 0, 0, 0] },
      { fn: 'prophecy_push_event', h, args: [110250, 2, 57, 0, 0, 0, 0, 0] },
      { fn: 'prophecy_push_event', h, args: [0, 4, 1, 0.4, 0, 0, 0, 0] },
      { fn: 'prophecy_cancel_notes', h, args: [] },
      { fn: 'prophecy_all_notes_off', h, args: [] },
    ]);

    calls = [];
    const [left, right] = render(voice, 88192);
    expect(calls).toEqual([{ fn: 'prophecy_render', h, args: [88192, BLOCK] }]);
    expect(left[5]).toBe(0.25);
    expect(right[5]).toBe(0.25);
  });

  it('drumkit: a trigger carries its pan, velocity and a..d on its frame; set-kit and choke are events', async () => {
    const voice = await boot('drumkit-processor');
    const h = calls.find((c) => c.fn === 'drumkit_init')!.h;
    calls = [];

    await voice.port.deliver({ type: 'trigger', data: { voice: 0, velocity: 1, a: 50, b: 0.6, c: 0.6, d: 1, audioTime: 1 } });
    await voice.port.deliver({ type: 'trigger', data: { voice: 2, velocity: 1, a: 400, b: 0.1, c: 0.7, pan: -0.5, audioTime: 1.25 } });
    await voice.port.deliver({ type: 'set-kit', data: { kit: 1 } });
    await voice.port.deliver({ type: 'choke-open-hat', data: { audioTime: 1.5 } });
    expect(calls.map((c) => c.args)).toEqual([
      [44100, 0x102, 0, 0, 0, 0, 0, 0],      // kDrumkitSetPan, kick: centre
      [44100, 5, 0, 1, 50, 0.6, 0.6, 1],     // kTrigger, kick — latches it
      [55125, 0x102, 2, -0.5, 0, 0, 0, 0],   // kDrumkitSetPan, closed hat
      [55125, 5, 2, 1, 400, 0.1, 0.7, 0],    // kTrigger, closed hat
      [0, 0x101, 1, 0, 0, 0, 0, 0],          // kDrumkitSetKit, 909
      [66150, 0x100, 0, 0, 0, 0, 0, 0],      // kDrumkitChokeOpenHat
    ]);
    const [left, right] = render(voice, 44032);
    expect(calls.at(-1)).toEqual({ fn: 'drumkit_render', h, args: [44032, BLOCK] });
    // Planar stereo: right is one stride after left.
    expect(left[5]).toBe(0.25);
    expect(right[5]).toBe(-0.5);

    // Transport stop (#1344 P5): hits posted ahead of their frame are dropped.
    await voice.port.deliver({ type: 'allNotesOff', data: {} });
    expect(calls.at(-1)).toEqual({ fn: 'drumkit_cancel_notes', h, args: [] });
  });

  it('drumkit: every block is one native render call, however many hits it holds', async () => {
    const voice = await boot('drumkit-processor');
    const h = calls.find((c) => c.fn === 'drumkit_init')!.h;
    const block = 44032;
    // A flam: two hits 1.5 ms (66 frames) apart, both inside the block at 44032.
    await voice.port.deliver({ type: 'trigger', data: { voice: 0, velocity: 1, audioTime: (block + 20) / SAMPLE_RATE } });
    await voice.port.deliver({ type: 'trigger', data: { voice: 2, velocity: 1, audioTime: (block + 86) / SAMPLE_RATE } });
    expect(calls.filter((c) => c.fn === 'drumkit_push_event').map((c) => c.args[0])).toEqual([
      block + 20, block + 20, block + 86, block + 86,
    ]);

    // The ring splits the block at each event frame inside the native render;
    // the worklet makes the same single call with or without triggers.
    for (const frame of [block - BLOCK, block, block + BLOCK]) {
      calls = [];
      render(voice, frame);
      expect(calls).toEqual([{ fn: 'drumkit_render', h, args: [frame, BLOCK] }]);
    }
  });

  it('the drum kit joins the shared instance and hands its handle back on dispose', async () => {
    const lead = await boot('prophecy-processor');
    const drums = await boot('drumkit-processor');
    expect(instantiations).toBe(1);
    expect(drums.port.posted.find((m) => m.type === 'ready')?.heap).toMatchObject({ heapCount: 1, voices: 2 });
    expect(live.size).toBe(2);

    await drums.port.deliver({ type: 'dispose' });
    expect(live.size).toBe(1);
    expect(drums.process([], [[new Float32Array(BLOCK)]], {})).toBe(false);
    expect(lead.process([], [[new Float32Array(BLOCK)]], {})).toBe(true);
  });
});
