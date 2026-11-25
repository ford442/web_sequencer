// @mode: bridge
// Main-thread side of the "WASM OSC filter" (#1663) — and, generalised as
// `WasmFilterStage`, of the "Rust filter" (#1672, src/engines/RustFilter.ts) and
// the "C++ filter" (#1673, src/engines/CppFilter.ts) and the "DWGS filter"
// (#1674, src/engines/DwgsFilter.ts).
//
// The DSP is assembly/biquad.ts — the same resonant biquad baked into a `wam-*`
// table — built standalone as src/wasm/wamFilter.wasm and run per synth voice by
// src/audio-worklets/wam-filter-processor.ts. This file only:
//   - fetches + validates + compiles the module once (Safari feature intersection:
//     simd + bulk-memory, no WasmGC — a validate failure is reported by name),
//   - loads the worklet once per context (workletRegistry),
//   - hands out pooled AudioWorkletNodes, one per voice that selected the filter.
// It never filters a sample on the main thread.
//
// Anything it cannot do returns null / not-ready with a reason; `Voice` then
// runs its native BiquadFilterNode and reports the substitution
// (`logFilterSourceFallback`) — there is no silent path.
//
// Every wasm filter source is one of these stages: same node contract (one input,
// one output, k-rate `cutoff` / `resonance` / `type`, `ready` / `error` messages),
// differing in the registered processor, the module it compiles and its names
// (`FilterStageSpec`). `Voice` treats them alike (`engines/filterStages.ts`).

import { engineTelemetry } from '@/utils/engineTelemetry';
import { log } from '@/utils/log';
import { loadWorkletModule } from '../audio/runtime/workletRegistry';
import type { FilterSource } from '../types/synth';
import { setFilterStage, getFilterStage } from './filterStages';
import {
    WAM_FILTER_PARAMS,
    WAM_FILTER_PROCESSOR,
    WAM_FILTER_TYPE_ID,
    type WamFilterOutMessage,
    type WamFilterProcessorOptions,
    type WamFilterType,
} from '../audio-worklets/wamFilter';

/** How long the probe node may take to report `ready` before init gives up. */
export const WAM_FILTER_READY_TIMEOUT_MS = 4000;

export interface WamFilterInitResult {
    ok: boolean;
    reason: string;
}

/** What differs between wasm filter sources; everything else is shared. */
export interface FilterStageSpec {
    /** The `SynthParams.filterSource` this stage implements. */
    source: Exclude<FilterSource, 'native'>;
    /** Registered AudioWorkletProcessor name. */
    processor: string;
    /** For messages: the module this stage runs ("wamFilter.wasm"). */
    moduleName: string;
    /** For messages and logs: `[Tag]`. */
    tag: string;
}

export const WAM_FILTER_SPEC: FilterStageSpec = {
    source: 'wam',
    processor: WAM_FILTER_PROCESSOR,
    moduleName: 'wamFilter.wasm',
    tag: 'WamFilter',
};

/** A compiled module, or why there is none. */
export interface FilterModuleLoad {
    module: WebAssembly.Module | null;
    bytes: number;
    reason: string | null;
    unsupported: boolean;
}

export interface WamFilterSettingsUpdate {
    cutoff: number;
    resonance: number;
    type: WamFilterType;
}

/** One pooled filter: an AudioWorkletNode running its own kernel instance. */
export class WamFilterNode {
    readonly owner: WasmFilterStage;
    readonly node: AudioWorkletNode;
    readonly context: BaseAudioContext;
    private readonly cutoffParam: AudioParam;
    private readonly resonanceParam: AudioParam;
    private readonly typeParam: AudioParam;
    private disposed = false;

    constructor(owner: WasmFilterStage, node: AudioWorkletNode, context: BaseAudioContext) {
        this.owner = owner;
        this.node = node;
        this.context = context;
        const p = node.parameters;
        this.cutoffParam = p.get(WAM_FILTER_PARAMS.cutoff)!;
        this.resonanceParam = p.get(WAM_FILTER_PARAMS.resonance)!;
        this.typeParam = p.get(WAM_FILTER_PARAMS.type)!;
    }

    /** Where the source connects. */
    get input(): AudioNode {
        return this.node;
    }

    /** Where the filtered signal comes from. */
    get output(): AudioNode {
        return this.node;
    }

    get alive(): boolean {
        return !this.disposed;
    }

    /** Schedule the filter's settings at `when` (k-rate, so they land on a block). */
    set(when: number, s: WamFilterSettingsUpdate): void {
        this.cutoffParam.setValueAtTime(s.cutoff, when);
        this.resonanceParam.setValueAtTime(s.resonance, when);
        this.typeParam.setValueAtTime(WAM_FILTER_TYPE_ID[s.type], when);
    }

