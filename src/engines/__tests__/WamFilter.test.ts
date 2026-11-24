// The main-thread bridge of the "WASM OSC filter" (#1663): load, probe, pool, and
// — above all — fail loudly with a reason `Voice` can report.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WamFilter, WAM_FILTER_READY_TIMEOUT_MS, getWamFilter, setWamFilter } from '../WamFilter';
import { WAM_FILTER_PARAMS, WAM_FILTER_PROCESSOR } from '../../audio-worklets/wamFilter';

/** The smallest valid module: `\0asm` + version 1. Enough for validate / compile. */
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const param = () => ({ setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });

let created: FakeWorkletNode[] = [];
let reply: 'ready' | 'error' | 'silent' = 'ready';

class FakeWorkletNode {
    port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> } = {
        onmessage: null,
        postMessage: vi.fn(),
    };
    parameters = new Map<string, ReturnType<typeof param>>([
        [WAM_FILTER_PARAMS.cutoff, param()],
        [WAM_FILTER_PARAMS.resonance, param()],
        [WAM_FILTER_PARAMS.type, param()],
    ]);
    connect = vi.fn();
    disconnect = vi.fn();
    readonly context: unknown;
    readonly name: string;
    readonly options: { processorOptions: { module: unknown } };
    constructor(context: unknown, name: string, options: { processorOptions: { module: unknown } }) {
        this.context = context;
        this.name = name;
        this.options = options;
        created.push(this);
        setTimeout(() => {
            if (reply === 'ready') this.port.onmessage?.({ data: { type: 'ready', maxFrames: 1024 } });
            if (reply === 'error') this.port.onmessage?.({ data: { type: 'error', reason: 'boom in worklet' } });
        }, 0);
    }
}

function makeContext(overrides: Record<string, unknown> = {}) {
    return {
        state: 'running',
        currentTime: 0,
        audioWorklet: { addModule: vi.fn(async () => {}) },
        ...overrides,
    } as unknown as AudioContext;
}

function stubFetch(body: Uint8Array | null, status = 200) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: status === 200 && body !== null,
        status,
        arrayBuffer: async () => (body ?? new Uint8Array()).buffer.slice(0),
    })));
}

beforeEach(() => {
    created = [];
    reply = 'ready';
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    stubFetch(EMPTY_WASM);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setWamFilter(null);
});

