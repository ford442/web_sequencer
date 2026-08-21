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
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any;
    }
    connect() {}
    disconnect() {}
  }
  (window as any).AudioWorkletNode = AudioWorkletNode;

  // vitest 4 constructs mock implementations via Reflect.construct, so any mock
  // used with `new` must be a constructable function expression, not an arrow.
  window.AudioContext = vi.fn().mockImplementation(function () { return ({
    createGain: vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: {
        value: 0,
        setTargetAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
    }),
    createOscillator: vi.fn().mockReturnValue({
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    }),
    createDynamicsCompressor: vi.fn().mockReturnValue({
      connect: vi.fn(),
      threshold: { value: 0, setValueAtTime: vi.fn() },
      knee: { value: 0, setValueAtTime: vi.fn() },
      ratio: { value: 0, setValueAtTime: vi.fn() },
      attack: { value: 0, setValueAtTime: vi.fn() },
      release: { value: 0, setValueAtTime: vi.fn() },
    }),
    createBiquadFilter: vi.fn().mockReturnValue({
        connect: vi.fn(),
        frequency: { value: 0, setValueAtTime: vi.fn() },
        Q: { value: 0, setValueAtTime: vi.fn() },
        gain: { value: 0, setValueAtTime: vi.fn() },
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
    createConvolver: vi.fn().mockReturnValue({
        connect: vi.fn(),
        buffer: null,
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
  }); }) as any
}

// Mock Worker
if (typeof window !== 'undefined') {
    window.Worker = vi.fn().mockImplementation(function () { return ({
        postMessage: vi.fn(),
        terminate: vi.fn(),
        onmessage: null,
        onerror: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }); }) as any;
}


// Global mocks for WASM imports removed because they conflict with Vite alias stub

// Mock IndexedDB
if (typeof window !== 'undefined' && typeof window.indexedDB === 'undefined') {
    window.indexedDB = {
        open: vi.fn().mockReturnValue({
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: {
                createObjectStore: vi.fn(),
                transaction: vi.fn().mockReturnValue({
                    objectStore: vi.fn().mockReturnValue({
                        put: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
                        get: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
                        getAll: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
                        delete: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
                    }),
                    oncomplete: null,
                    onerror: null,
                })
            }
        })
    } as any;
}
