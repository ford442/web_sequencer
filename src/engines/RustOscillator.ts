// @mode: bridge
// Main-thread side of the `rust-*` oscillator family (#1664).
//
// The DSP is rust-audio/src/lib.rs (a no_std, SIMD, band-limited kernel),
// shipped as public/rust_osc.wasm and run by src/audio-worklets/rust-osc-processor.ts.
// This file only:
//   - feature-detects (AudioWorklet present, WASM SIMD validates on these bytes),
//   - compiles the module once and loads the worklet once per context,
//   - hands out one AudioWorkletNode per synth voice, pooled across notes.
// It never renders a sample on the main thread — that is the pattern #1294
// removed, and `oscillatorEngineContract.test.ts` keeps it out.

import { engineTelemetry, logEngineFallback } from '@/utils/engineTelemetry';
import { resolvePublicAsset } from '@/utils/engineTelemetry/publicAsset';
import { log } from '@/utils/log';
import { loadWorkletModule } from '../audio/runtime/workletRegistry';
import {
    RUST_OSC_PARAMS,
    RUST_OSC_PROCESSOR,
    RUST_OSC_SHAPE_ID,
    type RustOscOutMessage,
    type RustOscProcessorOptions,
} from '../audio-worklets/rustOsc';
import type { WaveShape } from '../utils/waveformParser';
import type { RealtimeVoice } from './backends/OscillatorBackend';

export const RUST_OSC_WASM = 'rust_osc.wasm';
/** How long the probe voice may take to report `ready` before init gives up. */
export const RUST_OSC_READY_TIMEOUT_MS = 4000;

export interface RustOscInitResult {
    ok: boolean;
    reason: string;
}

export interface RustOscModuleLoad {
    module: WebAssembly.Module | null;
    /** Size of the fetched module, 0 when it was not fetched. */
    bytes: number;
    /** Why `module` is null. */
    reason: string | null;
    /** True when this machine cannot run the kernel at all (no WASM SIMD). */
    unsupported: boolean;
}

let moduleLoad: Promise<RustOscModuleLoad> | null = null;

/**
 * Fetch, feature-detect and compile public/rust_osc.wasm once per page. Shared
 * by the live voices (compiled module → `processorOptions`) and the offline
 * renderer (`OfflineRustOscEngine`), so both run the same bytes. A failure is
 * not cached: a later call retries (a transient fetch error must not disable
 * the family for the session).
 *
 * Feature detection is on the exact bytes that will run: the kernel is v128
 * throughout, so an engine without WASM SIMD rejects it here, by name, before
 * any worklet exists — not with a CompileError later.
 */
