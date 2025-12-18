import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Mock AudioContext
if (typeof window !== 'undefined') {
  // Mock AudioWorkletNode
  class AudioWorkletNode {
    port: MessagePort;
    constructor() {
      this.port = {
        postMessage: vi.fn(),
        onmessage: null,
        start: vi.fn(),
        close: vi.fn(),
      } as any;
    }
    connect() {}
    disconnect() {}
  }
  (window as any).AudioWorkletNode = AudioWorkletNode;

  window.AudioContext = vi.fn().mockImplementation(() => ({
    createGain: vi.fn().mockReturnValue({
      connect: vi.fn(),
      gain: { value: 0, setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() },
    }),
    createOscillator: vi.fn().mockReturnValue({
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn() },
    }),
    createDynamicsCompressor: vi.fn().mockReturnValue({
      connect: vi.fn(),
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    }),
    createBiquadFilter: vi.fn().mockReturnValue({
        connect: vi.fn(),
        frequency: { value: 0, setValueAtTime: vi.fn() },
        Q: { value: 0, setValueAtTime: vi.fn() },
        type: 'lowpass'
    }),
    createAnalyser: vi.fn().mockReturnValue({
        connect: vi.fn(),
        fftSize: 2048,
        frequencyBinCount: 1024,
        getByteTimeDomainData: vi.fn(),
        getFloatTimeDomainData: vi.fn()
    }),
    createStereoPanner: vi.fn().mockReturnValue({
        connect: vi.fn(),
        pan: { value: 0, setValueAtTime: vi.fn() }
    }),
    destination: {},
    currentTime: 0,
    state: 'suspended',
    resume: vi.fn().mockResolvedValue(undefined),
    suspend: vi.fn().mockResolvedValue(undefined),
    createBuffer: vi.fn().mockImplementation((channels, length, sampleRate) => {
        const bufferLen = length || 1024;
        return {
            length: bufferLen,
            numberOfChannels: channels,
            sampleRate: sampleRate || 44100,
            getChannelData: vi.fn().mockReturnValue(new Float32Array(bufferLen)),
        };
    }),
    createScriptProcessor: vi.fn().mockReturnValue({
        connect: vi.fn(),
        onaudioprocess: null,
    }),
    createBufferSource: vi.fn().mockReturnValue({
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      buffer: null,
      loop: false,
    }),
    createDelay: vi.fn().mockReturnValue({
        connect: vi.fn(),
        delayTime: { value: 0, setValueAtTime: vi.fn() }
    }),
    createWaveShaper: vi.fn().mockReturnValue({
        connect: vi.fn(),
        curve: null,
        oversample: 'none'
    }),
    sampleRate: 44100,
    audioWorklet: {
      addModule: vi.fn().mockResolvedValue(undefined),
    },
    decodeAudioData: vi.fn().mockResolvedValue({
      length: 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: vi.fn().mockReturnValue(new Float32Array(44100)),
    }),
  })) as any
}

// Mock Worker
if (typeof window !== 'undefined') {
    window.Worker = vi.fn().mockImplementation(() => ({
        postMessage: vi.fn(),
        terminate: vi.fn(),
        onmessage: null,
        onerror: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })) as any;
}

