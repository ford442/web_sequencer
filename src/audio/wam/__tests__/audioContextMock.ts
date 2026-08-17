import { vi } from 'vitest';

/** Unique-node AudioContext mock so WAM slot ports are distinct GainNodes. */
export function makeWamTestAudioContext(): AudioContext {
  const makeGain = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: { value: 1, setValueAtTime: vi.fn() },
  });
  const makeOsc = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: { value: 440, setValueAtTime: vi.fn() },
  });
  return {
    currentTime: 0,
    sampleRate: 48000,
    destination: { connect: vi.fn(), disconnect: vi.fn() },
    createGain: vi.fn(makeGain),
    createOscillator: vi.fn(makeOsc),
    createWaveShaper: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), curve: null, oversample: 'none' })),
    createBiquadFilter: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      type: 'lowpass',
      frequency: { setValueAtTime: vi.fn() },
      Q: { setValueAtTime: vi.fn() },
      gain: { setValueAtTime: vi.fn(), value: 0 },
    })),
    createDynamicsCompressor: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      threshold: { setValueAtTime: vi.fn() },
      knee: { setValueAtTime: vi.fn() },
      ratio: { setValueAtTime: vi.fn() },
      attack: { setValueAtTime: vi.fn() },
      release: { setValueAtTime: vi.fn() },
    })),
    createStereoPanner: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      pan: { setValueAtTime: vi.fn() },
    })),
    createAnalyser: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 256,
      smoothingTimeConstant: 0.5,
    })),
    createConvolver: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), buffer: null })),
    createDelay: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      delayTime: { value: 0 },
    })),
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
  } as unknown as AudioContext;
}
