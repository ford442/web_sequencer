import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { resetHyphonNativeSessionForTests } from '../hyphonNativeSession';

/**
 * #1344 P1: the 303 worklet honours `audioTime` on noteOn / noteOff.
 *
 * It used to read `audioTime` only for params, so a note scheduled ahead fired
 * in whichever block its message landed in — and every note's scheduled
 * noteOff (posted together with its noteOn) closed the gate at once. Notes now
 * share the params' time-ordered queue and drain on the same block grid as the
 * drum worklet: the first block whose currentTime has reached the event.
 */

const SAMPLE_RATE = 48000;
const BLOCK = 128;
const QUANTUM = BLOCK / SAMPLE_RATE;
const T0 = 1.0;

class FakePort {
  onmessage: ((e: MessageEvent) => unknown) | null = null;
  readonly posted: Array<{ type: string }> = [];
  postMessage(msg: { type: string }) {
    this.posted.push(msg);
  }
  addEventListener() {}
  removeEventListener() {}
  deliver(data: unknown) {
    return this.onmessage?.({ data } as MessageEvent);
  }
}

type Voice = { port: FakePort; process: (...a: any[]) => boolean };
const registered = new Map<string, new () => Voice>();

type Call = { fn: 'on' | 'off' | 'param' | 'allOff'; at: number; note?: number; value?: number };

const g = globalThis as { currentTime?: number };

beforeAll(async () => {
  (globalThis as any).AudioWorkletProcessor = class {
    readonly port = new FakePort();
  };
  (globalThis as any).registerProcessor = (name: string, ctor: any) => registered.set(name, ctor);
  await import('../open303-processor');
});

afterAll(() => {
  delete g.currentTime;
});

