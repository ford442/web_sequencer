import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetHyphonNativeSessionForTests } from '../hyphonNativeSession';

/**
 * #1344 acceptance, end to end in Node: the real worklet bundles
 * (drumkit-processor, open303-processor, prophecy-processor) on the real
 * hyphon_native.st.wasm, a kick, a 303 note and a Prophecy note posted for the
 * same audioTime — and each starts on the same sample, wherever that time
 * falls in the 128-frame block. Before the voice core, the 303 note played
 * whenever its message landed and drums waited for the next block boundary.
 *
 * Integration tier (vitest.integration.files.ts): CI builds the native module
 * first and sets HYPHON_REQUIRE_NATIVE=1, which turns a missing build into a
 * failure; elsewhere the suite skips without one.
 */

const WASM = resolve(__dirname, '../../../public/hyphon_native.st.wasm');
const MAP = resolve(__dirname, '../../../public/hyphon_wasm_export_map.st.json');
const SAMPLE_RATE = 48000;
const BLOCK = 128;

class FakePort {
  onmessage: ((e: MessageEvent) => unknown) | null = null;
  readonly posted: Array<{ type: string; error?: string }> = [];
  postMessage(msg: { type: string }) {
    // The clock reuses one message object — keep a copy.
    this.posted.push({ ...msg });
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
const g = globalThis as {
  currentFrame?: number;
  currentTime?: number;
  sampleRate?: number;
  AudioWorkletProcessor?: new () => { port: FakePort };
  registerProcessor?: (name: string, ctor: VoiceCtor) => void;
};

const haveWasm = existsSync(WASM) && existsSync(MAP);
const nativeRequired = process.env.HYPHON_REQUIRE_NATIVE === '1';

beforeAll(async () => {
  g.AudioWorkletProcessor = class {
    readonly port = new FakePort();
  };
  g.registerProcessor = (name, ctor) => registered.set(name, ctor);
  g.sampleRate = SAMPLE_RATE;
  await import('../drumkit-processor');
  await import('../open303-processor');
  await import('../prophecy-processor');
  await import('../clock-processor');
});

afterAll(() => {
  delete g.currentFrame;
  delete g.currentTime;
  delete g.sampleRate;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetHyphonNativeSessionForTests();
});

async function bootVoices() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const wasm = readFileSync(WASM);
  const init = () => ({
    type: 'init-wasm',
    data: {
      wasmBytes: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
      sampleRate: SAMPLE_RATE,
      isThreaded: false,
      variant: 'st',
      exportMap: JSON.parse(readFileSync(MAP, 'utf8')) as Record<string, string>,
    },
  });
  const make = async (name: string) => {
    const v = new (registered.get(name)!)();
    await v.port.deliver(init());
    expect(v.port.posted.map((m) => m.type), `${name}: ${JSON.stringify(v.port.posted)}`).toContain('ready');
    return v;
  };
  return {
    drums: await make('drumkit-processor'),
    bass: await make('open303-processor'),
    lead: await make('prophecy-processor'),
  };
}

/** Render `blocks` from `startFrame` and return each voice's left channel, concatenated. */
function renderAll(voices: Voice[], startFrame: number, blocks: number): Float32Array[] {
  const out = voices.map(() => new Float32Array(blocks * BLOCK));
  for (let b = 0; b < blocks; b++) {
    g.currentFrame = startFrame + b * BLOCK;
    voices.forEach((v, i) => {
      const left = new Float32Array(BLOCK);
      const right = new Float32Array(BLOCK);
      v.process([], [[left, right], [new Float32Array(BLOCK), new Float32Array(BLOCK)]], {});
      out[i].set(left, b * BLOCK);
    });
  }
  return out;
}

const firstNonZero = (a: Float32Array) => a.findIndex((s) => s !== 0);
const firstDifference = (a: Float32Array, b: Float32Array) => a.findIndex((s, i) => s !== b[i]);

it.skipIf(!nativeRequired)('has the native build when HYPHON_REQUIRE_NATIVE=1', () => {
  expect(haveWasm, `${WASM} missing — build native for the integration tier`).toBe(true);
});

describe.skipIf(!haveWasm)('voice timing on the real hyphon_native.st.wasm (#1344)', () => {
  it('a kick, a 303 note and a Prophecy note on one audioTime start on the same sample', async () => {
    const start = SAMPLE_RATE * 2; // block-aligned: frame 96000
    const lag: Record<string, number[]> = { kick: [], bass: [], lead: [] };
    for (const offset of [0, 1, 37, 127]) {
      // A reference render without the notes: Prophecy is not silent at rest.
      const ref = await bootVoices();
      const [, , leadRef] = renderAll([ref.drums, ref.bass, ref.lead], start, 8);
      resetHyphonNativeSessionForTests();

      const { drums, bass, lead } = await bootVoices();
      // The authentic jc303 voice: silent until its amp envelope opens. (The
      // custom open303 engine drones between notes, and its ladder filter
      // keeps a pitch change below float resolution for a few samples — a
      // first-difference onset would measure the filter, not the event.)
      await bass.port.deliver({ type: 'set-engine', data: { engine: 'jc303' } });
      const at = start + 2 * BLOCK + offset;
      const audioTime = at / SAMPLE_RATE;
      await drums.port.deliver({ type: 'trigger', data: { voice: 0, velocity: 1, a: 50, b: 0.6, c: 0.6, d: 1, audioTime } });
      await bass.port.deliver({ type: 'noteOn', data: { note: 36, velocity: 100, audioTime } });
      await lead.port.deliver({ type: 'noteOn', data: { note: 57, velocity: 100, audioTime } });
      const [kick, bassOut, leadOut] = renderAll([drums, bass, lead], start, 8);

      const frame = at - start;
      lag.kick.push(firstNonZero(kick) - frame);
      lag.bass.push(firstNonZero(bassOut) - frame);
      lag.lead.push(firstDifference(leadOut, leadRef) - frame);
      resetHyphonNativeSessionForTests();
    }
    // Every voice sounds on the event's own sample, at every in-block offset.
    expect(lag).toEqual({ kick: [0, 0, 0, 0], bass: [0, 0, 0, 0], lead: [0, 0, 0, 0] });
  });

  it('a 303 noteOff waits for its frame: the gate closes on the step boundary, not on arrival', async () => {
    // jc303 (rosic) has an amp envelope that releases on noteOff: a gate that
    // closed on arrival — the pre-#1344 behaviour — would cut the note short.
    const run = async (gateFrames: number) => {
      const { bass } = await bootVoices();
      await bass.port.deliver({ type: 'set-engine', data: { engine: 'jc303' } });
      const start = SAMPLE_RATE;
      const on = start + 64;
      await bass.port.deliver({ type: 'noteOn', data: { note: 36, velocity: 100, audioTime: on / SAMPLE_RATE } });
      await bass.port.deliver({ type: 'noteOff', data: { note: 36, audioTime: (on + gateFrames) / SAMPLE_RATE } });
      const [out] = renderAll([bass], start, 64);
      resetHyphonNativeSessionForTests();
      return out;
    };
    const long = await run(6000);
    const short = await run(600);
    // Identical until the shorter gate closes, then they part.
    expect(firstDifference(long, short)).toBe(64 + 600);
  });

  it('a timed Prophecy note sounds, then releases to silence; untimed, its noteOff lands first', async () => {
    const run = async (timed: boolean) => {
      const { lead } = await bootVoices();
      const start = SAMPLE_RATE;
      const on = timed ? (start + 2 * BLOCK) / SAMPLE_RATE : undefined;
      const off = timed ? (start + 2 * BLOCK + 4800) / SAMPLE_RATE : undefined;
      // What ProphecyManager posts for one sequenced step: both up front.
      await lead.port.deliver({ type: 'noteOn', data: { note: 57, velocity: 100, audioTime: on } });
      await lead.port.deliver({ type: 'noteOff', data: { note: 57, audioTime: off } });
      const [out] = renderAll([lead], start, 1200); // 3.2 s: past the 0.5 s release
      resetHyphonNativeSessionForTests();
      const peak = (a: Float32Array) => a.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
      return { note: peak(out.subarray(0, SAMPLE_RATE / 2)), tail: peak(out.subarray(out.length - SAMPLE_RATE)) };
    };
    const timed = await run(true);
    expect(timed.note).toBeGreaterThan(0.05);
    expect(timed.tail).toBe(0);
    // Both on the next block's first frame: released before it sounded.
    expect((await run(false)).note).toBe(0);
  });

  /**
   * The whole chain (#1344 P5): the real clock worklet posts the steps, a
   * stand-in for the step handler schedules a kick, a jc303 note and a
   * Prophecy note on step 4 at the step's audioTime — exactly what playDrum /
   * playSynth post — and the voices render. Main-thread latency is modelled
   * as a ~2.7 ms round trip: what the clock posts while rendering block N is
   * handled after block N+1 has rendered. (Measured: with the 40 ms lookahead
   * all three start on frame 24616, the step; without, all on 24832.)
   */
  async function playStep4(lookaheadSec: number) {
    const ref = await bootVoices();
    const refRender = { lead: new Float32Array(0) };
    const { drums, bass, lead } = await bootVoices();
    await bass.port.deliver({ type: 'set-engine', data: { engine: 'jc303' } });

    const clock = new (registered.get('clock-processor')!)();
    // 117 BPM: a sixteenth is 6153.8 frames, so steps fall mid-block.
    await clock.port.deliver({ type: 'setTempo', tempo: 117 });
    await clock.port.deliver({ type: 'setSteps', steps: 16 });
    await clock.port.deliver({ type: 'setLookahead', lookahead: lookaheadSec });
    await clock.port.deliver({ type: 'start' });

    const start = SAMPLE_RATE * 2;
    const blocks = 220;
    const kick = new Float32Array(blocks * BLOCK);
    const bassOut = new Float32Array(blocks * BLOCK);
    const leadOut = new Float32Array(blocks * BLOCK);
    refRender.lead = new Float32Array(blocks * BLOCK);
    let stepFrame = -1;
    let inFlight: Array<{ step: number; audioTime: number }> = [];

    for (let b = 0; b < blocks; b++) {
      const frame = start + b * BLOCK;
      g.currentFrame = frame;
      g.currentTime = frame / SAMPLE_RATE;
      clock.port.posted.length = 0;
      clock.process([], [[new Float32Array(BLOCK)]], {});
      const posted = clock.port.posted as unknown as Array<{ type: string; step: number; audioTime: number }>;

      const out = (v: Voice, into: Float32Array) => {
        const left = new Float32Array(BLOCK);
        v.process([], [[left, new Float32Array(BLOCK)], [new Float32Array(BLOCK), new Float32Array(BLOCK)]], {});
        into.set(left, b * BLOCK);
      };
      out(drums, kick);
      out(bass, bassOut);
      out(lead, leadOut);
      out(ref.lead, refRender.lead);

      // The step handler runs now, on what the clock posted one block ago.
      for (const { step, audioTime } of inFlight) {
        if (step !== 4) continue;
        stepFrame = Math.round(audioTime * SAMPLE_RATE) - start;
        await drums.port.deliver({ type: 'trigger', data: { voice: 0, velocity: 1, a: 50, b: 0.6, c: 0.6, d: 1, audioTime } });
        await bass.port.deliver({ type: 'noteOn', data: { note: 36, velocity: 100, audioTime } });
        await lead.port.deliver({ type: 'noteOn', data: { note: 57, velocity: 100, audioTime } });
      }
      inFlight = posted.filter((m) => m.type === 'step').map((m) => ({ step: m.step, audioTime: m.audioTime }));
    }
    resetHyphonNativeSessionForTests();
    return {
      stepFrame,
      kick: firstNonZero(kick),
      bass: firstNonZero(bassOut),
      lead: firstDifference(leadOut, refRender.lead),
    };
  }

  it('with the clock lookahead, drums, 303 and Prophecy start on the step\'s own sample', async () => {
    const r = await playStep4(0.04);
    expect(r.stepFrame).toBeGreaterThan(0);
    expect(r.stepFrame % BLOCK).not.toBe(0); // a mid-block step
    expect({ kick: r.kick, bass: r.bass, lead: r.lead }).toEqual({ kick: r.stepFrame, bass: r.stepFrame, lead: r.stepFrame });
  });

  it('(control) without it, the same step lands late: the clock posts it as it falls', async () => {
    const r = await playStep4(0);
    expect(r.kick).toBeGreaterThan(r.stepFrame);
    expect(r.kick).toBe(r.bass);
    expect(r.kick).toBe(r.lead);
  });
});