export function loadRustOscModule(): Promise<RustOscModuleLoad> {
    if (moduleLoad) return moduleLoad;
    const attempt = (async (): Promise<RustOscModuleLoad> => {
        const none = (reason: string, unsupported = false, bytes = 0): RustOscModuleLoad =>
            ({ module: null, bytes, reason, unsupported });
        if (typeof WebAssembly === 'undefined') return none('WebAssembly unavailable', true);
        const url = resolvePublicAsset(RUST_OSC_WASM);
        let bytes: ArrayBuffer;
        try {
            const response = await fetch(url);
            if (!response.ok) return none(`${RUST_OSC_WASM} fetch HTTP ${response.status} (${url})`);
            bytes = await response.arrayBuffer();
        } catch (e) {
            return none(`${RUST_OSC_WASM} fetch failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!WebAssembly.validate(bytes)) {
            return none(`${RUST_OSC_WASM} does not validate: this engine lacks WASM SIMD (simd128)`, true, bytes.byteLength);
        }
        try {
            return { module: await WebAssembly.compile(bytes), bytes: bytes.byteLength, reason: null, unsupported: false };
        } catch (e) {
            return none(`${RUST_OSC_WASM} compile failed: ${e instanceof Error ? e.message : String(e)}`, false, bytes.byteLength);
        }
    })();
    moduleLoad = attempt;
    void attempt.then((r) => {
        if (!r.module && moduleLoad === attempt) moduleLoad = null;
    });
    return attempt;
}

/** Test seam: forget the cached module. */
export function resetRustOscModuleForTests(): void {
    moduleLoad = null;
}

/** One pooled voice: an AudioWorkletNode running its own kernel instance. */
class RustOscVoice implements RealtimeVoice {
    readonly backendId = 'rust' as const;
    readonly frequency: AudioParam;
    readonly owner: RustOscillator;
    readonly node: AudioWorkletNode;
    readonly context: BaseAudioContext;
    private readonly shapeParam: AudioParam;
    private readonly gateParam: AudioParam;
    private disposed = false;

    constructor(owner: RustOscillator, node: AudioWorkletNode, context: BaseAudioContext) {
        this.owner = owner;
        this.node = node;
        this.context = context;
        const p = node.parameters;
        this.frequency = p.get(RUST_OSC_PARAMS.frequency)!;
        this.shapeParam = p.get(RUST_OSC_PARAMS.shape)!;
        this.gateParam = p.get(RUST_OSC_PARAMS.gate)!;
    }

    get output(): AudioNode {
        return this.node;
    }

    get alive(): boolean {
        return !this.disposed;
    }

    start(when: number, shape: WaveShape): void {
        this.shapeParam.cancelScheduledValues(when);
        this.shapeParam.setValueAtTime(RUST_OSC_SHAPE_ID[shape], when);
        // Dropping later events also drops a release-close the previous note
        // scheduled past `when` (retrigger while it was still ringing).
        this.gateParam.cancelScheduledValues(when);
        this.gateParam.setValueAtTime(1, when);
    }

    stop(when: number): void {
        this.gateParam.cancelScheduledValues(when);
        this.gateParam.setValueAtTime(0, when);
    }

    release(): void {
        if (this.disposed) return;
        const now = this.context.currentTime;
        this.gateParam.cancelScheduledValues(now);
        this.gateParam.setValueAtTime(0, now);
        this.frequency.cancelScheduledValues(now);
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

export class RustOscillator {
    private module: WebAssembly.Module | null = null;
    private context: BaseAudioContext | null = null;
    private readonly free: RustOscVoice[] = [];
    private readonly all = new Set<RustOscVoice>();
    isReady = false;
    /** Why the last init failed, or null. */
    failure: string | null = null;
    /** False once init proved this machine cannot run it (no SIMD, no worklet). */
    private supported = true;

    private readonly processorUrl: string;

    constructor(processorUrl: string) {
        this.processorUrl = processorUrl;
    }

    /** Environment can run the family at all (refined by `init`). */
    get isSupported(): boolean {
        return this.supported
            && typeof WebAssembly !== 'undefined'
            && typeof AudioWorkletNode !== 'undefined';
    }

    /** Voices currently allocated (pooled + in use), for tests and the HUD. */
    get voiceCount(): number {
        return this.all.size;
    }

    async init(context: BaseAudioContext): Promise<RustOscInitResult> {
        this.context = context;
        if (typeof AudioWorkletNode === 'undefined' || !context.audioWorklet) {
            this.supported = false;
            return this.fail('AudioWorklet unavailable');
        }
        if (!this.processorUrl) return this.fail('worklet URL missing');

        const loaded = await loadRustOscModule();
        if (!loaded.module) {
            if (loaded.unsupported) this.supported = false;
            return this.fail(loaded.reason ?? `${RUST_OSC_WASM} unavailable`);
        }
        this.module = loaded.module;
        // Bounded: WebKit can hang inside addModule, and this runs on the boot path.
        let addModuleTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                loadWorkletModule(context, this.processorUrl, RUST_OSC_PROCESSOR),
                new Promise<never>((_, reject) => {
                    addModuleTimer = setTimeout(
                        () => reject(new Error(`timed out after ${RUST_OSC_READY_TIMEOUT_MS} ms`)),
                        RUST_OSC_READY_TIMEOUT_MS,
                    );
                }),
            ]);
        } catch (e) {
            return this.fail('AudioWorklet.addModule failed', e);
        } finally {
            clearTimeout(addModuleTimer);
        }

        // Probe: one real voice must instantiate and report `ready` in the
        // worklet scope (a structured-clone or instantiate failure surfaces
        // here). It then becomes the first pooled voice.
        let probe: RustOscVoice;
        try {
            probe = this.createVoice(context);
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
            engineTelemetry.registerResolution('rust', 'wasm-worklet', `ready (${ready.reason})`);
        } catch {
            /* telemetry is best-effort */
        }
        log.debug(`[RustOscillator] ready: ${loaded.bytes} B, ${ready.reason}`);
        return { ok: true, reason: ready.reason };
    }

    /**
     * A voice on `context`: `reuse` when it is ours and alive, else a pooled
     * one, else a new node. Null when not ready or on a different context.
     */
    acquire(context: BaseAudioContext, reuse: RealtimeVoice | null): RealtimeVoice | null {
        if (!this.isReady || !this.module || context !== this.context) return null;
        if (reuse instanceof RustOscVoice && reuse.owner === this && reuse.alive) return reuse;
        const pooled = this.free.pop();
        if (pooled) return pooled;
        return this.createVoice(context);
    }

    /** Called by `RustOscVoice.release()`. */
    recycle(voice: RustOscVoice): void {
        if (voice.alive && this.all.has(voice) && !this.free.includes(voice)) this.free.push(voice);
    }

    dispose(): void {
        for (const voice of this.all) voice.dispose();
        this.all.clear();
        this.free.length = 0;
        this.module = null;
        this.isReady = false;
    }

    private createVoice(context: BaseAudioContext): RustOscVoice {
        const processorOptions: RustOscProcessorOptions = { module: this.module! };
        const node = new AudioWorkletNode(context, RUST_OSC_PROCESSOR, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions,
        });
        const voice = new RustOscVoice(this, node, context);
        node.port.onmessage = (event: MessageEvent<RustOscOutMessage>) => {
            if (event.data?.type === 'error') {
                // A voice created after a successful probe failing is unexpected:
                // it stays silent, so say so rather than let it look like a mute.
                logEngineFallback('rust', 'wasm-worklet', `voice failed in the worklet: ${event.data.reason}`);
            }
        };
        this.all.add(voice);
        return voice;
    }

    private awaitReady(voice: RustOscVoice): Promise<RustOscInitResult> {
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve({ ok: false, reason: `worklet ready timeout (${RUST_OSC_READY_TIMEOUT_MS} ms)` });
            }, RUST_OSC_READY_TIMEOUT_MS);
            const port = voice.node.port;
            const previous = port.onmessage;
            port.onmessage = (event: MessageEvent<RustOscOutMessage>) => {
                const msg = event.data;
                if (settled || !msg) return;
                if (msg.type === 'ready' || msg.type === 'error') {
                    settled = true;
                    clearTimeout(timer);
                    port.onmessage = previous;
                    resolve(
                        msg.type === 'ready'
                            ? { ok: true, reason: `simd=${msg.simd} maxFrames=${msg.maxFrames}` }
                            : { ok: false, reason: `worklet init error: ${msg.reason}` },
                    );
                }
            };
        });
    }

    private fail(reason: string, err?: unknown): RustOscInitResult {
        this.isReady = false;
        const cause = err instanceof Error ? err.message
            : typeof err === 'string' || typeof err === 'number' ? String(err)
                : err != null ? JSON.stringify(err) : null;
        const detail = cause ? `${reason}: ${cause}` : reason;
        this.failure = detail;
        // The registry drops rust-* to the C++ OSC (scalar, so it runs without
        // WASM SIMD), then the WASM OSC table — not straight to JS; say so, since
        // logEngineFallback's own wording names the JS oscillator.
        logEngineFallback('rust', 'wasm-worklet', `${reason} — rust-* plays on C++ OSC (or WASM OSC) instead`, err);
        return { ok: false, reason: detail };
    }
}