describe('open303-processor note timing (#1344)', () => {
  let calls: Call[];
  let voice: Voice;

  const now = () => g.currentTime ?? NaN;
  const ons = () => calls.filter((c) => c.fn === 'on');
  const offs = () => calls.filter((c) => c.fn === 'off');

  /** Render one block at the current audio time, then advance the clock. */
  function renderBlock() {
    voice.process([], [[new Float32Array(BLOCK), new Float32Array(BLOCK)]], {});
    g.currentTime = now() + QUANTUM;
  }

  function renderUntil(t: number) {
    while (now() <= t) renderBlock();
  }

  const send = (type: string, data?: Record<string, unknown>) => voice.port.deliver({ type, data });

  beforeEach(async () => {
    resetHyphonNativeSessionForTests();
    calls = [];
    g.currentTime = T0;

    const RealMemory = WebAssembly.Memory;
    // A function expression, not an arrow: Vitest >= 4 calls a mocked
    // constructor through Reflect.construct (#1422).
    vi.spyOn(WebAssembly, 'Memory').mockImplementation(
      function (desc: WebAssembly.MemoryDescriptor) {
        return new RealMemory({ initial: 1, maximum: 4, shared: desc.shared });
      } as any,
    );
    vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
    vi.spyOn(WebAssembly.Module, 'imports').mockReturnValue([{ module: 'a', name: 'a', kind: 'memory' }]);
    vi.spyOn(WebAssembly, 'instantiate').mockImplementation((async (_m: WebAssembly.Module, imports: WebAssembly.Imports) => {
      let nextPtr = 1024;
      let nextHandle = 1;
      const exports = {
        memory: (imports as any).a.a as WebAssembly.Memory,
        malloc: (bytes: number) => {
          const p = nextPtr;
          nextPtr += bytes;
          return p;
        },
        free: () => {},
        __wasm_call_ctors: () => {},
        open303_create: () => nextHandle++,
        open303_destroy: () => {},
        open303_init: () => 1,
        open303_note_on: (_h: number, note: number) => calls.push({ fn: 'on', at: now(), note }),
        open303_note_off: (_h: number, note: number) => calls.push({ fn: 'off', at: now(), note }),
        open303_all_notes_off: () => calls.push({ fn: 'allOff', at: now() }),
        open303_set_param: (_h: number, _id: number, value: number) => calls.push({ fn: 'param', at: now(), value }),
        open303_process: () => {},
        jc303_create: () => nextHandle++,
        jc303_destroy: () => {},
        jc303_init_handle: () => 1,
        jc303_process_handle: () => 0,
      };
      return { exports } as unknown as WebAssembly.Instance;
    }) as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    voice = new (registered.get('open303-processor')!)();
    await send('init-wasm', {
      wasmBytes: new ArrayBuffer(8),
      sampleRate: SAMPLE_RATE,
      isThreaded: true,
      variant: 'threaded',
      memoryPages: 2048,
      exportMap: {},
    });
    expect(voice.port.posted.map((m) => m.type)).toContain('ready');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetHyphonNativeSessionForTests();
  });

  it('a noteOn scheduled 50 ms ahead does not sound early', () => {
    const at = T0 + 0.05;
    send('noteOn', { note: 36, velocity: 100, audioTime: at });
    expect(ons()).toHaveLength(0);

    renderUntil(at + 0.05);

    expect(ons()).toHaveLength(1);
    // The first block whose start has reached the note — never before it.
    expect(ons()[0].at).toBeGreaterThanOrEqual(at);
    expect(ons()[0].at - at).toBeLessThan(QUANTUM);
  });

  it('holds a note for its gate length instead of releasing it on arrival', () => {
    // playSynth posts both at once: noteOn at the step, noteOff one step later.
    const step = 0.125;
    send('noteOn', { note: 36, velocity: 100, audioTime: T0 });
    send('noteOff', { note: 36, audioTime: T0 + step });
    expect(ons()).toHaveLength(1);
    expect(offs()).toHaveLength(0);

    renderUntil(T0 + 2 * step);

    expect(offs()).toHaveLength(1);
    expect(offs()[0].at).toBeGreaterThanOrEqual(T0 + step);
    expect(offs()[0].at - (T0 + step)).toBeLessThan(QUANTUM);
  });

  it('still plays a noteOn without audioTime immediately (live keyboard)', () => {
    send('noteOn', { note: 48, velocity: 100 });
    expect(ons()).toEqual([{ fn: 'on', at: T0, note: 48 }]);
  });

  it('applies a param and a noteOn scheduled for the same time in posting order', () => {
    const at = T0 + 0.02;
    send('param', { func: 'jc303_setCutoff', value: 0.3, audioTime: at });
    send('noteOn', { note: 36, velocity: 100, audioTime: at });

    renderUntil(at + 0.01);

    expect(calls.map((c) => c.fn)).toEqual(['param', 'on']);
    expect(calls[0].at).toBe(calls[1].at);
  });

  it('applies an overdue queued param before a newer one that arrives late', () => {
    send('param', { func: 'jc303_setCutoff', value: 0.2, audioTime: T0 + 0.01 });
    // The clock passes it before the next drain, and a later value arrives.
    g.currentTime = T0 + 0.02;
    send('param', { func: 'jc303_setCutoff', value: 0.8, audioTime: T0 + 0.015 });
    renderBlock();

    expect(calls.filter((c) => c.fn === 'param').map((c) => c.value)).toEqual([0.2, 0.8]);
  });

  it('plays retriggers drained in back-to-back blocks (rate limit runs on the audio clock)', () => {
    // A 4× retrigger at 120 BPM: notes 31.25 ms apart, scheduled in one burst.
    // process() calls are microseconds apart in wall time here, as they are in
    // a real render burst — a wall-clock "too soon" check would drop 3 of 4.
    const sub = 0.125 / 4;
    for (let i = 0; i < 4; i++) {
      send('noteOn', { note: 36, velocity: 100, audioTime: T0 + 0.01 + i * sub });
      send('noteOff', { note: 36, audioTime: T0 + 0.01 + (i + 1) * sub });
    }
    renderUntil(T0 + 0.2);

    expect(ons()).toHaveLength(4);
    ons().forEach((c, i) => {
      expect(c.at).toBeGreaterThanOrEqual(T0 + 0.01 + i * sub);
    });
  });

  it('ignores the stale noteOff of a note a later noteOn replaced', () => {
    // A two-step note, then a note on the next step: the first note's noteOff
    // now lands while the second is sounding and must not release it.
    const step = 0.125;
    send('noteOn', { note: 36, velocity: 100, audioTime: T0 });
    send('noteOff', { note: 36, audioTime: T0 + 2 * step });
    send('noteOn', { note: 43, velocity: 100, audioTime: T0 + step });
    send('noteOff', { note: 43, audioTime: T0 + 3 * step });

    renderUntil(T0 + 4 * step);

    expect(ons().map((c) => c.note)).toEqual([36, 43]);
    // 36 is released (not reset) when 43 takes over; its own late noteOff is dropped.
    expect(offs().map((c) => c.note)).toEqual([36, 43]);
    expect(offs()[0].at).toBeLessThan(T0 + 2 * step);
    expect(offs()[1].at).toBeGreaterThanOrEqual(T0 + 3 * step);
    expect(calls.some((c) => c.fn === 'allOff')).toBe(false);
  });

  it('allNotesOff releases the sounding note and cancels scheduled ones', () => {
    send('noteOn', { note: 36, velocity: 100, audioTime: T0 });
    send('noteOn', { note: 38, velocity: 100, audioTime: T0 + 0.05 });
    send('param', { func: 'jc303_setCutoff', value: 0.5, audioTime: T0 + 0.05 });

    send('allNotesOff');
    expect(offs().map((c) => c.note)).toEqual([36]);

    renderUntil(T0 + 0.2);
    // The retrigger never sounds after the stop; the scheduled param still lands.
    expect(ons().map((c) => c.note)).toEqual([36]);
    expect(calls.filter((c) => c.fn === 'param')).toHaveLength(1);
  });
});
