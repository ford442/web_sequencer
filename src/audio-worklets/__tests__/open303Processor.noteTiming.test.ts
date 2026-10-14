import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { resetHyphonNativeSessionForTests } from '../hyphonNativeSession';

/**
 * #1344: the 303 worklet honours audioTime on noteOn / noteOff.
 *
 * P1 did it with a TS queue drained once per block. Since P4 every note and
 * param is a voice-core event: the worklet converts audioTime to an absolute
 * frame and pushes it into the voice's native ring, and the engine applies it
 * on that sample (emscripten/tests/event_api_checks.h, voice_core_test.cpp —
 * including the mono rules: retrigger over a held note, stale noteOff dropped,
 * 8 s stuck-note release). This test pins down the worklet's half: the frame
 * math, which voice each event goes to, the stop / engine-switch hand-offs,
 * and rendering with the block's start frame.
 */

const SAMPLE_RATE = 48000;
const BLOCK = 128;
const OPEN303 = 1;
const JC303 = 2;
const HIGHFID = 3;

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

type Voice = {
  port: FakePort;
  process: (inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) => boolean;
};
type VoiceCtor = new () => Voice;
const registered = new Map<string, VoiceCtor>();

/** One recorded call into the fake hyphon_native. */
type Call = { fn: string; h: number; args: number[] };

/** The AudioWorkletGlobalScope members the processor reads, faked on globalThis. */
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
  await import('../open303-processor');
});

afterAll(() => {
  delete g.currentFrame;
  delete g.sampleRate;
});

