// The main-thread bridge of the "C++ filter" (#1673): it is the shared filter
// stage machinery on the C++ kernel's module, so what is tested here is what
// differs — the processor it runs, the module it shares with the `cpp-*`
// oscillator, and that each filter source is its own slot.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CppFilter, getCppFilter, setCppFilter } from '../CppFilter';
import { CPP_OSC_WASM, loadCppOscModule, resetCppOscModuleForTests } from '../CppOscillator';
import { RustFilter, setRustFilter } from '../RustFilter';
import { resetRustOscModuleForTests } from '../RustOscillator';
import { WamFilter, getWamFilter, setWamFilter } from '../WamFilter';
import { getFilterStage } from '../filterStages';
import { CPP_FILTER_PARAMS, CPP_FILTER_PROCESSOR } from '../../audio-worklets/cppFilter';
import { RUST_FILTER_PROCESSOR } from '../../audio-worklets/rustFilter';
import { WAM_FILTER_PROCESSOR } from '../../audio-worklets/wamFilter';

/** The smallest valid module: `\0asm` + version 1. Enough for compile. */
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const param = () => ({ setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });

let created: FakeWorkletNode[] = [];
/** What every fake node's worklet answers once constructed. */
let reply: { type: 'ready'; maxFrames: number } | { type: 'error'; reason: string } = { type: 'ready', maxFrames: 1024 };

class FakeWorkletNode {
    port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> } = {
        onmessage: null,
        postMessage: vi.fn(),
    };
    parameters = new Map<string, ReturnType<typeof param>>([
        [CPP_FILTER_PARAMS.cutoff, param()],
        [CPP_FILTER_PARAMS.resonance, param()],
        [CPP_FILTER_PARAMS.type, param()],
    ]);
    connect = vi.fn();
    disconnect = vi.fn();
    readonly name: string;
    readonly options: { processorOptions: { module: unknown } };
    constructor(_context: unknown, name: string, options: { processorOptions: { module: unknown } }) {
        this.name = name;
        this.options = options;
        created.push(this);
        const answer = reply;
        setTimeout(() => this.port.onmessage?.({ data: answer }), 0);
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
    reply = { type: 'ready', maxFrames: 1024 };
    resetCppOscModuleForTests();
    resetRustOscModuleForTests();
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    stubFetch(EMPTY_WASM);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setCppFilter(null);
    setRustFilter(null);
    setWamFilter(null);
    resetCppOscModuleForTests();
    resetRustOscModuleForTests();
});

describe('CppFilter.init', () => {
    it('runs the cpp-filter processor on the module the cpp-* oscillator uses, and pools the probe node', async () => {
        const ctx = makeContext();
        const filter = new CppFilter('cpp-filter.js');

        const result = await filter.init(ctx);

        expect(result.ok).toBe(true);
        expect(filter.isReady).toBe(true);
        expect(filter.spec.source).toBe('cpp');
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(CPP_OSC_WASM);
        expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith('cpp-filter.js');
        expect(created).toHaveLength(1);
        expect(created[0].name).toBe(CPP_FILTER_PROCESSOR);
        expect(created[0].options.processorOptions.module).toBeInstanceOf(WebAssembly.Module);
        expect(filter.unavailableReason(ctx)).toBeNull();
    });

    it('compiles the module once for the oscillator and the filter together', async () => {
        const osc = await loadCppOscModule();
        const filter = new CppFilter('cpp-filter.js');
        await filter.init(makeContext());
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(created[0].options.processorOptions.module).toBe(osc.module);
    });

    it('schedules cutoff, resonance and the type id like any filter stage', async () => {
        const ctx = makeContext();
        const filter = new CppFilter('cpp-filter.js');
        await filter.init(ctx);
        const node = filter.acquire(ctx)!;

        node.set(2, { cutoff: 700, resonance: 2.5, type: 'hp' });

        const p = created[0].parameters;
        expect(p.get('cutoff')!.setValueAtTime).toHaveBeenCalledWith(700, 2);
        expect(p.get('resonance')!.setValueAtTime).toHaveBeenCalledWith(2.5, 2);
        expect(p.get('type')!.setValueAtTime).toHaveBeenCalledWith(2, 2);
    });

    it('names the module in its failure, so a missing cpp_osc.wasm is not mistaken for another filter', async () => {
        stubFetch(null, 404);
        const filter = new CppFilter('cpp-filter.js');
        const result = await filter.init(makeContext());
        expect(result.ok).toBe(false);
        expect(result.reason).toContain(`${CPP_OSC_WASM} fetch HTTP 404`);
        expect(filter.unavailableReason(makeContext())).toContain(CPP_OSC_WASM);
        expect(filter.acquire(makeContext())).toBeNull();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[CppFilter] unavailable'));
    });

    it('reports a worklet that refuses the module (wrong ABI, missing cflt_*) as its own failure', async () => {
        reply = { type: 'error', reason: 'cpp_osc.wasm is missing cflt_* exports' };
        const filter = new CppFilter('cpp-filter.js');
        const result = await filter.init(makeContext());
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('cflt_* exports');
        expect(filter.acquire(makeContext())).toBeNull();
    });

    it('is not ready, and says why, before init has run', () => {
        expect(new CppFilter('cpp-filter.js').unavailableReason(makeContext())).toBe('not initialized');
    });
});

describe('filter stage slots', () => {
    it('keep one handle per source: setting C++ leaves WASM OSC and Rust alone', () => {
        const cpp = new CppFilter('c.js');
        const rust = new RustFilter('r.js');
        const wam = new WamFilter('w.js', 'f.wasm');
        setCppFilter(cpp);
        setRustFilter(rust);
        setWamFilter(wam);
        expect(getCppFilter()).toBe(cpp);
        expect(getFilterStage('cpp')).toBe(cpp);
        expect(getFilterStage('rust')).toBe(rust);
        expect(getWamFilter()).toBe(wam);
        setCppFilter(null);
        expect(getCppFilter()).toBeNull();
        expect(getFilterStage('rust')).toBe(rust);
        expect(getWamFilter()).toBe(wam);
    });

    it('run different processors, so a source is never served another kernel', async () => {
        const ctx = makeContext();
        const cpp = new CppFilter('c.js');
        const rust = new RustFilter('r.js');
        const wam = new WamFilter('w.js', 'wamFilter.wasm');
        await Promise.all([cpp.init(ctx), rust.init(ctx), wam.init(ctx)]);
        expect(created.map((n) => n.name).sort())
            .toEqual([CPP_FILTER_PROCESSOR, RUST_FILTER_PROCESSOR, WAM_FILTER_PROCESSOR].sort());
        expect(cpp.nodeCount).toBe(1);
    });
});
