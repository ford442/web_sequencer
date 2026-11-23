// @mode: bridge
// Main-thread side of the `dwgs-*` oscillator family (#1666).
//
// The DSP is dwgs-audio/ (a scalar Rust kernel rendering harmonic-recipe waves
// additively — Korg's Digital Waveform Generator System as Hyphon does it),
// shipped as the standalone public/dwgs_osc.wasm and run by
// src/audio-worklets/dwgs-osc-processor.ts. This file only:
//   - feature-detects (AudioWorklet present, the module compiles here),
//   - compiles the module once and loads the worklet once per context,
//   - hands out one AudioWorkletNode per synth voice, pooled across notes.
// It never renders a sample on the main thread — that is the pattern #1294
// removed, and `oscillatorEngineContract.test.ts` keeps it out.
//
// Before #1666 DWGS was panel art with no code path at all. Every failure here
// is logged, and the registry walks `dwgs-*` down the one
// fallback order (each wave's nearest basic shape on the next live engine),
// publishing the step.

import { engineTelemetry, logEngineFallback } from '@/utils/engineTelemetry';
import { resolvePublicAsset } from '@/utils/engineTelemetry/publicAsset';
import { log } from '@/utils/log';
import { loadWorkletModule } from '../audio/runtime/workletRegistry';
import {
    DWGS_OSC_PARAMS,
    DWGS_OSC_PROCESSOR,
    type DwgsOscOutMessage,
    type DwgsOscProcessorOptions,
} from '../audio-worklets/dwgsOsc';
import type { WaveShape } from '../utils/waveformParser';
import { dwgsWaveForShape, dwgsWaveIndex } from './dwgsWaves';
import type { RealtimeVoice } from './backends/OscillatorBackend';

export const DWGS_OSC_WASM = 'dwgs_osc.wasm';
/** How long the probe voice may take to report `ready` before init gives up. */
export const DWGS_OSC_READY_TIMEOUT_MS = 4000;

export interface DwgsOscInitResult {
    ok: boolean;
    reason: string;
}

export interface DwgsOscModuleLoad {
    module: WebAssembly.Module | null;
    /** Size of the fetched module, 0 when it was not fetched. */
    bytes: number;
    /** Why `module` is null. */
    reason: string | null;
    /** True when this machine cannot run the kernel at all. */
    unsupported: boolean;
}

let moduleLoad: Promise<DwgsOscModuleLoad> | null = null;

/**
 * Fetch and compile public/dwgs_osc.wasm once per page. Shared by the live
 * voices (compiled module → `processorOptions`) and the offline renderer
 * (`OfflineDwgsOscEngine`), so both run the same bytes. A failure is not cached:
 * a later call retries (a transient fetch error must not disable the family for
 * the session).
 *
 * The kernel is scalar (no simd128), so unlike the Rust OSC there is no
 * feature to detect beyond WebAssembly itself: if the bytes do not validate
 * here, the file is wrong, not the browser.
 */