describe('open303-processor on the voice-core event API (#1344)', () => {
  let calls: Call[];
  let voice: Voice;
  let memory: WebAssembly.Memory;

  const named = (fn: string) => calls.filter((c) => c.fn === fn);
  const send = (type: string, data?: Record<string, unknown>) => voice.port.deliver({ type, data });

  function render(frame: number) {
    g.currentFrame = frame;
    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    voice.process([], [out, [new Float32Array(BLOCK), new Float32Array(BLOCK)]], {});
    return out;
  }

  beforeEach(async () => {
    resetHyphonNativeSessionForTests();
    calls = [];

    const RealMemory = WebAssembly.Memory;
    // A function, not an arrow: the session constructs it with `new`.
    vi.spyOn(WebAssembly, 'Memory').mockImplementation(function (desc: WebAssembly.MemoryDescriptor) {
      memory = new RealMemory({ initial: 1, maximum: 4, shared: desc.shared });
      return memory;
    } as unknown as typeof WebAssembly.Memory);
    vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
    vi.spyOn(WebAssembly.Module, 'imports').mockReturnValue([{ module: 'a', name: 'a', kind: 'memory' }]);
    vi.spyOn(WebAssembly, 'instantiate').mockImplementation(((_m: WebAssembly.Module, imports: WebAssembly.Imports) => {
      const record = (fn: string) => (h: number, ...args: number[]) => {
        calls.push({ fn, h, args });
        return 1;
      };
      const handles: Record<string, number> = { open303: OPEN303, jc303: JC303, highfid303: HIGHFID };
      const voiceApi = (api: string) => ({
        [`${api}_create`]: () => handles[api],
        [`${api}_destroy`]: () => {},
        [`${api}_init`]: () => 1,
        [`${api}_push_event`]: record(`${api}_push_event`),
        [`${api}_cancel_notes`]: record(`${api}_cancel_notes`),
        [`${api}_flush`]: record(`${api}_flush`),
        [`${api}_all_notes_off`]: record(`${api}_all_notes_off`),
        [`${api}_set_param`]: record(`${api}_set_param`),
        // Each voice renders a constant (handle / 10) into its buffer at 4096 + handle * 1024.
        [`${api}_render`]: (h: number, blockStart: number, frames: number) => {
          calls.push({ fn: `${api}_render`, h, args: [blockStart, frames] });
          const ptr = 4096 + h * 1024;
          new Float32Array(memory.buffer, ptr, frames).fill(h / 10);
          return ptr;
        },
      });
      const exports = {
        memory: (imports as { a: { a: WebAssembly.Memory } }).a.a,
        malloc: () => 1024,
        free: () => {},
        __wasm_call_ctors: () => {},
        ...voiceApi('open303'),
        ...voiceApi('jc303'),
        ...voiceApi('highfid303'),
        highfid303_set_oversample: () => {},
      };
      return Promise.resolve({ exports } as unknown as WebAssembly.Instance);
    }) as unknown as typeof WebAssembly.instantiate);
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
    calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetHyphonNativeSessionForTests();
  });

  it('pushes a noteOn scheduled 50 ms ahead for its own frame', () => {
    send('noteOn', { note: 36, velocity: 100, audioTime: 1.05 });
    expect(named('open303_push_event')).toEqual([
      { fn: 'open303_push_event', h: OPEN303, args: [50400, 1, 36, 100, 0, 0, 0, 0] },
    ]);
  });

  it('pushes the noteOff for the end of the gate, not for when it arrived', () => {
    // playSynth posts both at once: noteOn at the step, noteOff one step later.
    send('noteOn', { note: 36, velocity: 100, audioTime: 1.0 });
    send('noteOff', { note: 36, audioTime: 1.125 });
    expect(named('open303_push_event').map((c) => c.args.slice(0, 3))).toEqual([
      [48000, 1, 36],
      [54000, 2, 36],
    ]);
  });

  it('pushes a noteOn without audioTime for frame 0 — the next block (live keyboard)', () => {
    send('noteOn', { note: 48, velocity: 100 });
    expect(named('open303_push_event')[0].args.slice(0, 3)).toEqual([0, 1, 48]);
  });

  it('keeps a param and a noteOn for the same time in posting order', () => {
    send('param', { func: 'jc303_setCutoff', value: 0.3, audioTime: 1.02 });
    send('noteOn', { note: 36, velocity: 100, audioTime: 1.02 });
    expect(named('open303_push_event').map((c) => c.args.slice(0, 4))).toEqual([
      [48960, 4, 2, 0.3], // kParam, OPEN303_CUTOFF
      [48960, 1, 36, 100],
    ]);
  });

  it('renders the voice for the block that starts at currentFrame, into both channels', () => {
    const [left, right] = render(96000);
    expect(named('open303_render')).toEqual([{ fn: 'open303_render', h: OPEN303, args: [96000, BLOCK] }]);
    expect(left[0]).toBeCloseTo(0.1, 6);
    expect(right[BLOCK - 1]).toBeCloseTo(0.1, 6);
  });

  it('allNotesOff cancels what is still scheduled, then releases on the next block', () => {
    send('noteOn', { note: 38, velocity: 100, audioTime: 2.0 });
    send('allNotesOff');
    expect(calls.map((c) => c.fn)).toEqual([
      'open303_push_event',
      'open303_cancel_notes',
      'open303_push_event',
    ]);
    expect(calls[2].args.slice(0, 2)).toEqual([0, 3]); // frame 0, kAllNotesOff
  });

  it('an engine switch quiets the old voice and routes everything after it to the new one', () => {
    send('noteOn', { note: 36, velocity: 100, audioTime: 1.0 });
    send('set-engine', { engine: 'jc303' });
    expect(calls.slice(1).map((c) => `${c.fn}:${c.h}`)).toEqual([
      `open303_cancel_notes:${OPEN303}`,
      `open303_flush:${OPEN303}`,
      `open303_all_notes_off:${OPEN303}`,
    ]);

    calls = [];
    send('noteOn', { note: 40, velocity: 100, audioTime: 1.2 });
    send('param', { func: 'jc303_setResonance', value: 0.5, audioTime: 1.2 });
    render(57600);
    expect(calls.map((c) => `${c.fn}:${c.h}`)).toEqual([
      `jc303_push_event:${JC303}`,
      `jc303_push_event:${JC303}`,
      `jc303_render:${JC303}`,
    ]);
  });

  it('an idle voice gets params immediately, the rendered one on their frame', () => {
    send('set-303-model', { model: 'live-highfid' });
    send('set-303-model', { model: 'stock-open303' });
    calls = [];
    // The live high-fid voice still exists but is idle; open303 renders.
    send('param', { func: 'jc303_setDecay', value: 0.2, audioTime: 3.0 });
    expect(calls.map((c) => `${c.fn}:${c.h}`)).toEqual([
      `highfid303_set_param:${HIGHFID}`,
      `open303_push_event:${OPEN303}`,
    ]);
    expect(calls[1].args.slice(0, 3)).toEqual([144000, 4, 5]);
  });

  it('live A/B pushes every note to both sides and renders stock then high-fid', () => {
    send('set-303-model', { model: 'live-highfid' });
    send('set-live-ab', { armed: true });
    calls = [];
    send('noteOn', { note: 45, velocity: 127, audioTime: 2.5 });
    render(120000);
    expect(calls.map((c) => `${c.fn}:${c.h}`)).toEqual([
      `open303_push_event:${OPEN303}`,
      `highfid303_push_event:${HIGHFID}`,
      `open303_render:${OPEN303}`,
      `highfid303_render:${HIGHFID}`,
    ]);

    calls = [];
    send('set-live-ab', { armed: false });
    // Side A stops rendering: its pending notes go, its params land, it resets.
    expect(calls.map((c) => `${c.fn}:${c.h}`)).toEqual([
      `open303_cancel_notes:${OPEN303}`,
      `open303_flush:${OPEN303}`,
      `open303_all_notes_off:${OPEN303}`,
    ]);
  });
});
