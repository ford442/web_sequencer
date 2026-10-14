import { describe, expect, it, vi, beforeEach } from 'vitest';

const logEngineFallback = vi.fn();
vi.mock('@/utils/engineTelemetry', () => ({
    logEngineFallback: (...args: unknown[]) => { logEngineFallback(...args); },
    resolvePublicAsset: (p: string) => `https://example.test/hyphon/${p}`,
}));

import { createJsMixBus, createMixBus, MIX_BUS_SUBSYSTEM, type MixBus } from '../mixBus';
import { jsMixKernel, type MixKernel } from '../mixBusKernel';
import {
    createMixBusSessionHandler,
    type MixBusRequest,
    type MixBusResponse,
} from '../mixBusProtocol';

type Listener = (event: { data?: unknown; message?: string }) => void;

interface FakeWorkerOptions {
    init?: 'ready' | 'init-failed' | 'silent';
    kernel?: MixKernel;
}

/**
 * Runs the real worker session handler in-process. Messages cross with
 * structuredClone + transfer, so a transferred buffer is detached on the
 * sending side exactly as it would be across a real Worker boundary.
 */
class FakeWorker {
    onmessage: Listener | null = null;
    onerror: Listener | null = null;
    readonly posted: MixBusRequest[] = [];
    terminated = false;
    private readonly listeners = { message: new Set<Listener>(), error: new Set<Listener>() };
    private readonly handle: (message: Exclude<MixBusRequest, { type: 'init' }>) => void;
    private readonly options: FakeWorkerOptions;

    constructor(options: FakeWorkerOptions = {}) {
        this.options = options;
        this.handle = createMixBusSessionHandler(options.kernel ?? jsMixKernel, (message, transfer) => {
            this.deliver(structuredClone(message, { transfer }));
        });
    }

    addEventListener(type: 'message' | 'error', listener: Listener): void {
        this.listeners[type].add(listener);
    }

    removeEventListener(type: 'message' | 'error', listener: Listener): void {
        this.listeners[type].delete(listener);
    }

    postMessage(message: MixBusRequest, transfer: Transferable[] = []): void {
        const cloned = structuredClone(message, { transfer });
        this.posted.push(cloned);
        queueMicrotask(() => {
            if (this.terminated) return;
            if (cloned.type === 'init') {
                const mode = this.options.init ?? 'ready';
                if (mode === 'ready') this.deliver({ type: 'ready', kernel: 'native' });
                if (mode === 'init-failed') this.deliver({ type: 'init-failed', message: 'HTTP 404' });
                return;
            }
            this.handle(cloned);
        });
    }

    terminate(): void {
        this.terminated = true;
    }

    crash(message: string): void {
        const event = { message };
        this.onerror?.(event);
        for (const l of this.listeners.error) l(event);
    }

    private deliver(message: MixBusResponse): void {
        const event = { data: message };
        this.onmessage?.(event);
        for (const l of this.listeners.message) l(event);
    }
}

function nativeBus(options: FakeWorkerOptions = {}): Promise<{ bus: MixBus; worker: FakeWorker }> {
    const worker = new FakeWorker(options);
    return createMixBus({
        createWorker: () => worker as unknown as Worker,
        wasmUrl: 'mix_bus.wasm',
        readyTimeoutMs: 50,
    }).then((bus) => ({ bus, worker }));
}

const FRAMES = 6;
const stereo = (l: number[], r: number[]) => [Float32Array.from(l), Float32Array.from(r)];

/** Three sources exercising stereo, mono widening and a short source. */
function addSources(session: { add(c: readonly Float32Array[], g?: number): void }) {
    session.add(stereo([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], [-0.1, -0.2, -0.3, -0.4, -0.5, -0.6]));
    session.add([Float32Array.from([0.25, 0.25, 0.25, 0.25, 0.25, 0.25])]);
    session.add(stereo([1, 1], [0.5, 0.5]), 0.5);
}

const EXPECTED_L = [0.85, 0.95, 0.55, 0.65, 0.75, 0.85];
const EXPECTED_R = [0.4, 0.3, -0.05, -0.15, -0.25, -0.35];

beforeEach(() => {
    logEngineFallback.mockClear();
});

describe('JS mix bus', () => {
    it('sums stereo, widens mono, and adds short sources over their length', async () => {
        const bus = createJsMixBus();
        const session = bus.begin(FRAMES, 2);
        addSources(session);
        const result = await session.finish();

        expect(result.engine).toBe('js');
        expect([...result.channels[0]].map((v) => +v.toFixed(5))).toEqual(EXPECTED_L);
        expect([...result.channels[1]].map((v) => +v.toFixed(5))).toEqual(EXPECTED_R);
        expect(result.peaks[0]).toBeCloseTo(0.95, 5);
        expect(result.peaks[1]).toBeCloseTo(0.4, 5);
        expect(bus.status()).toEqual({ engine: 'js', reason: null });
    });

    it('is bit-identical to the pre-#1341 `dst[i] += src[i]` loop at unity gain', async () => {
        const a = Float32Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.37) * 0.3);
        const b = Float32Array.from({ length: 64 }, (_, i) => Math.cos(i * 0.11) * 0.7);
        const legacy = new Float32Array(64);
        for (const src of [a, b]) for (let i = 0; i < 64; i++) legacy[i] += src[i];

        const session = createJsMixBus().begin(64, 1);
        session.add([a]);
        session.add([b]);
        expect((await session.finish()).channels[0]).toEqual(legacy);
    });
});

