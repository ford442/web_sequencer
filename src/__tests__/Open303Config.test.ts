import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Open303Oscillator } from '../engines/Open303Oscillator';

// Mock WebAssembly.compile and Module.imports to avoid needing a real WASM binary
const mockWasmModule = {} as WebAssembly.Module;
vi.stubGlobal('WebAssembly', {
    ...WebAssembly,
    compile: vi.fn().mockResolvedValue(mockWasmModule),
    Module: {
        imports: vi.fn().mockReturnValue([]),
    },
});

// Mock fetch for WASM files
global.fetch = vi.fn((url: string) => {
    if (typeof url === 'string' && (url.includes('jc303-single.wasm') || url.includes('jc303-threaded.wasm'))) {
        return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048))
        } as Response);
    }
    return Promise.resolve({
        ok: false,
        status: 404
    } as Response);
}) as any;

describe('Open303 Oscillator', () => {
    let mockAudioContext: AudioContext;
    let mockWorkletNode: any;

    beforeEach(() => {
        mockWorkletNode = {
            port: {
                postMessage: vi.fn(),
                onmessage: null as ((ev: any) => void) | null,
                close: vi.fn()
            },
            connect: vi.fn(),
            disconnect: vi.fn()
        };

        // Intercept onmessage setter to fire 'ready' once the handler is installed
        let onmessageHandler: ((ev: any) => void) | null = null;
        Object.defineProperty(mockWorkletNode.port, 'onmessage', {
            get() { return onmessageHandler; },
            set(handler: ((ev: any) => void) | null) {
                onmessageHandler = handler;
                // Once the init code sets onmessage, simulate the worklet replying
                if (handler) {
                    setTimeout(() => handler({ data: { type: 'ready' } }), 0);
                }
            },
            configurable: true
        });

                                mockAudioContext = {
            createGain: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                gain: { value: 1.0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() }
            })),
            createBiquadFilter: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                type: 'lowpass',
                frequency: { value: 1000, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
                Q: { value: 10 }
            })),
            createOscillator: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                type: 'sawtooth',
                frequency: { value: 440, setTargetAtTime: vi.fn() },
                start: vi.fn(),
                stop: vi.fn()
            })),
            createBiquadFilter: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                type: 'lowpass',
                frequency: { value: 1000 },
                Q: { value: 1.0 }
            })),
            sampleRate: 44100,
            currentTime: 0,
            audioWorklet: {
                addModule: vi.fn().mockResolvedValue(undefined)
            }
        } as any;

        // Mock AudioWorkletNode constructor
        global.AudioWorkletNode = vi.fn().mockImplementation(() => mockWorkletNode) as any;
    });

    it('should initialize successfully', async () => {
        const engine = new Open303Oscillator();
        const success = await engine.init(mockAudioContext, 'worklet-url.js');

        expect(success).toBe(true);
        expect(engine.isReady).toBe(true);

        // Verify fetch was called for WASM (defaults to single-threaded)
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('jc303-single.wasm'));

        // Verify addModule was called
        expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalledWith('worklet-url.js');

        // Verify init-wasm message was sent
        expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'init-wasm',
            data: expect.objectContaining({
                sampleRate: 44100
            })
        }));
    });

    it('should send noteOn messages', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');

        engine.noteOn(60, 100);
        expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith({
            type: 'noteOn',
            data: { note: 60, velocity: 100 }
        });
    });

    it('should send noteOff messages', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');

        engine.noteOff(60);
        expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith({
            type: 'noteOff',
            data: { note: 60 }
        });
    });

    it('should send param updates', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');

        engine.setCutoff(0.5);
        engine.setFilterMode(1);
        expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith({
            type: 'param',
            data: { func: 'jc303_setCutoff', value: 0.5 }
        });
        expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith({
            type: 'param',
            data: { func: 'jc303_setFilterMode', value: 1 }
        });
    });

    it('should handle initialization failure gracefully', async () => {
        // Mock fetch failure — engine activates FallbackBassSynth and returns true
        (global.fetch as any).mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404 }));

        const engine = new Open303Oscillator();
        const success = await engine.init(mockAudioContext, 'worklet-url.js');

        expect(success).toBe(true);
        expect(engine.isReady).toBe(true);
        expect(engine.isFallback).toBe(true);
    });
});
