// The main-thread bridge of the "Rust filter" (#1672): it is the WASM OSC filter's
// stage machinery on the Rust kernel's module, so what is tested here is what
// differs — the processor it runs, the module it shares with the `rust-*`
// oscillator, and that each filter source is its own slot.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RustFilter, getRustFilter, setRustFilter } from '../RustFilter';
import { RUST_OSC_WASM, loadRustOscModule, resetRustOscModuleForTests } from '../RustOscillator';
import { WamFilter, getWamFilter, setWamFilter } from '../WamFilter';
import { getFilterStage } from '../filterStages';
import { RUST_FILTER_PARAMS, RUST_FILTER_PROCESSOR } from '../../audio-worklets/rustFilter';
import { WAM_FILTER_PROCESSOR } from '../../audio-worklets/wamFilter';

/** The smallest valid module: `\0asm` + version 1. Enough for validate / compile. */
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const param = () => ({ setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });

let created: FakeWorkletNode[] = [];

class FakeWorkletNode {
    port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> } = {
        onmessage: null,
        postMessage: vi.fn(),
    };
    parameters = new Map<string, ReturnType<typeof param>>([
        [RUST_FILTER_PARAMS.cutoff, param()],
        [RUST_FILTER_PARAMS.resonance, param()],
        [RUST_FILTER_PARAMS.type, param()],
    ]);
    connect = vi.fn();
    disconnect = vi.fn();
    readonly name: string;
    readonly options: { processorOptions: { module: unknown } };
    constructor(_context: unknown, name: string, options: { processorOptions: { module: unknown } }) {
        this.name = name;
        this.options = options;
        created.push(this);
        setTimeout(() => this.port.onmessage?.({ data: { type: 'ready', maxFrames: 1024 } }), 0);
    }
}

function makeContext() {
    return {
        state: 'running',
        currentTime: 0,
        audioWorklet: { addModule: vi.fn(async () => {}) },
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
    resetRustOscModuleForTests();
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    stubFetch(EMPTY_WASM);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setRustFilter(null);
    setWamFilter(null);
    resetRustOscModuleForTests();
});

describe('RustFilter.init', () => {
    it('runs the rust-filter processor on the module the rust-* oscillator uses, and pools the probe node', async () => {
        const ctx = makeContext();
        const filter = new RustFilter('rust-filter.js');

        const result = await filter.init(ctx);

        expect(result.ok).toBe(true);
        expect(filter.isReady).toBe(true);
        expect(filter.spec.source).toBe('rust');
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(RUST_OSC_WASM);
        expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith('rust-filter.js');
        expect(created).toHaveLength(1);
        expect(created[0].name).toBe(RUST_FILTER_PROCESSOR);
        expect(created[0].options.processorOptions.module).toBeInstanceOf(WebAssembly.Module);
        expect(filter.unavailableReason(ctx)).toBeNull();
    });

    it('compiles the module once for the oscillator and the filter together', async () => {
        const osc = await loadRustOscModule();
        const filter = new RustFilter('rust-filter.js');
        await filter.init(makeContext());
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(created[0].options.processorOptions.module).toBe(osc.module);
    });

    it('schedules cutoff, resonance and the type id like any filter stage', async () => {
        const ctx = makeContext();
        const filter = new RustFilter('rust-filter.js');
        await filter.init(ctx);
        const node = filter.acquire(ctx)!;

        node.set(2, { cutoff: 700, resonance: 2.5, type: 'bp' });

        const p = created[0].parameters;
        expect(p.get('cutoff')!.setValueAtTime).toHaveBeenCalledWith(700, 2);
        expect(p.get('resonance')!.setValueAtTime).toHaveBeenCalledWith(2.5, 2);
        expect(p.get('type')!.setValueAtTime).toHaveBeenCalledWith(1, 2);
    });

    it('names the module in its failure, so a missing rust_osc.wasm is not mistaken for the WASM OSC filter', async () => {
        stubFetch(null, 404);
        const filter = new RustFilter('rust-filter.js');
        const result = await filter.init(makeContext());
        expect(result.ok).toBe(false);
        expect(result.reason).toContain(`${RUST_OSC_WASM} fetch HTTP 404`);
        expect(filter.unavailableReason(makeContext())).toContain(RUST_OSC_WASM);
        expect(filter.acquire(makeContext())).toBeNull();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[RustFilter] unavailable'));
    });

    it('names the missing browser feature when the module does not validate (no WASM SIMD)', async () => {
        stubFetch(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
        const filter = new RustFilter('rust-filter.js');
        const result = await filter.init(makeContext());
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/does not validate: this engine lacks WASM SIMD/);
        expect(filter.isSupported).toBe(false);
    });

    it('is not ready, and says why, before init has run', () => {
        expect(new RustFilter('rust-filter.js').unavailableReason(makeContext())).toBe('not initialized');
    });
});

describe('filter stage slots', () => {
    it('keep one handle per source: setting Rust leaves WASM OSC alone', () => {
        const rust = new RustFilter('r.js');
        const wam = new WamFilter('w.js', 'f.wasm');
        setRustFilter(rust);
        setWamFilter(wam);
        expect(getRustFilter()).toBe(rust);
        expect(getWamFilter()).toBe(wam);
        expect(getFilterStage('rust')).toBe(rust);
        expect(getFilterStage('wam')).toBe(wam);
        setRustFilter(null);
        expect(getRustFilter()).toBeNull();
        expect(getWamFilter()).toBe(wam);
    });

    it('run different processors, so a source is never served the other kernel', async () => {
        const ctx = makeContext();
        const rust = new RustFilter('r.js');
        const wam = new WamFilter('w.js', 'wamFilter.wasm');
        await Promise.all([rust.init(ctx), wam.init(ctx)]);
        expect(created.map((n) => n.name).sort()).toEqual([RUST_FILTER_PROCESSOR, WAM_FILTER_PROCESSOR].sort());
        expect(rust.nodeCount).toBe(1);
        expect(wam.nodeCount).toBe(1);
    });
});