describe('native-worker mix bus', () => {
    it('produces the JS result, off-thread, without detaching the caller’s sources', async () => {
        const { bus, worker } = await nativeBus();
        expect(bus.status()).toEqual({ engine: 'native-worker', reason: null });

        const session = bus.begin(FRAMES, 2);
        const first = stereo([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], [-0.1, -0.2, -0.3, -0.4, -0.5, -0.6]);
        session.add(first);
        session.add([Float32Array.from([0.25, 0.25, 0.25, 0.25, 0.25, 0.25])]);
        session.add(stereo([1, 1], [0.5, 0.5]), 0.5);
        const result = await session.finish();

        expect(result.engine).toBe('native-worker');
        expect([...result.channels[0]].map((v) => +v.toFixed(5))).toEqual(EXPECTED_L);
        expect([...result.channels[1]].map((v) => +v.toFixed(5))).toEqual(EXPECTED_R);
        // The client transferred copies, not the AudioBuffer-backed originals.
        expect(first[0].length).toBe(FRAMES);
        expect(first[0][5]).toBeCloseTo(0.6, 6);
        expect(worker.posted.map((m) => m.type)).toEqual(['init', 'begin', 'add', 'add', 'add', 'finish']);
        expect(logEngineFallback).not.toHaveBeenCalled();
        bus.dispose();
        expect(worker.terminated).toBe(true);
    });

    it('runs concurrent sessions independently (drum stem inside the master)', async () => {
        const { bus } = await nativeBus();
        const master = bus.begin(4, 1);
        master.add([Float32Array.from([1, 1, 1, 1])]);
        const drums = bus.begin(4, 1);
        drums.add([Float32Array.from([0.5, 0, 0, 0])]);
        drums.add([Float32Array.from([0, 0.5, 0, 0])]);
        const drumStem = await drums.finish();
        master.add(drumStem.channels);
        expect([...(await master.finish()).channels[0]]).toEqual([1.5, 1.5, 1, 1]);
    });
});

describe('fallback', () => {
    it('uses JS, with the reason, when the module fails to load', async () => {
        const { bus, worker } = await nativeBus({ init: 'init-failed' });
        expect(bus.status()).toEqual({ engine: 'js', reason: 'HTTP 404' });
        expect(worker.terminated).toBe(true);
        expect(logEngineFallback).toHaveBeenCalledWith(MIX_BUS_SUBSYSTEM, 'native-worker', 'HTTP 404');
    });

    it('uses JS when the worker never answers', async () => {
        const { bus } = await nativeBus({ init: 'silent' });
        expect(bus.status().engine).toBe('js');
        expect(bus.status().reason).toContain('did not start within 50 ms');
    });

    it('uses JS when the worker cannot be constructed', async () => {
        const bus = await createMixBus({
            createWorker: () => { throw new Error('blocked by CSP'); },
            wasmUrl: 'mix_bus.wasm',
        });
        expect(bus.status()).toEqual({ engine: 'js', reason: 'mix bus worker failed to start: blocked by CSP' });
    });

    it('re-mixes in JS — complete, not partial — when the worker crashes mid-export', async () => {
        const { bus, worker } = await nativeBus();
        const session = bus.begin(FRAMES, 2);
        addSources(session);
        await Promise.resolve();
        worker.crash('out of memory');
        const result = await session.finish();

        expect(result.engine).toBe('js');
        expect([...result.channels[0]].map((v) => +v.toFixed(5))).toEqual(EXPECTED_L);
        expect(bus.status()).toEqual({ engine: 'js', reason: 'mix bus worker crashed: out of memory' });
        expect(logEngineFallback).toHaveBeenCalledWith(
            MIX_BUS_SUBSYSTEM, 'native-worker', 'mix bus worker failed mid-export', expect.any(Error),
        );
        // Every later session stays on the JS path.
        const after = bus.begin(2, 1);
        after.add([Float32Array.from([1, 2])]);
        expect((await after.finish()).engine).toBe('js');
    });

    it('re-mixes in JS when an add fails inside the worker', async () => {
        const failing: MixKernel = {
            ...jsMixKernel,
            kind: 'native',
            accumulate: () => { throw new Error('kernel fault'); },
        };
        const { bus } = await nativeBus({ kernel: failing });
        const session = bus.begin(FRAMES, 2);
        addSources(session);
        const result = await session.finish();

        expect(result.engine).toBe('js');
        expect([...result.channels[1]].map((v) => +v.toFixed(5))).toEqual(EXPECTED_R);
        expect(bus.status().reason).toBe('kernel fault');
    });

    it('discard drops the worker-side session', async () => {
        const { bus, worker } = await nativeBus();
        const session = bus.begin(FRAMES, 2);
        session.discard();
        expect(worker.posted.at(-1)).toEqual({ type: 'discard', session: 1 });
    });
});
