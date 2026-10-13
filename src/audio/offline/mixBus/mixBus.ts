/**
 * Offline stereo mix bus (#1341) — the main-thread side.
 *
 * Stem export streams each rendered stem into a session as soon as it exists,
 * so the sum is built in a worker while the next stem renders, instead of in
 * a main-thread loop afterwards. Two engines:
 *
 * - `native-worker`: src/workers/mixBus.worker.ts running public/mix_bus.wasm.
 * - `js`: the same arithmetic in-thread (mixBusKernel.jsMixKernel). Used when
 *   there is no Worker / WebAssembly, the module fails to load, or the worker
 *   dies mid-export — in that last case the session re-mixes from its sources,
 *   so an export never comes back short.
 *
 * Never main thread + wasm: the module is only instantiated inside the worker
 * (src/__tests__/mainThreadNativeModuleGuard.test.ts).
 */
import mixBusWorkerUrl from '@/workers/mixBus.worker.ts?worker&url';
import { logEngineFallback, resolvePublicAsset } from '@/utils/engineTelemetry';
import { jsMixKernel } from './mixBusKernel';
import type { MixBusRequest, MixBusResponse } from './mixBusProtocol';

export type MixBusEngine = 'native-worker' | 'js';

export interface MixBusStatus {
    engine: MixBusEngine;
    /** Why the bus is on the JS path; null when native, or JS by request. */
    reason: string | null;
}

export interface MixResult {
    channels: Float32Array[];
    /** Per-channel sample peak of the mix (linear). */
    peaks: number[];
    /** The engine that actually produced `channels`. */
    engine: MixBusEngine;
}

export interface MixSession {
    /**
     * Add a source (one array per channel; mono feeds every channel) at
     * `gain`. Sources shorter than the session are added over their length.
     * Callers must not mutate a source until `finish()` settles: the JS
     * fallback re-reads it if the worker fails.
     */
    add(channels: readonly Float32Array[], gain?: number): void;
    finish(): Promise<MixResult>;
    /** Drop the session without a result (abort). A no-op after `finish()`. */
    discard(): void;
}

export interface MixBus {
    status(): MixBusStatus;
    begin(frames: number, channelCount?: number): MixSession;
    dispose(): void;
}

/** Subsystem id in engine telemetry / the degradation HUD. */
export const MIX_BUS_SUBSYSTEM = 'mixbus-wasm';

const DEFAULT_READY_TIMEOUT_MS = 3_000;
/** A 3-minute 13-stem mix takes well under a second; this only catches a hung worker. */
const FINISH_TIMEOUT_MS = 60_000;

interface Source {
    channels: readonly Float32Array[];
    gain: number;
}

function mixInJs(frames: number, channelCount: number, sources: readonly Source[]): MixResult {
    const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
    for (const source of sources) {
        if (source.channels.length === 0) continue;
        for (let ch = 0; ch < channelCount; ch++) {
            const src = source.channels[Math.min(ch, source.channels.length - 1)];
            jsMixKernel.accumulate(channels[ch], src, source.gain);
        }
    }
    return { channels, peaks: channels.map((c) => jsMixKernel.peak(c)), engine: 'js' };
}

class JsMixSession implements MixSession {
    private readonly sources: Source[] = [];
    private readonly frames: number;
    private readonly channelCount: number;

    constructor(frames: number, channelCount: number) {
        this.frames = frames;
        this.channelCount = channelCount;
    }

    add(channels: readonly Float32Array[], gain = 1): void {
        this.sources.push({ channels, gain });
    }

    finish(): Promise<MixResult> {
        return Promise.resolve(mixInJs(this.frames, this.channelCount, this.sources));
    }

    discard(): void {
        this.sources.length = 0;
    }
}

/** A bus that always mixes in-thread. `reason` is what the report shows. */
export function createJsMixBus(reason: string | null = null): MixBus {
    return {
        status: () => ({ engine: 'js', reason }),
        begin: (frames, channelCount = 2) => new JsMixSession(frames, channelCount),
        dispose: () => {},
    };
}

interface PendingFinish {
    resolve: (result: MixResult) => void;
    reject: (error: Error) => void;
}

class NativeMixBus implements MixBus {
    private nextSession = 1;
    private readonly pending = new Map<number, PendingFinish>();
    private failure: string | null = null;
    /** @internal Errors that arrived before their session's finish(). */
    readonly sessionErrors = new Map<number, string>();
    private readonly worker: Worker;

