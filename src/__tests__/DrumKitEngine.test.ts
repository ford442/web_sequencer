/**
 * Tests for DrumKitEngine and DrumKitPresets
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logEngineFallback } = vi.hoisted(() => ({ logEngineFallback: vi.fn() }));

vi.mock('../utils/engineTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/engineTelemetry')>();
  return { ...actual, logEngineFallback };
});

import { DrumKitEngine } from '../engines/DrumKitEngine';
import { DRUM_KIT_PRESETS, getDrumKitDefaults, PRESET_808, PRESET_909 } from '../engines/DrumKitPresets';

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
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    createOscillator: vi.fn(() => osc),
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
  return { context, masterGain, osc };
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
    const { context, masterGain } = mockAudioGraph();
    engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 0);
    expect(context.createOscillator).toHaveBeenCalled();
    expect(engine.isWorkletReady).toBe(false);
  });

  it('worklet path does not create oscillators per hit', () => {
    const engine = new DrumKitEngine('808');
    const postMessage = vi.fn();
    (engine as unknown as { wasmReady: boolean; workletNode: { port: { postMessage: typeof postMessage } } }).wasmReady = true;
    (engine as unknown as { workletNode: { port: { postMessage: typeof postMessage } } }).workletNode = {
      port: { postMessage },
    };
    const { context, masterGain } = mockAudioGraph();
    engine.play(context, masterGain, null, 'kick', PRESET_808.kick, 1.25);
    expect(context.createOscillator).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      type: 'trigger',
      data: {
        voice: 0,
        velocity: 1,
        a: PRESET_808.kick.pitch,
        b: PRESET_808.kick.decay,
        c: PRESET_808.kick.tone,
        d: PRESET_808.kick.volume,
        audioTime: 1.25,
      },
    });
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
