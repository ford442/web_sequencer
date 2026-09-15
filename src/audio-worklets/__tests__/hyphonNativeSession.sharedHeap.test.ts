import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from 'vitest';
import { resetHyphonNativeSessionForTests } from '../hyphonNativeSession';

/**
 * Guard: one hyphon_native heap per audio session.
 *
 * bass1 / bass2 / lead303 (Open303) and part A / part B (Prophecy) each used to
 * instantiate hyphon_native.wasm and import their own 128 MB `shared: true`
 * WebAssembly.Memory — five SharedArrayBuffers before a note played, which is
 * what fails on mobile Safari and low-RAM Chromebooks. All AudioWorkletNodes of
 * one context share an AudioWorkletGlobalScope, so the voices now take handles
 * on a single instance. This test boots both real processor bundles into one
 * fake global scope and fails if a second memory, compile or instantiate slips
 * back in.
 */

type Posted = { type: string; [k: string]: unknown };

class FakePort {
  onmessage: ((e: MessageEvent) => unknown) | null = null;
  readonly posted: Posted[] = [];
  postMessage(msg: Posted) {
    this.posted.push(msg);
  }
  addEventListener() {}
  removeEventListener() {}
  deliver(data: unknown) {
    return this.onmessage?.({ data } as MessageEvent);
  }
}

const registered = new Map<string, new () => { port: FakePort; process: (...a: any[]) => boolean }>();

beforeAll(async () => {
  (globalThis as any).AudioWorkletProcessor = class {
    readonly port = new FakePort();
  };
  (globalThis as any).registerProcessor = (name: string, ctor: any) => registered.set(name, ctor);
  await import('../open303-processor');
  await import('../prophecy-processor');
});

const BUF_FRAMES = 128;

/** A JS stand-in for hyphon_native's multi-instance C API. */
function makeFakeExports(memory: WebAssembly.Memory) {
  let nextPtr = 1024;
  let nextHandle = 1;
  const live = new Set<number>();
  const noteOns: Array<{ api: string; handle: number; note: number }> = [];
  const create = () => {
    const h = nextHandle++;
    live.add(h);
    return h;
  };
  const destroy = (h: number) => {
    live.delete(h);
  };
  const exports = {
    memory,
    malloc: (bytes: number) => {
      const p = nextPtr;
      nextPtr += bytes;
      return p;
    },
    free: () => {},
    __wasm_call_ctors: vi.fn(),
    open303_create: create,
    open303_destroy: destroy,
    open303_init: () => 1,
    open303_note_on: (handle: number, note: number) => noteOns.push({ api: 'open303', handle, note }),
    open303_set_param: () => {},
    jc303_create: create,
    jc303_destroy: destroy,
    jc303_init_handle: () => 1,
    jc303_process_handle: () => 0,
    prophecy_create: create,
    prophecy_destroy: destroy,
    prophecy_init: () => 1,
    prophecy_note_on: (handle: number, note: number) => noteOns.push({ api: 'prophecy', handle, note }),
    prophecy_set_param: () => {},
    prophecy_process: () => 0,
  };
  return { exports, live, noteOns };
}