export function loadDwgsOscModule(): Promise<DwgsOscModuleLoad> {
    if (moduleLoad) return moduleLoad;
    const attempt = (async (): Promise<DwgsOscModuleLoad> => {
        const none = (reason: string, unsupported = false, bytes = 0): DwgsOscModuleLoad =>
            ({ module: null, bytes, reason, unsupported });
        if (typeof WebAssembly === 'undefined') return none('WebAssembly unavailable', true);
        const url = resolvePublicAsset(DWGS_OSC_WASM);
        let bytes: ArrayBuffer;
        try {
            const response = await fetch(url);
            if (!response.ok) return none(`${DWGS_OSC_WASM} fetch HTTP ${response.status} (${url})`);
            bytes = await response.arrayBuffer();
        } catch (e) {
            return none(`${DWGS_OSC_WASM} fetch failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        try {
            return { module: await WebAssembly.compile(bytes), bytes: bytes.byteLength, reason: null, unsupported: false };
        } catch (e) {
            return none(`${DWGS_OSC_WASM} compile failed: ${e instanceof Error ? e.message : String(e)}`, false, bytes.byteLength);
        }
    })();
    moduleLoad = attempt;
    void attempt.then((r) => {
        if (!r.module && moduleLoad === attempt) moduleLoad = null;
    });
    return attempt;
}

/** Test seam: forget the cached module. */
export function resetDwgsOscModuleForTests(): void {
    moduleLoad = null;
}

/** One pooled voice: an AudioWorkletNode running its own kernel instance. */
class DwgsOscVoice implements RealtimeVoice {
    readonly backendId = 'dwgs' as const;
    readonly frequency: AudioParam;
    readonly owner: DwgsOscillator;
    readonly node: AudioWorkletNode;
    readonly context: BaseAudioContext;
    private readonly waveParam: AudioParam;
    private readonly gateParam: AudioParam;
    private disposed = false;

    constructor(owner: DwgsOscillator, node: AudioWorkletNode, context: BaseAudioContext) {
        this.owner = owner;
        this.node = node;
        this.context = context;
        const p = node.parameters;
        this.frequency = p.get(DWGS_OSC_PARAMS.frequency)!;
        this.waveParam = p.get(DWGS_OSC_PARAMS.wave)!;
        this.gateParam = p.get(DWGS_OSC_PARAMS.gate)!;
    }

    get output(): AudioNode {
        return this.node;
    }

    get alive(): boolean {
        return !this.disposed;
    }

    /** `variant` is the DWGS wave (`dwgs-<variant>`); without one, the nearest to `shape`. */
    start(when: number, shape: WaveShape, variant?: string): void {
        const named = dwgsWaveIndex(variant);
        this.waveParam.cancelScheduledValues(when);
        this.waveParam.setValueAtTime(named >= 0 ? named : dwgsWaveForShape(shape), when);
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

export class DwgsOscillator {
    private module: WebAssembly.Module | null = null;
    private context: BaseAudioContext | null = null;
    private readonly free: DwgsOscVoice[] = [];
    private readonly all = new Set<DwgsOscVoice>();
    isReady = false;
    /** Why the last init failed, or null. */
    failure: string | null = null;
    /** Wave ids the kernel reported through the probe voice. */
    waveCount = 0;
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

    async init(context: BaseAudioContext): Promise<DwgsOscInitResult> {
        this.context = context;
        if (typeof AudioWorkletNode === 'undefined' || !context.audioWorklet) {
            this.supported = false;
            return this.fail('AudioWorklet unavailable');
        }
        if (!this.processorUrl) return this.fail('worklet URL missing');

        const loaded = await loadDwgsOscModule();
        if (!loaded.module) {
            if (loaded.unsupported) this.supported = false;
            return this.fail(loaded.reason ?? `${DWGS_OSC_WASM} unavailable`);
        }
        this.module = loaded.module;
        // Bounded: WebKit can hang inside addModule, and this runs on the boot path.
        let addModuleTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                loadWorkletModule(context, this.processorUrl, DWGS_OSC_PROCESSOR),
                new Promise<never>((_, reject) => {
                    addModuleTimer = setTimeout(
                        () => reject(new Error(`timed out after ${DWGS_OSC_READY_TIMEOUT_MS} ms`)),
                        DWGS_OSC_READY_TIMEOUT_MS,
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
        let probe: DwgsOscVoice;
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
            engineTelemetry.registerResolution('dwgs', 'wasm-worklet', `ready (${ready.reason})`);
        } catch {
            /* telemetry is best-effort */
        }
        log.debug(`[DwgsOscillator] ready: ${loaded.bytes} B, ${ready.reason}`);
        return { ok: true, reason: ready.reason };
    }

    /**
     * A voice on `context`: `reuse` when it is ours and alive, else a pooled
     * one, else a new node. Null when not ready or on a different context.
     */
    acquire(context: BaseAudioContext, reuse: RealtimeVoice | null): RealtimeVoice | null {
        if (!this.isReady || !this.module || context !== this.context) return null;
        if (reuse instanceof DwgsOscVoice && reuse.owner === this && reuse.alive) return reuse;
        const pooled = this.free.pop();
        if (pooled) return pooled;
        return this.createVoice(context);
    }

    /** Called by `DwgsOscVoice.release()`. */
    recycle(voice: DwgsOscVoice): void {
        if (voice.alive && this.all.has(voice) && !this.free.includes(voice)) this.free.push(voice);
    }

    dispose(): void {
        for (const voice of this.all) voice.dispose();
        this.all.clear();
        this.free.length = 0;
        this.module = null;
        this.isReady = false;
    }

    private createVoice(context: BaseAudioContext): DwgsOscVoice {
        const processorOptions: DwgsOscProcessorOptions = { module: this.module! };
        const node = new AudioWorkletNode(context, DWGS_OSC_PROCESSOR, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions,
        });
        const voice = new DwgsOscVoice(this, node, context);
        node.port.onmessage = (event: MessageEvent<DwgsOscOutMessage>) => {
            if (event.data?.type === 'error') {
                // A voice created after a successful probe failing is unexpected:
                // it stays silent, so say so rather than let it look like a mute.
                logEngineFallback('dwgs', 'wasm-worklet', `voice failed in the worklet: ${event.data.reason}`);
            }
        };
        this.all.add(voice);
        return voice;
    }

    private awaitReady(voice: DwgsOscVoice): Promise<DwgsOscInitResult> {
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve({ ok: false, reason: `worklet ready timeout (${DWGS_OSC_READY_TIMEOUT_MS} ms)` });
            }, DWGS_OSC_READY_TIMEOUT_MS);
            const port = voice.node.port;
            const previous = port.onmessage;
            port.onmessage = (event: MessageEvent<DwgsOscOutMessage>) => {
                const msg = event.data;
                if (settled || !msg) return;
                if (msg.type === 'ready' || msg.type === 'error') {
                    settled = true;
                    clearTimeout(timer);
                    port.onmessage = previous;
                    if (msg.type === 'ready') {
                        this.waveCount = msg.waves;
                        resolve({ ok: true, reason: `waves=${msg.waves} maxFrames=${msg.maxFrames}` });
                    } else {
                        resolve({ ok: false, reason: `worklet init error: ${msg.reason}` });
                    }
                }
            };
        });
    }

    private fail(reason: string, err?: unknown): DwgsOscInitResult {
        this.isReady = false;
        const cause = err instanceof Error ? err.message
            : typeof err === 'string' || typeof err === 'number' ? String(err)
                : err != null ? JSON.stringify(err) : null;
        const detail = cause ? `${reason}: ${cause}` : reason;
        this.failure = detail;
        // The registry drops dwgs-* to the next live engine with each wave's
        // nearest basic shape (not straight to JS); say so, since
        // logEngineFallback's own wording names the JS oscillator.
        logEngineFallback('dwgs', 'wasm-worklet', `${reason} — dwgs-* plays its nearest basic shape on the next engine instead`, err);
        return { ok: false, reason: detail };
    }
}
