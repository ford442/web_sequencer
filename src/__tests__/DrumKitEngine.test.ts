/**
 * Tests for DrumKitEngine and DrumKitPresets
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logEngineFallback } = vi.hoisted(() => ({ logEngineFallback: vi.fn() }));

vi.mock('@/utils/engineTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/engineTelemetry')>();
  return { ...actual, logEngineFallback };
});

import { DrumKitEngine, drumPanGains } from '@/engines/DrumKitEngine';
import { EventBus } from '@/audio/controlPlane/EventBus';
import type { VoiceEventRoute } from '@/audio/controlPlane/VoiceEventRoute';
import { EventType, createEventRecord, type EventRecord } from '@/shared/rt/eventLayout';
import { EventRingReader, formatEventRing } from '@/shared/rt/eventRing';
import { EVENT_BATCH_MESSAGE, EventInbox, type RingTransport } from '@/shared/rt/eventTransport';
import { DrumkitEvent, VoiceEvent } from '@/shared/rt/hyphonNativeExports';
import { DRUM_KIT_PRESETS, getDrumKitDefaults, PRESET_808, PRESET_909 } from '@/engines/DrumKitPresets';

function mockAudioGraph() {
  const gain = {
    connect: vi.fn(),
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  };
  const osc = {
    type: 'sine',
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  };
  const createOscillator = vi.fn(() => osc);
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    createOscillator,
    createGain: vi.fn(() => gain),
    createBiquadFilter: vi.fn(() => ({
      type: 'bandpass',
      frequency: { value: 0 },
      Q: { value: 0 },
      connect: vi.fn(),
    })),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
  } as unknown as AudioContext;
  const masterGain = { connect: vi.fn() } as unknown as GainNode;
  return { context, masterGain, osc, createOscillator };
}

describe('DrumKitPresets', () => {
  it('provides 808 and 909 presets', () => {
    expect(DRUM_KIT_PRESETS['808']).toBeDefined();
    expect(DRUM_KIT_PRESETS['909']).toBeDefined();
  });

  it('808 preset has deeper kick (lower pitch)', () => {
    expect(PRESET_808.kick.pitch).toBeLessThan(PRESET_909.kick.pitch);
  });

  it('808 preset has longer kick decay', () => {
    expect(PRESET_808.kick.decay).toBeGreaterThan(PRESET_909.kick.decay);
  });

  it('909 preset has higher snare tone', () => {
    expect(PRESET_909.snare.tone).toBeGreaterThan(PRESET_808.snare.tone);
  });

  it('909 preset has more snare noise (crispier)', () => {
    expect(PRESET_909.snare.noise).toBeGreaterThan(PRESET_808.snare.noise);
  });

  it('getDrumKitDefaults returns correct preset', () => {
    const defaults808 = getDrumKitDefaults('808');
    expect(defaults808.name).toBe('TR-808');
    expect(defaults808.kick.pitch).toBe(50);

    const defaults909 = getDrumKitDefaults('909');
    expect(defaults909.name).toBe('TR-909');
    expect(defaults909.kick.pitch).toBe(65);
  });
});

describe('DrumKitEngine', () => {
  beforeEach(() => {
    logEngineFallback.mockClear();
  });

  it('initializes with default 808 kit', () => {
    const engine = new DrumKitEngine();
    expect(engine.kitType).toBe('808');
  });

  it('initializes with specified kit type', () => {
    const engine = new DrumKitEngine('909');
    expect(engine.kitType).toBe('909');
  });

  it('setKit changes the active kit', () => {
    const engine = new DrumKitEngine('808');
    expect(engine.kitType).toBe('808');
    engine.setKit('909');
    expect(engine.kitType).toBe('909');
    engine.setKit('808');
    expect(engine.kitType).toBe('808');
  });

  it('Web Audio fallback creates oscillators per kick hit', () => {
    const engine = new DrumKitEngine('808');
    const { context, masterGain, createOscillator } = mockAudioGraph();
    engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 0);
    expect(createOscillator).toHaveBeenCalled();
    expect(engine.isWorkletReady).toBe(false);
  });

  /** A voice's native ring as hyphon_native lays it out: at an offset of a bigger shared memory. */
  function voiceRingOffer(capacity = 16): RingTransport {
    const memory = new SharedArrayBuffer(8192);
    formatEventRing(memory, 1024, capacity);
    return { kind: 'ring', buffer: memory, byteOffset: 1024 };
  }

  const routeOf = (engine: DrumKitEngine) => (engine as unknown as { events: VoiceEventRoute }).events;

  /**
   * A kit whose worklet is "ready" on a bus of our own (#1497): hits go out as
   * control-plane records, read back here through the worklet's side —
   * batched messages through its inbox, or the voice's own ring, which the
   * ready message offered and the route adopted (P2).
   */
  function workletKit(kind: 'message' | 'voice ring') {
    const bus = new EventBus({ autoFlush: false });
    const engine = new DrumKitEngine('808', bus);
    const postMessage = vi.fn();
    const port = { postMessage };
    const route = routeOf(engine);
    const transport = route.open(port, { sampleRate: 48000, sharedMemory: kind !== 'message', voiceRing: true });
    let inbox = new EventInbox(transport);
    if (kind === 'voice ring') {
      const offer = voiceRingOffer();
      expect(route.adopt(offer)).toBe(true);
      inbox = new EventInbox(offer); // the C++ voice's side of its own ring
    }
    Object.assign(engine, { wasmReady: true, workletNode: { port } });
    /** Deliver what was posted to the worklet, then drain its inbox. */
    const received = () => {
      bus.flushAll();
      for (const [msg] of postMessage.mock.calls) inbox.receive(msg);
      postMessage.mockClear();
      const out: EventRecord[] = [];
      for (let e = createEventRecord(); inbox.pop(e); e = createEventRecord()) out.push(e);
      return out;
    };
    return { engine, postMessage, received };
  }

  it.each(['message', 'voice ring'] as const)(
    'worklet path (%s transport): a hit is a pan + trigger record on its frame, no oscillators',
    (kind) => {
      const { engine, postMessage, received } = workletKit(kind);
      const { context, masterGain, createOscillator } = mockAudioGraph();
      engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 1.25);
      expect(createOscillator).not.toHaveBeenCalled();
      if (kind === 'voice ring') {
        // Written in place: nothing to post, even after a flush.
        engine['events'].bus.flushAll();
        expect(postMessage).not.toHaveBeenCalled();
      }
      const f = Math.fround;
      expect(received()).toEqual([
        { frame: 60000, type: DrumkitEvent.SetPan, target: 0, value: 0, a0: 0, a1: 0, a2: 0, a3: 0 },
        {
          frame: 60000,
          type: VoiceEvent.Trigger,
          target: 0,
          value: 1,
          a0: f(PRESET_808.kick.pitch),
          a1: f(PRESET_808.kick.decay),
          a2: f(PRESET_808.kick.tone),
          a3: f(PRESET_808.kick.volume),
        },
      ]);
    },
  );

  it('a hit carries its pan to the worklet: the step pan overrides the sound\'s own', () => {
    const { engine, received } = workletKit('message');
    const { context, masterGain } = mockAudioGraph();
    const panned = { ...PRESET_808.closedHat, pan: 0.25 };
    engine.play(context, masterGain, null, 'closedHat', panned, 1);
    engine.play(context, masterGain, null, 'closedHat', panned, 2, -1);
    const pans = received().filter((e) => e.type === DrumkitEvent.SetPan).map((e) => e.value);
    expect(pans).toEqual([0.25, -1]);
  });

  it('message transport: hits are staged, not posted one by one; a flush posts them as one batch', () => {
    const { engine, postMessage } = workletKit('message');
    const { context, masterGain } = mockAudioGraph();
    engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 1);
    engine.play(context, masterGain, null, 'snare', PRESET_808.snare, 1);
    expect(postMessage).not.toHaveBeenCalled();
    engine['events'].bus.flushAll();
    expect(postMessage.mock.calls.map(([m]) => (m as { type: string }).type)).toEqual([EVENT_BATCH_MESSAGE]);
    expect((postMessage.mock.calls[0][0] as { count: number }).count).toBe(4);
  });

  it.each(['message', 'voice ring'] as const)(
    '%s transport: a stop is a CANCEL_NOTES record behind the hits it cancels, ahead of a restart\'s',
    (kind) => {
      const { engine, postMessage, received } = workletKit(kind);
      const { context, masterGain } = mockAudioGraph();
      engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 1);
      engine.cancelPending();
      engine.play(context, masterGain, null, 'snare', PRESET_808.snare, 1.5);
      const posted = () => postMessage.mock.calls.map(([m]) => (m as { type: string }).type);
      expect(posted()).not.toContain('allNotesOff');
      expect(received().map((e) => [e.type, e.frame])).toEqual([
        [DrumkitEvent.SetPan, 48000],
        [VoiceEvent.Trigger, 48000],
        [EventType.CancelNotes, 0],
        [DrumkitEvent.SetPan, 72000],
        [VoiceEvent.Trigger, 72000],
      ]);
    },
  );

  it('dispose closes the route: later hits go nowhere', () => {
    const { engine, received } = workletKit('voice ring');
    const { context, masterGain } = mockAudioGraph();
    Object.assign(engine, { workletNode: null });
    engine.dispose();
    expect(routeOf(engine).isOpen).toBe(false);
    Object.assign(engine, { wasmReady: true, workletNode: { port: { postMessage: vi.fn() } } });
    engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 1);
    expect(received()).toEqual([]);
  });

  /**
   * The real init handshake against a stand-in worklet: init-wasm carries the
   * route's message transport; the ready reply may offer the voice's ring.
   */
  async function initKit(offer: RingTransport | undefined) {
    const bus = new EventBus({ autoFlush: false });
    const engine = new DrumKitEngine('808', bus);
    const posted: Array<{ type: string; data?: { events?: unknown } }> = [];
    class FakeNode {
      readonly port = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        postMessage: (msg: { type: string; data?: { events?: unknown } }) => {
          posted.push(msg);
          if (msg.type === 'init-wasm') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready', events: offer } }));
        },
        close: vi.fn(),
      };
      connect = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('AudioWorkletNode', FakeNode);
    try {
      const context = { sampleRate: 48000, audioWorklet: { addModule: vi.fn(async () => {}) } } as unknown as AudioContext;
      const artifact = { sharedMemory: offer !== undefined, threading: offer ? 'pthread' : 'st', minMemoryPages: 1 };
      const ok = await engine.initWithWasmBytes(
        context,
        'drumkit-processor.js',
        {} as AudioNode,
        new ArrayBuffer(8),
        {},
        artifact as unknown as Parameters<DrumKitEngine['initWithWasmBytes']>[5],
      );
      expect(ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    return { engine, bus, posted };
  }

  it('init: the route starts on batched messages and moves into the voice ring the ready message offers', async () => {
    const offer = voiceRingOffer();
    const { engine, bus, posted } = await initKit(offer);
    expect(posted[0].type).toBe('init-wasm');
    expect(posted[0].data?.events).toEqual({ kind: 'message', capacity: 256 });
    expect(routeOf(engine).inPlace).toBe(true);

    const { context, masterGain } = mockAudioGraph();
    engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 1);
    bus.flushAll();
    expect(posted.map((m) => m.type)).toEqual(['init-wasm', 'set-kit']); // no batch: the hit is in the ring
    const voice = new EventRingReader(offer.buffer, offer.byteOffset);
    expect(voice.size).toBe(2);
  });

  it('init without an offer (single-threaded build): the route stays on batched messages', async () => {
    const { engine, bus, posted } = await initKit(undefined);
    expect(routeOf(engine).inPlace).toBe(false);
    const { context, masterGain } = mockAudioGraph();
    engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 1);
    bus.flushAll();
    expect(posted.map((m) => m.type)).toEqual(['init-wasm', 'set-kit', EVENT_BATCH_MESSAGE]);
  });

  it('fallback: a panned hit goes through a two-gain merger; a centred one connects straight', () => {
    const engine = new DrumKitEngine('808');
    const { context, masterGain } = mockAudioGraph();
    const merger = { connect: vi.fn() };
    const createChannelMerger = vi.fn(() => merger);
    Object.assign(context, { createChannelMerger });
    engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 0);
    expect(createChannelMerger).not.toHaveBeenCalled();
    engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 0, 0.5);
    expect(createChannelMerger).toHaveBeenCalledWith(2);
    expect(merger.connect).toHaveBeenCalledWith(masterGain);
  });

  it('records a HUD fallback reason when WASM drums cannot load', async () => {
    const engine = new DrumKitEngine();
    const { context, masterGain } = mockAudioGraph();
    const ok = await engine.init(context, '', masterGain);
    expect(ok).toBe(false);
    expect(engine.fallbackReason).toMatch(/worklet URL missing|AudioWorklet unavailable/);
    expect(logEngineFallback).toHaveBeenCalled();
    expect(logEngineFallback.mock.calls[0][0]).toBe('drumkit');
  });

  it('constructs at most one worklet node for the whole kit', () => {
    const engine = new DrumKitEngine();
    expect(engine.workletInstanceCount).toBe(0);
  });
});

describe('drumPanGains (same law as panGains() in drumkit_wrapper.cpp)', () => {
  it('is exactly unity at the centre, so an unpanned kit is unchanged', () => {
    expect(drumPanGains(0)).toEqual([1, 1]);
    expect(drumPanGains(undefined)).toEqual([1, 1]);
    expect(drumPanGains(Number.NaN)).toEqual([1, 1]);
  });

  it('is constant power and hard-pans to one side at +3 dB', () => {
    for (const pan of [-1, -0.5, -0.1, 0.3, 0.75, 1]) {
      const [l, r] = drumPanGains(pan);
      expect(l * l + r * r).toBeCloseTo(2, 6);
    }
    const [l, r] = drumPanGains(1);
    expect(l).toBeCloseTo(0, 6);
    expect(r).toBeCloseTo(Math.SQRT2, 6);
    expect(drumPanGains(-3)).toEqual(drumPanGains(-1));
  });
});
