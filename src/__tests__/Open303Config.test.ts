import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { ProphecyOscillator } from '../engines/ProphecyOscillator';
import { resetHyphonWasmExportMapCache } from '../utils/engineTelemetry';

// Mock WebAssembly.compile and Module.imports to avoid needing a real WASM binary.
// Re-stubbed per test because afterEach unstubs the environment globals below.
const mockWasmModule = {} as WebAssembly.Module;
const realWebAssembly = WebAssembly;
function stubWebAssembly() {
    vi.stubGlobal('WebAssembly', {
        ...realWebAssembly,
        compile: vi.fn().mockResolvedValue(mockWasmModule),
        Module: {
            imports: vi.fn().mockReturnValue([]),
            exports: vi.fn().mockReturnValue([
                { name: 'da', kind: 'function' },
                { name: 'fa', kind: 'function' },
            ]),
        },
    });
}

function mockOpen303Fetch(url: string | Request | URL): Promise<Response> {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    // Both link profiles: hyphon_native.wasm (pthread) and hyphon_native.st.wasm.
    if (/hyphon_native(\.st)?\.wasm/.test(href)) {
        return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048)),
        } as Response);
    }
    if (/hyphon_wasm_export_map(\.st)?\.json/.test(href)) {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ open303_create: 'da', open303_init: 'fa' }),
        } as Response);
    }
    if (/hyphon_native(\.st)?\.js/.test(href)) {
        return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(''),
        } as Response);
    }
    return Promise.resolve({
        ok: false,
        status: 404,
    } as Response);
}

describe('Open303 Oscillator', () => {
    let mockAudioContext: AudioContext;
    let mockWorkletNode: any;

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        resetHyphonWasmExportMapCache();
        stubWebAssembly();
        vi.mocked(global.fetch).mockImplementation(mockOpen303Fetch as typeof fetch);

        mockWorkletNode = {
            port: {
                postMessage: vi.fn(),
                onmessage: null as ((ev: any) => void) | null,
                close: vi.fn(),
                addEventListener: vi.fn((event, handler) => {
                    if (event === 'message') {
                        setTimeout(() => handler({ data: { type: 'ready' } }), 0);
                    }
                }),
                removeEventListener: vi.fn(),
                start: vi.fn()
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
            sampleRate: 44100,
            currentTime: 0,
            audioWorklet: {
                addModule: vi.fn().mockResolvedValue(undefined)
            }
        } as any;

        // Mock AudioWorkletNode constructor (vitest 4 uses Reflect.construct,
        // so the implementation must be a constructable function, not an arrow).
        global.AudioWorkletNode = vi.fn().mockImplementation(function () { return mockWorkletNode; }) as any;
    });

    it('should initialize successfully', async () => {
        const engine = new Open303Oscillator();
        const success = await engine.init(mockAudioContext, 'worklet-url.js');

        expect(success).toBe(true);
        expect(engine.isReady).toBe(true);

        // Verify fetch was called for a hyphon_native build (the test env is not
        // crossOriginIsolated, so this is the single-threaded one)
        expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/hyphon_native(\.st)?\.wasm$/));

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
        mockWorkletNode.port.postMessage.mockClear();

        engine.noteOn(60, 100);
        expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith({
            type: 'noteOn',
            data: { note: 60, velocity: 100 }
        });
    });

    it('should send noteOff messages', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');
        mockWorkletNode.port.postMessage.mockClear();

        engine.noteOff(60);
        expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith({
            type: 'noteOff',
            data: { note: 60 }
        });
    });

    it('should send param updates', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');
        mockWorkletNode.port.postMessage.mockClear();

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
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
            Promise.resolve({ ok: false, status: 404 } as Response),
        );

        const engine = new Open303Oscillator();
        const success = await engine.init(mockAudioContext, 'worklet-url.js');

        expect(success).toBe(true);
        expect(engine.isReady).toBe(true);
        expect(engine.isFallback).toBe(true);
    });
    describe('hyphon_native build selection (Open303Config)', () => {
        const fetchedWasm = () =>
            vi.mocked(global.fetch).mock.calls
                .map(([u]) => String(u))
                .filter((u) => /\.wasm$/.test(u));
        const initMessage = () =>
            mockWorkletNode.port.postMessage.mock.calls
                .map(([m]: [any]) => m)
                .find((m: any) => m.type === 'init-wasm');
        const crossOriginIsolated = () => {
            vi.stubGlobal('crossOriginIsolated', true);
            vi.stubGlobal('SharedArrayBuffer', globalThis.SharedArrayBuffer ?? ArrayBuffer);
        };

        it('loads the pthread build on a crossOriginIsolated page without config', async () => {
            crossOriginIsolated();
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext, 'worklet-url.js');

            expect(fetchedWasm()).toEqual([expect.stringMatching(/\/hyphon_native\.wasm$/)]);
            expect(initMessage().data).toMatchObject({ isThreaded: true, variant: 'pthread', memoryPages: 2048 });
            expect(engine.isFallback).toBe(false);
        });

        it('honours forceSingleThreaded even when the pthread build could run', async () => {
            crossOriginIsolated();
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext, 'worklet-url.js', { forceSingleThreaded: true });

            expect(fetchedWasm()).toEqual([expect.stringMatching(/\/hyphon_native\.st\.wasm$/)]);
            expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/hyphon_wasm_export_map\.st\.json$/));
            expect(initMessage().data).toMatchObject({ isThreaded: false, variant: 'st', memoryPages: 256 });
            expect(engine.isFallback).toBe(false);
        });

        it('loads the single-threaded build when the page is not crossOriginIsolated', async () => {
            vi.stubGlobal('crossOriginIsolated', false);
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext, 'worklet-url.js');

            expect(fetchedWasm()).toEqual([expect.stringMatching(/\/hyphon_native\.st\.wasm$/)]);
            expect(initMessage().data).toMatchObject({ isThreaded: false, variant: 'st' });
        });

        it('runs the native single-threaded voice on WebKit instead of the JS fallback', async () => {
            crossOriginIsolated();
            vi.stubGlobal('navigator', {
                userAgent:
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
            });
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext, 'worklet-url.js');

            expect(fetchedWasm()).toEqual([expect.stringMatching(/\/hyphon_native\.st\.wasm$/)]);
            expect(engine.isFallback).toBe(false);
            expect(engine.isReady).toBe(true);
        });

        it('binds one build per audio context so Prophecy joins the 303 voices', async () => {
            crossOriginIsolated();
            const bass = new Open303Oscillator();
            await bass.init(mockAudioContext, 'worklet-url.js', { forceSingleThreaded: true });

            const prophecy = new ProphecyOscillator();
            await prophecy.init(mockAudioContext, 'prophecy-worklet.js');

            expect(fetchedWasm()).toHaveLength(2);
            for (const url of fetchedWasm()) expect(url).toMatch(/\/hyphon_native\.st\.wasm$/);
        });
    });
});