    /** Disconnect and hand the node back to the pool. */
    release(): void {
        if (this.disposed) return;
        const now = this.context.currentTime;
        for (const param of [this.cutoffParam, this.resonanceParam, this.typeParam]) {
            param.cancelScheduledValues(now);
        }
        try {
            this.node.disconnect();
        } catch {
            /* not connected */
        }
        this.owner.recycle(this);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        try {
            this.node.disconnect();
        } catch {
            /* not connected */
        }
        this.node.port.postMessage({ type: 'dispose' });
        this.node.port.onmessage = null;
    }
}

/**
 * A pool of worklet filter nodes that run one wasm filter kernel. Subclasses
 * pick the processor and how the module is loaded.
 */
export class WasmFilterStage {
    private module: WebAssembly.Module | null = null;
    private context: BaseAudioContext | null = null;
    private readonly free: WamFilterNode[] = [];
    private readonly all = new Set<WamFilterNode>();
    isReady = false;
    /** Why the last init failed, or null. */
    failure: string | null = null;
    private supported = true;

    private readonly processorUrl: string;
    private readonly wasmUrl: string;
    readonly spec: FilterStageSpec;

    constructor(processorUrl: string, wasmUrl: string, spec: FilterStageSpec) {
        this.processorUrl = processorUrl;
        this.wasmUrl = wasmUrl;
        this.spec = spec;
    }

    get isSupported(): boolean {
        return this.supported
            && typeof WebAssembly !== 'undefined'
            && typeof AudioWorkletNode !== 'undefined';
    }

    /** Nodes currently allocated (pooled + in use), for tests and the HUD. */
    get nodeCount(): number {
        return this.all.size;
    }