describe('hyphon_native shared heap (one per audio session)', () => {
  let memoryCtor: ReturnType<typeof vi.fn>;
  // Default MockInstance uses `(...args: any[]) => any`. Bare
  // `ReturnType<typeof vi.spyOn>` infers `unknown[]` args, which is not
  // assignable from WebAssembly.compile / instantiate (BufferSource params).
  let compileSpy: MockInstance;
  let instantiateSpy: MockInstance;
  let fake: ReturnType<typeof makeFakeExports>;
  const RealMemory = WebAssembly.Memory;

  beforeEach(() => {
    resetHyphonNativeSessionForTests();
    // Allocate tiny real memories: the guard counts constructions, not bytes.
    memoryCtor = vi.fn(function (this: unknown, desc: WebAssembly.MemoryDescriptor) {
      return new RealMemory({ initial: 1, maximum: 4, shared: desc.shared });
    });
    vi.spyOn(WebAssembly, 'Memory').mockImplementation(memoryCtor as any);
    compileSpy = vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
    vi.spyOn(WebAssembly.Module, 'imports').mockReturnValue([
      { module: 'a', name: 'a', kind: 'memory' },
    ]);
    instantiateSpy = vi.spyOn(WebAssembly, 'instantiate').mockImplementation((async (
      _module: WebAssembly.Module,
      imports: WebAssembly.Imports,
    ) => {
      fake = makeFakeExports((imports as any).a.a as WebAssembly.Memory);
      return { exports: fake.exports } as unknown as WebAssembly.Instance;
    }) as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetHyphonNativeSessionForTests();
  });

  const initData = () => ({
    type: 'init-wasm',
    data: {
      wasmBytes: new ArrayBuffer(8),
      sampleRate: 48000,
      isThreaded: true,
      variant: 'threaded',
      memoryPages: 2048,
      exportMap: {},
    },
  });

  async function bootFiveVoices() {
    const Open303 = registered.get('open303-processor')!;
    const Prophecy = registered.get('prophecy-processor')!;
    const voices = {
      bass1: new Open303(),
      bass2: new Open303(),
      lead303: new Open303(),
      partA: new Prophecy(),
      partB: new Prophecy(),
    };
    // Parallel, like Open303Manager / ProphecyManager.
    await Promise.all(Object.values(voices).map((v) => v.port.deliver(initData())));
    return voices;
  }

  it('allocates exactly one WebAssembly.Memory for 3×303 + 2×Prophecy', async () => {
    const voices = await bootFiveVoices();

    for (const [name, v] of Object.entries(voices)) {
      expect(v.port.posted.map((m) => m.type), name).toContain('ready');
    }
    expect(memoryCtor).toHaveBeenCalledTimes(1);
    expect(memoryCtor.mock.calls[0][0]).toMatchObject({ initial: 2048, shared: true });
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(instantiateSpy).toHaveBeenCalledTimes(1);
    // C++ static constructors must run once — re-running them would reset live globals.
    expect(fake.exports.__wasm_call_ctors).toHaveBeenCalledTimes(1);
  });

  it('reports heap count 1 to the main thread in every ready message', async () => {
    const voices = await bootFiveVoices();
    for (const v of Object.values(voices)) {
      const ready = v.port.posted.find((m) => m.type === 'ready');
      expect(ready?.heap).toMatchObject({ heapCount: 1 });
    }
    // Each ready carries a snapshot; the last voice to attach sees all five.
    const voiceCounts = Object.values(voices).map(
      (v) => (v.port.posted.find((m) => m.type === 'ready')?.heap as { voices: number }).voices,
    );
    expect(Math.max(...voiceCounts)).toBe(5);
  });

  it('keeps the five voices independent: distinct handles, notes routed per handle', async () => {
    const voices = await bootFiveVoices();

    // open303 + jc303 handle per 303 voice, one prophecy handle per part.
    expect(fake.live.size).toBe(3 * 2 + 2);

    voices.bass1.port.deliver({ type: 'noteOn', data: { note: 36, velocity: 100 } });
    voices.bass2.port.deliver({ type: 'noteOn', data: { note: 38, velocity: 100 } });
    voices.lead303.port.deliver({ type: 'noteOn', data: { note: 60, velocity: 100 } });
    voices.partA.port.deliver({ type: 'noteOn', data: { note: 64, velocity: 100 } });
    voices.partB.port.deliver({ type: 'noteOn', data: { note: 40, velocity: 100 } });

    const open303Handles = fake.noteOns.filter((n) => n.api === 'open303').map((n) => n.handle);
    const prophecyHandles = fake.noteOns.filter((n) => n.api === 'prophecy').map((n) => n.handle);
    expect(new Set(open303Handles).size).toBe(3);
    expect(new Set(prophecyHandles).size).toBe(2);
    expect(fake.noteOns.map((n) => n.note)).toEqual([36, 38, 60, 64, 40]);
  });

  it('dispose frees a voice\'s handles without touching the shared instance', async () => {
    const voices = await bootFiveVoices();
    const before = fake.live.size;

    voices.bass2.port.deliver({ type: 'dispose' });
    voices.partB.port.deliver({ type: 'dispose' });

    expect(fake.live.size).toBe(before - 2 - 1);
    expect(voices.bass2.process([], [[new Float32Array(BUF_FRAMES)]], {})).toBe(false);

    // A replacement voice reuses the live instance — still one heap.
    const Open303 = registered.get('open303-processor')!;
    const again = new Open303();
    await again.port.deliver(initData());
    expect(again.port.posted.find((m) => m.type === 'ready')?.heap).toMatchObject({ heapCount: 1, voices: 4 });
    expect(memoryCtor).toHaveBeenCalledTimes(1);
  });

  it('retries a failed instantiation instead of caching the failure', async () => {
    instantiateSpy.mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const Open303 = registered.get('open303-processor')!;
    const voice = new Open303();
    await voice.port.deliver(initData());

    expect(voice.port.posted.map((m) => m.type)).toContain('ready');
    // The failed attempt's memory is unreachable and must not count toward the HUD.
    expect(voice.port.posted.find((m) => m.type === 'ready')?.heap).toMatchObject({ heapCount: 1 });
  });
});
