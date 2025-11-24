import '@testing-library/jest-dom/vitest'

// Mock Web Worker
class Worker {
  url: string;
  onmessage: (e: MessageEvent) => void;

  constructor(stringUrl: string) {
    this.url = stringUrl;
    this.onmessage = () => {};
  }

  postMessage(msg: any) {
    // Basic echo for testing
    if (msg === 'start') {
        // Mock a tick response async
        setTimeout(() => {
           this.onmessage({ data: 'tick' } as MessageEvent);
        }, 10);
    }
  }

  terminate() {}
}

global.Worker = Worker as any;

// Mock URL
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = () => 'mock-url';
}

// Mock AudioContext
class AudioContext {
    state = 'running';
    sampleRate = 44100;
    currentTime = 0;
    destination = {};
    createGain = () => ({
        gain: {
            setValueAtTime: () => {},
            linearRampToValueAtTime: () => {}
        },
        connect: () => {}
    });
    createStereoPanner = () => ({
        pan: { setValueAtTime: () => {} },
        connect: () => {}
    });
    createBuffer = () => ({
        getChannelData: () => new Float32Array(128)
    });
    createBufferSource = () => ({
        buffer: null,
        connect: () => {},
        start: () => {},
        stop: () => {}
    });
    createDelay = () => ({
        delayTime: { setValueAtTime: () => {} },
        connect: () => {}
    });
    createBiquadFilter = () => ({
        frequency: { setValueAtTime: () => {} },
        Q: { setValueAtTime: () => {} },
        connect: () => {}
    });
    createOscillator = () => ({
        frequency: { setValueAtTime: () => {} },
        connect: () => {},
        start: () => {},
        stop: () => {}
    });
    resume = async () => {};
}
global.AudioContext = AudioContext as any;
global.webkitAudioContext = AudioContext as any;