    async init(context: BaseAudioContext): Promise<WamFilterInitResult> {
        this.context = context;
        if (typeof AudioWorkletNode === 'undefined' || !context.audioWorklet) {
            this.supported = false;
            return this.fail('AudioWorklet unavailable');
        }
        if (!this.processorUrl || !this.wasmUrl) return this.fail('worklet or wasm URL missing');

        const loaded = await this.loadModule();
        if (!loaded.module) {
            if (loaded.unsupported) this.supported = false;
            return this.fail(loaded.reason ?? `${this.spec.moduleName} unavailable`);
        }
        this.module = loaded.module;

        // Bounded: WebKit can hang inside addModule, and this runs on the boot path.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                loadWorkletModule(context, this.processorUrl, this.spec.processor),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`timed out after ${WAM_FILTER_READY_TIMEOUT_MS} ms`)),
                        WAM_FILTER_READY_TIMEOUT_MS,
                    );
                }),
            ]);
        } catch (e) {
            return this.fail('AudioWorklet.addModule failed', e);
        } finally {
            clearTimeout(timer);
        }

        // Probe: one real node must instantiate in the worklet scope and report
        // `ready`. It then becomes the first pooled node.
        let probe: WamFilterNode;
        try {
            probe = this.createNode(context);
        } catch (e) {
            return this.fail('AudioWorkletNode creation failed', e);
        }
        const ready = await this.awaitReady(probe);
        if (!ready.ok) {
            probe.dispose();
            this.all.delete(probe);
            return this.fail(ready.reason);
        }
        this.free.push(probe);
        this.isReady = true;
        this.failure = null;
        try {
            engineTelemetry.registerResolution('filter', this.spec.source, `ready (${ready.reason})`);
        } catch {
            /* telemetry is best-effort */
        }
        log.debug(`[${this.spec.tag}] ready: ${loaded.bytes} B, ${ready.reason}`);
        return { ok: true, reason: ready.reason };
    }

    /**
     * Why `acquire(context)` would return null right now, or null when it would
     * not. `Voice` puts this in the fallback report.
     */
    unavailableReason(context: BaseAudioContext): string | null {
        if (!this.isSupported) return this.failure ?? 'not supported in this environment';
        if (!this.isReady || !this.module) return this.failure ?? 'not initialized';
        if (context !== this.context) return 'different AudioContext (offline render)';
        return null;
    }

    /** A filter on `context`: a pooled node, else a new one. Null when unavailable. */
    acquire(context: BaseAudioContext): WamFilterNode | null {
        if (this.unavailableReason(context)) return null;
        const pooled = this.free.pop();
        if (pooled) return pooled;
        try {
            return this.createNode(context);
        } catch (e) {
            this.failure = `AudioWorkletNode creation failed: ${e instanceof Error ? e.message : String(e)}`;
            return null;
        }
    }

    /** Called by `WamFilterNode.release()`. */
    recycle(node: WamFilterNode): void {
        if (node.alive && this.all.has(node) && !this.free.includes(node)) this.free.push(node);
    }

    dispose(): void {
        for (const node of this.all) node.dispose();
        this.all.clear();
        this.free.length = 0;
        this.module = null;
        this.isReady = false;
    }

    /** Fetch, validate and compile the module this stage runs. Overridden by a stage whose module is shared. */
    protected async loadModule(): Promise<FilterModuleLoad> {
        const none = (reason: string, unsupported = false, bytes = 0) =>
            ({ module: null, bytes, reason, unsupported });
        let bytes: ArrayBuffer;
        try {
            const response = await fetch(this.wasmUrl);
            if (!response.ok) return none(`${this.spec.moduleName} fetch HTTP ${response.status} (${this.wasmUrl})`);
            bytes = await response.arrayBuffer();
        } catch (e) {
            return none(`${this.spec.moduleName} fetch failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        // The module targets the Safari intersection (simd + bulk-memory, no WasmGC),
        // so an engine that rejects it lacks one of those: name that, up front.
        if (!WebAssembly.validate(bytes)) {
            return none(`${this.spec.moduleName} does not validate: engine lacks WASM simd/bulk-memory`, true, bytes.byteLength);
        }
        try {
            return { module: await WebAssembly.compile(bytes), bytes: bytes.byteLength, reason: null, unsupported: false };
        } catch (e) {
            return none(`${this.spec.moduleName} compile failed: ${e instanceof Error ? e.message : String(e)}`, false, bytes.byteLength);
        }
    }

    private createNode(context: BaseAudioContext): WamFilterNode {
        const processorOptions: WamFilterProcessorOptions = { module: this.module! };
        const node = new AudioWorkletNode(context, this.spec.processor, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            channelCount: 1,
            channelCountMode: 'explicit',
            processorOptions,
        });
        const filter = new WamFilterNode(this, node, context);
        node.port.onmessage = (event: MessageEvent<WamFilterOutMessage>) => {
            if (event.data?.type === 'error') {
                // A node created after a good probe failing is unexpected: it stays
                // silent, so say so rather than let it look like a muted voice.
                console.error(`[${this.spec.tag}] node failed in the worklet: ${event.data.reason}`);
                this.failure = `node failed in the worklet: ${event.data.reason}`;
            }
        };
        this.all.add(filter);
        return filter;
    }

    private awaitReady(filter: WamFilterNode): Promise<WamFilterInitResult> {
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve({ ok: false, reason: `worklet ready timeout (${WAM_FILTER_READY_TIMEOUT_MS} ms)` });
            }, WAM_FILTER_READY_TIMEOUT_MS);
            const port = filter.node.port;
            const previous = port.onmessage;
            port.onmessage = (event: MessageEvent<WamFilterOutMessage>) => {
                const msg = event.data;
                if (settled || !msg) return;
                if (msg.type === 'ready' || msg.type === 'error') {
                    settled = true;
                    clearTimeout(timer);
                    port.onmessage = previous;
                    resolve(
                        msg.type === 'ready'
                            ? {
                                ok: true,
                                reason: msg.simd === undefined
                                    ? `maxFrames=${msg.maxFrames}`
                                    : `simd=${msg.simd} maxFrames=${msg.maxFrames}`,
                            }
                            : { ok: false, reason: `worklet init error: ${msg.reason}` },
                    );
                }
            };
        });
    }

    private fail(reason: string, err?: unknown): WamFilterInitResult {
        this.isReady = false;
        const cause = err instanceof Error ? err.message
            : typeof err === 'string' || typeof err === 'number' ? String(err)
                : err != null ? JSON.stringify(err) : null;
        const detail = cause ? `${reason}: ${cause}` : reason;
        this.failure = detail;
        // Not announced here: nothing has lost anything until a voice asks for the
        // filter. `Voice` reports the substitution then, with this reason.
        console.warn(`[${this.spec.tag}] unavailable: ${detail}`);
        return { ok: false, reason: detail };
    }
}

/** The "WASM OSC filter" (#1663): the AssemblyScript kernel's biquad. */
export class WamFilter extends WasmFilterStage {
    constructor(processorUrl: string, wasmUrl: string) {
        super(processorUrl, wasmUrl, WAM_FILTER_SPEC);
    }
}

// The process-wide handles live in `filterStages.ts` (one slot per source); these
// keep the #1663 names.
export function setWamFilter(filter: WasmFilterStage | null): void {
    setFilterStage('wam', filter);
}

export function getWamFilter(): WasmFilterStage | null {
    return getFilterStage('wam');
}
