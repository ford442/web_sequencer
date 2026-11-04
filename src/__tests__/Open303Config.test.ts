import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { EventType } from '../shared/rt/eventLayout';
import { postedRecords, postedTypes } from '../test/helpers/controlPlaneRecords';
import { ProphecyOscillator } from '../engines/ProphecyOscillator';
import { resetHyphonWasmExportMapCache } from '../utils/engineTelemetry';
import {
    HYPHON_NATIVE_MIN_MEMORY_PAGES,
    OPEN303_REQUIRED_WASM_EXPORTS,
    PROPHECY_REQUIRED_WASM_EXPORTS,
} from '../audio-worklets/hyphonNativeImports';

// Mock WebAssembly.compile and Module.imports to avoid needing a real WASM binary.
// Re-stubbed per test because afterEach unstubs the environment globals below.
// The mock binary carries the voice API under its own names, like the
// -lexports.js release build; the main thread refuses one that does not.
const mockWasmModule = {} as WebAssembly.Module;
const MOCK_EXPORT_NAMES = [...OPEN303_REQUIRED_WASM_EXPORTS, ...PROPHECY_REQUIRED_WASM_EXPORTS];
const realWebAssembly = WebAssembly;
function stubWebAssembly() {
    vi.stubGlobal('WebAssembly', {
        ...realWebAssembly,
        compile: vi.fn().mockResolvedValue(mockWasmModule),
        Module: {
            imports: vi.fn().mockReturnValue([]),
            exports: vi.fn().mockReturnValue(
                MOCK_EXPORT_NAMES.map((name) => ({ name, kind: 'function' })),
            ),
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
            json: () => Promise.resolve(Object.fromEntries(MOCK_EXPORT_NAMES.map((name) => [name, name]))),
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

/** A message the façade posts to its worklet; only `init-wasm` is inspected here. */
interface PostedMessage {
    type?: string;
    data?: Record<string, unknown>;
}

type PortListener = (ev: { data: PostedMessage }) => void;

/** The worklet node the façade constructs: its port is what the tests read. */
interface MockWorkletNode {
    port: {
        postMessage: Mock<(message: unknown) => void>;
        onmessage: PortListener | null;
        close: Mock<() => void>;
        addEventListener: Mock<(event: string, handler: PortListener) => void>;
        removeEventListener: Mock<() => void>;
        start: Mock<() => void>;
    };
    connect: Mock<() => void>;
    disconnect: Mock<() => void>;
}

/** The first `init-wasm` message posted to the port, if any. */
function findInitMessage(node: MockWorkletNode): PostedMessage | undefined {
    return node.port.postMessage.mock.calls
        .map(([message]) => message as PostedMessage)
        .find((message) => message.type === 'init-wasm');
}

describe('Open303 Oscillator', () => {
    let mockAudioContext: AudioContext;
    let mockWorkletNode: MockWorkletNode;

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        resetHyphonWasmExportMapCache();
        stubWebAssembly();
        vi.mocked(global.fetch).mockImplementation(mockOpen303Fetch as typeof fetch);

        mockWorkletNode = {
            port: {
                postMessage: vi.fn<(message: unknown) => void>(),
                onmessage: null,
                close: vi.fn(),
                addEventListener: vi.fn((event: string, handler: PortListener) => {
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
        let onmessageHandler: PortListener | null = null;
        Object.defineProperty(mockWorkletNode.port, 'onmessage', {
            get() { return onmessageHandler; },
            set(handler: PortListener | null) {
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

    // #1497 P2: notes and params travel as records on the part's route —
    // batched messages here, where the page shares no memory with the worklet.
    it('sends a noteOn as a NOTE_ON record on its frame, not a message', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');
        mockWorkletNode.port.postMessage.mockClear();

        engine.noteOn(60, 100, 1);
        expect(postedRecords(mockWorkletNode.port.postMessage).map((e) => [e.frame, e.type, e.target, e.value])).toEqual([
            [44100, EventType.NoteOn, 60, 100],
        ]);
        expect(postedTypes(mockWorkletNode.port.postMessage)).toEqual([]);
    });

    it('sends a noteOff as a NOTE_OFF record', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');
        mockWorkletNode.port.postMessage.mockClear();

        engine.noteOff(60);
        expect(postedRecords(mockWorkletNode.port.postMessage).map((e) => [e.frame, e.type, e.target])).toEqual([
            [0, EventType.NoteOff, 60],
        ]);
    });

    it('sends param updates as PARAM_SET records with the Open303Param id', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');
        mockWorkletNode.port.postMessage.mockClear();

        engine.setCutoff(0.5);
        engine.setFilterMode(1);
        engine.setParam('setNotAParam', 1);
        expect(postedRecords(mockWorkletNode.port.postMessage).map((e) => [e.type, e.target, e.value])).toEqual([
            [EventType.Param, 2, 0.5], // OPEN303_CUTOFF
            [EventType.Param, 8, 1],   // OPEN303_FILTER_MODE
        ]);
    });

    it('a stop is CANCEL_NOTES + ALL_NOTES_OFF behind the notes it cancels', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');
        mockWorkletNode.port.postMessage.mockClear();

        engine.noteOn(36, 100, 2);
        engine.allNotesOff();
        engine.noteOn(38, 100, 2.5);
        expect(postedRecords(mockWorkletNode.port.postMessage).map((e) => e.type)).toEqual([
            EventType.NoteOn, EventType.CancelNotes, EventType.AllNotesOff, EventType.NoteOn,
        ]);
        expect(postedTypes(mockWorkletNode.port.postMessage)).toEqual([]);
    });

    it('init hands the worklet its route\'s transport', async () => {
        const engine = new Open303Oscillator();
        await engine.init(mockAudioContext, 'worklet-url.js');
        const init = findInitMessage(mockWorkletNode);
        expect(init?.data?.events).toEqual({ kind: 'message', capacity: 256 });
    });

    it('should handle initialization failure gracefully', async () => {
        // Mock fetch failure — engine activates FallbackBassSynth and returns true
        vi.mocked(global.fetch).mockImplementationOnce(() =>
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
        const initMessage = () => findInitMessage(mockWorkletNode);
        const crossOriginIsolated = () => {
            vi.stubGlobal('crossOriginIsolated', true);
            vi.stubGlobal('SharedArrayBuffer', globalThis.SharedArrayBuffer ?? ArrayBuffer);
        };

        it('loads the pthread build on a crossOriginIsolated page without config', async () => {
            crossOriginIsolated();
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext, 'worklet-url.js');

            expect(fetchedWasm()).toEqual([expect.stringMatching(/\/hyphon_native\.wasm$/)]);
            expect(initMessage()?.data).toMatchObject({ isThreaded: true, variant: 'pthread', memoryPages: HYPHON_NATIVE_MIN_MEMORY_PAGES });
            expect(engine.isFallback).toBe(false);
        });

        it('honours forceSingleThreaded even when the pthread build could run', async () => {
            crossOriginIsolated();
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext, 'worklet-url.js', { forceSingleThreaded: true });

            expect(fetchedWasm()).toEqual([expect.stringMatching(/\/hyphon_native\.st\.wasm$/)]);
            expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/hyphon_wasm_export_map\.st\.json$/));
            expect(initMessage()?.data).toMatchObject({ isThreaded: false, variant: 'st', memoryPages: 256 });
            expect(engine.isFallback).toBe(false);
        });

        it('loads the single-threaded build when the page is not crossOriginIsolated', async () => {
            vi.stubGlobal('crossOriginIsolated', false);
            const engine = new Open303Oscillator();
            await engine.init(mockAudioContext, 'worklet-url.js');

            expect(fetchedWasm()).toEqual([expect.stringMatching(/\/hyphon_native\.st\.wasm$/)]);
            expect(initMessage()?.data).toMatchObject({ isThreaded: false, variant: 'st' });
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