describe('WamFilter.init', () => {
    it('fetches, validates and compiles the module, loads the worklet, and pools the probe node', async () => {
        const ctx = makeContext();
        const filter = new WamFilter('worklet.js', 'wamFilter.wasm');

        const result = await filter.init(ctx);

        expect(result.ok).toBe(true);
        expect(filter.isReady).toBe(true);
        expect(fetch).toHaveBeenCalledWith('wamFilter.wasm');
        expect((ctx.audioWorklet.addModule as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('worklet.js');
        expect(created).toHaveLength(1); // the probe
        expect(created[0].name).toBe(WAM_FILTER_PROCESSOR);
        // The compiled module travels to the worklet in processorOptions.
        expect(created[0].options.processorOptions.module).toBeInstanceOf(WebAssembly.Module);
        expect(filter.unavailableReason(ctx)).toBeNull();
    });

    it('hands out the probe first, then new nodes, and takes released nodes back', async () => {
        const ctx = makeContext();
        const filter = new WamFilter('w.js', 'f.wasm');
        await filter.init(ctx);

        const a = filter.acquire(ctx)!;
        const b = filter.acquire(ctx)!;
        expect(a.node).toBe(created[0]);
        expect(b.node).toBe(created[1]);
        expect(filter.nodeCount).toBe(2);

        a.release();
        expect((created[0] as FakeWorkletNode).disconnect).toHaveBeenCalled();
        expect(filter.acquire(ctx)).toBe(a);
        expect(filter.nodeCount).toBe(2); // pooled, not created
    });

    it('refuses a different context (an offline render) with a reason, instead of a broken node', async () => {
        const filter = new WamFilter('w.js', 'f.wasm');
        await filter.init(makeContext());
        const offline = makeContext();
        expect(filter.unavailableReason(offline)).toMatch(/different AudioContext/);
        expect(filter.acquire(offline)).toBeNull();
    });

    it('schedules cutoff, resonance and the type id on the node at the given time', async () => {
        const ctx = makeContext();
        const filter = new WamFilter('w.js', 'f.wasm');
        await filter.init(ctx);
        const node = filter.acquire(ctx)!;

        node.set(1.25, { cutoff: 900, resonance: 3.5, type: 'hp' });

        const p = (created[0] as FakeWorkletNode).parameters;
        expect(p.get('cutoff')!.setValueAtTime).toHaveBeenCalledWith(900, 1.25);
        expect(p.get('resonance')!.setValueAtTime).toHaveBeenCalledWith(3.5, 1.25);
        expect(p.get('type')!.setValueAtTime).toHaveBeenCalledWith(2, 1.25);
    });

    it('reports an unreachable wasm by URL and status, and does not become ready', async () => {
        stubFetch(null, 404);
        const filter = new WamFilter('w.js', 'missing.wasm');
        const result = await filter.init(makeContext());
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/HTTP 404 \(missing\.wasm\)/);
        expect(filter.isReady).toBe(false);
        expect(filter.unavailableReason(makeContext())).toMatch(/HTTP 404/);
        expect(filter.acquire(makeContext())).toBeNull();
    });

    it('names the missing browser feature when the module does not validate (Safari intersection)', async () => {
        stubFetch(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
        const filter = new WamFilter('w.js', 'f.wasm');
        const result = await filter.init(makeContext());
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/does not validate: engine lacks WASM simd\/bulk-memory/);
        expect(filter.isSupported).toBe(false); // permanent on this engine
    });

    it('is unsupported, with a reason, where AudioWorklet does not exist', async () => {
        const filter = new WamFilter('w.js', 'f.wasm');
        const result = await filter.init(makeContext({ audioWorklet: undefined }));
        expect(result).toMatchObject({ ok: false, reason: 'AudioWorklet unavailable' });
        expect(filter.isSupported).toBe(false);
    });

    it('fails with the worklet reason when addModule rejects', async () => {
        const ctx = makeContext({ audioWorklet: { addModule: vi.fn(async () => { throw new Error('404 worklet'); }) } });
        const result = await new WamFilter('broken.js', 'f.wasm').init(ctx);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/AudioWorklet\.addModule failed: 404 worklet/);
    });

    it('fails when the probe node reports an instantiation error in the worklet', async () => {
        reply = 'error';
        const filter = new WamFilter('w.js', 'f.wasm');
        const result = await filter.init(makeContext());
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/worklet init error: boom in worklet/);
        expect(filter.isReady).toBe(false);
        expect(filter.nodeCount).toBe(0);
    });

    it('gives up, with a reason, when the probe never answers', async () => {
        // Only setTimeout is faked: WebAssembly.compile resolves on the real event loop,
        // so the ready-timer is registered a few real ticks into init().
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            reply = 'silent';
            let result: Awaited<ReturnType<WamFilter['init']>> | null = null;
            void new WamFilter('w.js', 'f.wasm').init(makeContext()).then((r) => { result = r; });
            for (let i = 0; i < 100 && !result; i++) {
                await new Promise((resolve) => setImmediate(resolve));
                await vi.advanceTimersByTimeAsync(WAM_FILTER_READY_TIMEOUT_MS + 10);
            }
            expect(result).toMatchObject({ ok: false });
            expect((result as unknown as { reason: string }).reason).toMatch(/worklet ready timeout/);
        } finally {
            vi.useRealTimers();
        }
    });

    it('is not ready, and says why, before init has run', () => {
        const filter = new WamFilter('w.js', 'f.wasm');
        expect(filter.unavailableReason(makeContext())).toBe('not initialized');
    });
});

describe('process-wide handle', () => {
    it('is what Voice asks for', () => {
        const filter = new WamFilter('w.js', 'f.wasm');
        setWamFilter(filter);
        expect(getWamFilter()).toBe(filter);
        setWamFilter(null);
        expect(getWamFilter()).toBeNull();
    });
});
