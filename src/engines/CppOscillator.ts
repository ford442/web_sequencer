// @mode: bridge
// Main-thread side of the `cpp-*` oscillator family (#1665).
//
// The DSP is emscripten/cpp_osc.cpp (a scalar, windowed-sinc BLEP kernel),
// shipped as the standalone public/cpp_osc.wasm and run by
// src/audio-worklets/cpp-osc-processor.ts. This file only:
//   - feature-detects (AudioWorklet present, the module compiles here),
//   - compiles the module once and loads the worklet once per context,
//   - hands out one AudioWorkletNode per synth voice, pooled across notes.
// It never renders a sample on the main thread — that is the pattern #1294
// removed, and `oscillatorEngineContract.test.ts` keeps it out.
//
// Before #1665 `cpp-*` had no renderer and silently played an OscillatorNode.
// Every failure here is logged, and the registry walks `cpp-*` down the one
// fallback order (to the WASM OSC table), publishing the step.

import { engineTelemetry, logEngineFallback } from '@/utils/engineTelemetry';
import { resolvePublicAsset } from '@/utils/engineTelemetry/publicAsset';
import { log } from '@/utils/log';
import { loadWorkletModule } from '../audio/runtime/workletRegistry';
import {
    CPP_OSC_PARAMS,
    CPP_OSC_PROCESSOR,
    CPP_OSC_SHAPE_ID,
    type CppOscOutMessage,
    type CppOscProcessorOptions,
} from '../audio-worklets/cppOsc';
import type { WaveShape } from '../utils/waveformParser';
import type { RealtimeVoice } from './backends/OscillatorBackend';

export const CPP_OSC_WASM = 'cpp_osc.wasm';
/** How long the probe voice may take to report `ready` before init gives up. */
export const CPP_OSC_READY_TIMEOUT_MS = 4000;

export interface CppOscInitResult {
    ok: boolean;
    reason: string;
}

export interface CppOscModuleLoad {
    module: WebAssembly.Module | null;
    /** Size of the fetched module, 0 when it was not fetched. */
    bytes: number;
    /** Why `module` is null. */
    reason: string | null;
    /** True when this machine cannot run the kernel at all. */
    unsupported: boolean;
}

let moduleLoad: Promise<CppOscModuleLoad> | null = null;

/**
 * Fetch and compile public/cpp_osc.wasm once per page. Shared by the live
 * voices (compiled module → `processorOptions`) and the offline renderer
 * (`OfflineCppOscEngine`), so both run the same bytes. A failure is not cached:
 * a later call retries (a transient fetch error must not disable the family for
 * the session).
 *
 * The kernel is scalar (no simd128), so unlike the Rust OSC there is no
 * feature to detect beyond WebAssembly itself: if the bytes do not validate
 * here, the file is wrong, not the browser.
 */