    constructor(worker: Worker) {
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<MixBusResponse>) => this.onMessage(event.data);
        worker.onerror = (event: ErrorEvent) => {
            this.fail(`mix bus worker crashed: ${event.message || 'unknown error'}`);
        };
    }

    status(): MixBusStatus {
        return this.failure === null
            ? { engine: 'native-worker', reason: null }
            : { engine: 'js', reason: this.failure };
    }

    begin(frames: number, channelCount = 2): MixSession {
        if (this.failure !== null) return new JsMixSession(frames, channelCount);
        const session = this.nextSession++;
        this.post({ type: 'begin', session, frames, channelCount });
        return new NativeMixSession(this, session, frames, channelCount);
    }

    dispose(): void {
        this.fail('mix bus disposed');
        this.worker.terminate();
    }

    /** @internal */
    isFailed(): boolean {
        return this.failure !== null;
    }

    /** @internal */
    post(message: MixBusRequest, transfer: Transferable[] = []): void {
        this.worker.postMessage(message, transfer);
    }

    /** @internal */
    awaitFinish(session: number): Promise<MixResult> {
        if (this.failure !== null) return Promise.reject(new Error(this.failure));
        return new Promise<MixResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(session);
                this.post({ type: 'discard', session });
                reject(new Error(`mix bus worker did not finish within ${FINISH_TIMEOUT_MS} ms`));
            }, FINISH_TIMEOUT_MS);
            this.pending.set(session, {
                resolve: (result) => { clearTimeout(timer); resolve(result); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
            this.post({ type: 'finish', session });
        });
    }

    /** @internal Degrade every later session to JS and fail the open ones. */
    fail(reason: string): void {
        if (this.failure === null) this.failure = reason;
        const open = [...this.pending.values()];
        this.pending.clear();
        for (const p of open) p.reject(new Error(reason));
    }

    private onMessage(message: MixBusResponse): void {
        if (message.type === 'done') {
            this.pending.get(message.session)?.resolve({
                channels: message.channels,
                peaks: message.peaks,
                engine: 'native-worker',
            });
            this.pending.delete(message.session);
            return;
        }
        if (message.type === 'error') {
            if (message.session === null) {
                this.fail(message.message);
                return;
            }
            // A failed add poisons its session: the finish that follows must not
            // return a partial sum, so reject it now and let the session re-mix.
            const pending = this.pending.get(message.session);
            this.pending.delete(message.session);
            if (pending) pending.reject(new Error(message.message));
            else this.sessionErrors.set(message.session, message.message);
        }
    }
}

class NativeMixSession implements MixSession {
    private readonly sources: Source[] = [];
    private readonly bus: NativeMixBus;
    private readonly session: number;
    private readonly frames: number;
    private readonly channelCount: number;

    constructor(bus: NativeMixBus, session: number, frames: number, channelCount: number) {
        this.bus = bus;
        this.session = session;
        this.frames = frames;
        this.channelCount = channelCount;
    }

    add(channels: readonly Float32Array[], gain = 1): void {
        this.sources.push({ channels, gain });
        if (this.bus.isFailed() || channels.length === 0) return;
        // AudioBuffer channel views cannot be transferred; copy once and hand
        // the copy over. At most one stem copy is in flight per add.
        const copies = channels
            .slice(0, this.channelCount)
            .map((channel) => channel.slice(0, Math.min(channel.length, this.frames)));
        this.bus.post(
            { type: 'add', session: this.session, channels: copies, gain },
            copies.map((copy) => copy.buffer),
        );
    }

    async finish(): Promise<MixResult> {
        const early = this.bus.sessionErrors.get(this.session);
        try {
            if (early !== undefined) {
                this.bus.sessionErrors.delete(this.session);
                this.bus.post({ type: 'discard', session: this.session });
                throw new Error(early);
            }
            return await this.bus.awaitFinish(this.session);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.bus.fail(reason);
            logEngineFallback(MIX_BUS_SUBSYSTEM, 'native-worker', 'mix bus worker failed mid-export', error);
            return mixInJs(this.frames, this.channelCount, this.sources);
        }
    }

    discard(): void {
        this.sources.length = 0;
        if (!this.bus.isFailed()) this.bus.post({ type: 'discard', session: this.session });
    }
}

export interface CreateMixBusOptions {
    /** Defaults to a module worker on the bundled `mixBus.worker.ts`. */
    createWorker?: () => Worker;
    /** Defaults to `mix_bus.wasm` resolved against the deploy base. */
    wasmUrl?: string;
    readyTimeoutMs?: number;
}

function waitForReady(worker: Worker, wasmUrl: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            cleanup();
            resolve(`mix bus worker did not start within ${timeoutMs} ms`);
        }, timeoutMs);
        const onMessage = (event: MessageEvent<MixBusResponse>) => {
            if (event.data.type === 'ready') {
                cleanup();
                resolve(null);
            } else if (event.data.type === 'init-failed') {
                cleanup();
                resolve(event.data.message);
            }
        };
        const onError = (event: ErrorEvent) => {
            cleanup();
            resolve(`mix bus worker failed to load: ${event.message || 'unknown error'}`);
        };
        function cleanup(): void {
            clearTimeout(timer);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
        }
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({ type: 'init', wasmUrl } satisfies MixBusRequest);
    });
}

/**
 * Start the native mix bus, or return the JS bus with the reason it could
 * not. Never rejects: a stem export must not fail because the fast path did.
 */
export async function createMixBus(options: CreateMixBusOptions = {}): Promise<MixBus> {
    const fallback = (reason: string): MixBus => {
        logEngineFallback(MIX_BUS_SUBSYSTEM, 'native-worker', reason);
        return createJsMixBus(reason);
    };

    if (typeof WebAssembly === 'undefined') return fallback('WebAssembly unavailable');
    if (!options.createWorker && typeof Worker === 'undefined') return fallback('Worker API unavailable');

    let worker: Worker;
    try {
        worker = options.createWorker
            ? options.createWorker()
            : new Worker(mixBusWorkerUrl, { type: 'module', name: 'hyphon-mix-bus' });
    } catch (error) {
        return fallback(`mix bus worker failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }

    const problem = await waitForReady(
        worker,
        options.wasmUrl ?? resolvePublicAsset('mix_bus.wasm'),
        options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    );
    if (problem !== null) {
        worker.terminate();
        return fallback(problem);
    }
    return new NativeMixBus(worker);
}
