
// setup.ts
import '@testing-library/jest-dom';

// Mock Worker
class Worker {
    url: string;
    onmessage: (msg: any) => void;
    constructor(stringUrl: string) {
        this.url = stringUrl;
        this.onmessage = () => {};
    }
    postMessage(msg: any) {
        // Echo ready for pyodide
        if(msg.type === 'init') {
            setTimeout(() => this.onmessage({ data: { type: 'ready' } }), 10);
        }
    }
    terminate() {}
}
global.Worker = Worker as any;

// Mock URL
global.URL = class URL {
    constructor(url: string) { return { href: url } as any; }
    static createObjectURL() { return ""; }
    static revokeObjectURL() { }
} as any;

// Mock AudioContext
global.AudioContext = class AudioContext {
    currentTime = 0;
    createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }; }
    createOscillator() { return { frequency: { setValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} }; }
    createBiquadFilter() { return { frequency: { setValueAtTime: () => {} }, Q: { setValueAtTime: () => {} }, connect: () => {} }; }
    createBufferSource() { return { buffer: null, connect: () => {}, start: () => {}, stop: () => {}, playbackRate: { setValueAtTime: () => {} } }; }
    decodeAudioData() { return Promise.resolve({}); }
    createBuffer() { return { getChannelData: () => new Float32Array(128) }; }
    resume() { return Promise.resolve(); }
} as any;

// Mock RequestAnimationFrame
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// Mock window.confirm
global.confirm = () => true;