export function loadCppOscModule(): Promise<CppOscModuleLoad> {
    if (moduleLoad) return moduleLoad;
    const attempt = (async (): Promise<CppOscModuleLoad> => {
        const none = (reason: string, unsupported = false, bytes = 0): CppOscModuleLoad =>
            ({ module: null, bytes, reason, unsupported });
        if (typeof WebAssembly === 'undefined') return none('WebAssembly unavailable', true);
        const url = resolvePublicAsset(CPP_OSC_WASM);
        let bytes: ArrayBuffer;
        try {
            const response = await fetch(url);
            if (!response.ok) return none(`${CPP_OSC_WASM} fetch HTTP ${response.status} (${url})`);
            bytes = await response.arrayBuffer();
        } catch (e) {
            return none(`${CPP_OSC_WASM} fetch failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        try {
            return { module: await WebAssembly.compile(bytes), bytes: bytes.byteLength, reason: null, unsupported: false };
        } catch (e) {
            return none(`${CPP_OSC_WASM} compile failed: ${e instanceof Error ? e.message : String(e)}`, false, bytes.byteLength);
        }
    })();
    moduleLoad = attempt;
    void attempt.then((r) => {
        if (!r.module && moduleLoad === attempt) moduleLoad = null;
    });
    return attempt;
}

/** Test seam: forget the cached module. */
export function resetCppOscModuleForTests(): void {
    moduleLoad = null;
}

/** One pooled voice: an AudioWorkletNode running its own kernel instance. */
class CppOscVoice implements RealtimeVoice {
    readonly backendId = 'cpp' as const;
    readonly frequency: AudioParam;
    readonly owner: CppOscillator;
    readonly node: AudioWorkletNode;
    readonly context: BaseAudioContext;
    private readonly shapeParam: AudioParam;
    private readonly gateParam: AudioParam;
    private disposed = false;

    constructor(owner: CppOscillator, node: AudioWorkletNode, context: BaseAudioContext) {
        this.owner = owner;
        this.node = node;
        this.context = context;
        const p = node.parameters;
        this.frequency = p.get(CPP_OSC_PARAMS.frequency)!;
        this.shapeParam = p.get(CPP_OSC_PARAMS.shape)!;
        this.gateParam = p.get(CPP_OSC_PARAMS.gate)!;
    }

    get output(): AudioNode {
        return this.node;
    }

    get alive(): boolean {
        return !this.disposed;
    }

    start(when: number, shape: WaveShape): void {
        this.shapeParam.cancelScheduledValues(when);
        this.shapeParam.setValueAtTime(CPP_OSC_SHAPE_ID[shape], when);
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

export class CppOscillator {
    private module: WebAssembly.Module | null = null;
    private context: BaseAudioContext | null = null;
    private readonly free: CppOscVoice[] = [];
    private readonly all = new Set<CppOscVoice>();
    isReady = false;
    /** Why the last init failed, or null. */
    failure: string | null = null;
    /** Output delay of the kernel in samples, reported by the probe voice. */
    latencySamples = 0;
    /** False once init proved this machine cannot run it (no WebAssembly, no worklet). */
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

    async init(context: BaseAudioContext): Promise<CppOscInitResult> {
        this.context = context;
        if (typeof AudioWorkletNode === 'undefined' || !context.audioWorklet) {
            this.supported = false;
            return this.fail('AudioWorklet unavailable');
        }
        if (!this.processorUrl) return this.fail('worklet URL missing');

        const loaded = await loadCppOscModule();
        if (!loaded.module) {
            if (loaded.unsupported) this.supported = false;
            return this.fail(loaded.reason ?? `${CPP_OSC_WASM} unavailable`);
        }
        this.module = loaded.module;
        // Bounded: WebKit can hang inside addModule, and this runs on the boot path.
        let addModuleTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                loadWorkletModule(context, this.processorUrl, CPP_OSC_PROCESSOR),
                new Promise<never>((_, reject) => {
                    addModuleTimer = setTimeout(
                        () => reject(new Error(`timed out after ${CPP_OSC_READY_TIMEOUT_MS} ms`)),
                        CPP_OSC_READY_TIMEOUT_MS,
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
        let probe: CppOscVoice;
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
            engineTelemetry.registerResolution('cpp', 'wasm-worklet', `ready (${ready.reason})`);
        } catch {
            /* telemetry is best-effort */
        }
        log.debug(`[CppOscillator] ready: ${loaded.bytes} B, ${ready.reason}`);
        return { ok: true, reason: ready.reason };
    }

    /**
     * A voice on `context`: `reuse` when it is ours and alive, else a pooled
     * one, else a new node. Null when not ready or on a different context.
     */
    acquire(context: BaseAudioContext, reuse: RealtimeVoice | null): RealtimeVoice | null {
        if (!this.isReady || !this.module || context !== this.context) return null;
        if (reuse instanceof CppOscVoice && reuse.owner === this && reuse.alive) return reuse;
        const pooled = this.free.pop();
        if (pooled) return pooled;
        return this.createVoice(context);
    }

    /** Called by `CppOscVoice.release()`. */
    recycle(voice: CppOscVoice): void {
        if (voice.alive && this.all.has(voice) && !this.free.includes(voice)) this.free.push(voice);
    }

    dispose(): void {
        for (const voice of this.all) voice.dispose();
        this.all.clear();
        this.free.length = 0;
        this.module = null;
        this.isReady = false;
    }

    private createVoice(context: BaseAudioContext): CppOscVoice {
        const processorOptions: CppOscProcessorOptions = { module: this.module! };
        const node = new AudioWorkletNode(context, CPP_OSC_PROCESSOR, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions,
        });
        const voice = new CppOscVoice(this, node, context);
        node.port.onmessage = (event: MessageEvent<CppOscOutMessage>) => {
            if (event.data?.type === 'error') {
                // A voice created after a successful probe failing is unexpected:
                // it stays silent, so say so rather than let it look like a mute.
                logEngineFallback('cpp', 'wasm-worklet', `voice failed in the worklet: ${event.data.reason}`);
            }
        };
        this.all.add(voice);
        return voice;
    }

    private awaitReady(voice: CppOscVoice): Promise<CppOscInitResult> {
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve({ ok: false, reason: `worklet ready timeout (${CPP_OSC_READY_TIMEOUT_MS} ms)` });
            }, CPP_OSC_READY_TIMEOUT_MS);
            const port = voice.node.port;
            const previous = port.onmessage;
            port.onmessage = (event: MessageEvent<CppOscOutMessage>) => {
                const msg = event.data;
                if (settled || !msg) return;
                if (msg.type === 'ready' || msg.type === 'error') {
                    settled = true;
                    clearTimeout(timer);
                    port.onmessage = previous;
                    if (msg.type === 'ready') {
                        this.latencySamples = msg.latency;
                        resolve({ ok: true, reason: `latency=${msg.latency} maxFrames=${msg.maxFrames}` });
                    } else {
                        resolve({ ok: false, reason: `worklet init error: ${msg.reason}` });
                    }
                }
            };
        });
    }

    private fail(reason: string, err?: unknown): CppOscInitResult {
        this.isReady = false;
        const cause = err instanceof Error ? err.message
            : typeof err === 'string' || typeof err === 'number' ? String(err)
                : err != null ? JSON.stringify(err) : null;
        const detail = cause ? `${reason}: ${cause}` : reason;
        this.failure = detail;
        // The registry drops cpp-* to the WASM OSC table (not straight to JS);
        // say so, since logEngineFallback's own wording names the JS oscillator.
        logEngineFallback('cpp', 'wasm-worklet', `${reason} — cpp-* plays on WASM OSC (AssemblyScript) instead`, err);
        return { ok: false, reason: detail };
    }
}
