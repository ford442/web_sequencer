/**
 * Recording a take (#1498 P1), main-thread side.
 *
 *   input stream ─▶ MediaStreamAudioSourceNode ─▶ recorder-processor ─▶ muted gain ─▶ destination
 *                                                   │ take ring (SAB), or chunks on a port
 *                                                   ▼
 *                                         take writer worker ─▶ OPFS takes/<id>.wav + .json
 *
 * The page allocates the ring and wires the nodes; the audio goes from the
 * worklet to the worker without crossing the main thread, so a long take
 * does not grow the page's heap. `startTake` resolves once the worker holds
 * the file, then arms the worklet (on `atFrame`, or the next block).
 *
 * There is no fallback to `MediaRecorder`: a browser without what this needs
 * gets `RecordingUnsupportedError` with the reason (`recordingSupport`).
 */

import takeWorkerUrl from '@/workers/takeWriter.worker.ts?worker&url';
import { loadWorkletModule } from '@/audio/runtime/workletRegistry';
import { decodeWav, type DecodedAudio } from '@/audio/media/wav';
import {
    RECORDER_PROCESSOR_NAME,
    createTakeRing,
    type RecorderControl,
    type RecorderStatus,
} from '@/shared/rt/takeRing';
import {
    TAKES_DIR,
    TAKE_ID_PATTERN,
    newTakeId,
    takeWavName,
    type TakeMeta,
    type TakePurpose,
    type TakeWorkerReply,
    type TakeWorkerRequest,
} from './takeProtocol';
import { RecordingUnsupportedError, hasTakesFolder, recordingSupport } from './recordingSupport';

export { RecordingUnsupportedError, recordingSupport };

/** Seconds of audio the ring holds while the worker is late (it drains every 20 ms). */
const RING_SECONDS = 4;
/** How long `stop` waits for the worklet before closing the file anyway (a suspended context never answers). */
const STOP_TIMEOUT_MS = 2000;

function sharedMemory(): boolean {
    return typeof SharedArrayBuffer !== 'undefined'
        && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

function nextPowerOfTwo(n: number): number {
    return 2 ** Math.ceil(Math.log2(Math.max(2, n)));
}

type ReplyBody = Omit<Extract<TakeWorkerReply, { ok: true }>, 't' | 'rid' | 'ok'>;
type Request = TakeWorkerRequest extends infer R ? R extends { rid: number } ? Omit<R, 'rid'> : never : never;

class TakeWorkerClient {
    private readonly worker: Worker;
    private rid = 0;
    private readonly pending = new Map<number, { resolve: (body: ReplyBody) => void; reject: (err: Error) => void }>();
    private readonly progress = new Map<string, (frames: number, dropped: number) => void>();

    constructor() {
        this.worker = new Worker(takeWorkerUrl, { type: 'module', name: 'hyphon-take-writer' });
        this.worker.onmessage = (e: MessageEvent<TakeWorkerReply>) => this.onReply(e.data);
        this.worker.onerror = (e) => {
            const err = new Error(`take writer worker failed: ${e.message || 'load error'}`);
            for (const p of this.pending.values()) p.reject(err);
            this.pending.clear();
        };
    }

    private onReply(msg: TakeWorkerReply): void {
        if (msg.t === 'progress') {
            this.progress.get(msg.id)?.(msg.frames, msg.dropped);
            return;
        }
        const p = this.pending.get(msg.rid);
        if (!p) return;
        this.pending.delete(msg.rid);
        if (msg.ok) {
            // Strip the envelope; what is left is the reply body.
            const body: Record<string, unknown> = { ...msg };
            delete body.t;
            delete body.rid;
            delete body.ok;
            p.resolve(body as ReplyBody);
        } else {
            p.reject(msg.unsupported ? new RecordingUnsupportedError(msg.error) : new Error(msg.error));
        }
    }

    request(msg: Request, transfer: Transferable[] = []): Promise<ReplyBody> {
        const rid = ++this.rid;
        return new Promise((resolve, reject) => {
            this.pending.set(rid, { resolve, reject });
            this.worker.postMessage({ ...msg, rid }, transfer);
        });
    }

    onProgress(id: string, cb: ((frames: number, dropped: number) => void) | null): void {
        if (cb) this.progress.set(id, cb);
        else this.progress.delete(id);
    }
}

let client: TakeWorkerClient | null = null;
function worker(): TakeWorkerClient {
    client ??= new TakeWorkerClient();
    return client;
}

export interface TakeInput {
    stream: MediaStream;
    channels: 1 | 2;
    label: string;
}

export interface StartTakeOptions {
    context: AudioContext;
    input: TakeInput;
    purpose?: TakePurpose;
    /** Context frame of the first sample; omitted = as soon as the take is armed. */
    atFrame?: number;
}

export interface TakeSession {
    readonly id: string;
    readonly sampleRate: number;
    readonly channels: 1 | 2;
    /** The context frame of the first captured sample. */
    readonly started: Promise<number>;
    /** Frames on disk and frames dropped so far, a few times a second. */
    onProgress(cb: (frames: number, dropped: number) => void): void;
    /** Stop at `atFrame` (exclusive), or the next block; resolves with the finished take. */
    stop(atFrame?: number): Promise<TakeMeta>;
    /** Stop and delete the take. */
    abort(): Promise<void>;
}

export async function startTake(options: StartTakeOptions): Promise<TakeSession> {
    const support = recordingSupport();
    if (!support.ok) throw new RecordingUnsupportedError(support.reason);
    const { context, input } = options;
    const channels = input.channels;

    const { default: workletUrl } = await import('../../audio-worklets/recorder-processor.ts?worker&url');
    await loadWorkletModule(context, workletUrl, RECORDER_PROCESSOR_NAME);

    let source: MediaStreamAudioSourceNode;
    try {
        source = context.createMediaStreamSource(input.stream);
    } catch (err) {
        // Firefox: an input at another rate than the context cannot be connected.
        throw new RecordingUnsupportedError(
            `this browser cannot connect the input to the ${context.sampleRate} Hz engine (${err instanceof Error ? err.message : String(err)})`,
        );
    }

    const ring = sharedMemory() ? createTakeRing(nextPowerOfTwo(context.sampleRate * RING_SECONDS), channels) : null;
    const node = new AudioWorkletNode(context, RECORDER_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: channels,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { channels, ring },
    });
    let workerPort: MessagePort | null = null;
    if (!ring) {
        const channel = new MessageChannel();
        node.port.postMessage({ t: 'feed', port: channel.port1 }, [channel.port1]);
        workerPort = channel.port2;
    }
    const sink = context.createGain();
    sink.gain.value = 0;
    const teardown = () => {
        try { source.disconnect(); } catch { /* gone */ }
        try { node.disconnect(); } catch { /* gone */ }
        try { sink.disconnect(); } catch { /* gone */ }
        node.port.onmessage = null;
    };

    const id = newTakeId();
    const meta: TakeMeta = {
        version: 1,
        id,
        state: 'recording',
        purpose: options.purpose ?? 'take',
        sampleRate: context.sampleRate,
        channels,
        startFrame: null,
        frames: 0,
        droppedFrames: 0,
        inputLabel: input.label,
        createdAt: Date.now(),
    };
    const client = worker();
    try {
        await client.request({ t: 'begin', meta, ring, port: workerPort }, workerPort ? [workerPort] : []);
    } catch (err) {
        teardown();
        throw err;
    }

    let resolveStarted!: (frame: number) => void;
    const started = new Promise<number>((resolve) => { resolveStarted = resolve; });
    let resolveStopped!: (status: Extract<RecorderStatus, { t: 'stopped' }>) => void;
    const stopped = new Promise<Extract<RecorderStatus, { t: 'stopped' }>>((resolve) => { resolveStopped = resolve; });
    node.port.onmessage = (e: MessageEvent<RecorderStatus>) => {
        if (e.data?.t === 'started') resolveStarted(e.data.frame);
        else if (e.data?.t === 'stopped') {
            resolveStarted(e.data.startFrame);
            resolveStopped(e.data);
        }
    };

    source.connect(node);
    node.connect(sink);
    sink.connect(context.destination);
    const control = (msg: RecorderControl) => node.port.postMessage(msg);
    control(options.atFrame === undefined ? { t: 'start' } : { t: 'start', atFrame: options.atFrame });

    let ending: Promise<TakeMeta> | null = null;
    const stop = (atFrame?: number): Promise<TakeMeta> => {
        ending ??= (async () => {
            control(atFrame === undefined ? { t: 'stop' } : { t: 'stop', atFrame });
            const report = await Promise.race([
                stopped,
                new Promise<null>((resolve) => setTimeout(() => resolve(null), STOP_TIMEOUT_MS + Math.max(0,
                    atFrame === undefined ? 0 : (atFrame / context.sampleRate - context.currentTime) * 1000))),
            ]);
            teardown();
            client.onProgress(id, null);
            const { meta: done } = await client.request({ t: 'finish', id });
            if (!done) throw new Error(`take ${id}: the writer returned no metadata`);
            return done.startFrame === null && report ? { ...done, startFrame: report.startFrame } : done;
        })();
        return ending;
    };

    return {
        id,
        sampleRate: context.sampleRate,
        channels,
        started,
        onProgress: (cb) => client.onProgress(id, cb),
        stop,
        abort: async () => {
            await stop().catch(() => undefined);
            await client.request({ t: 'abort', id });
        },
    };
}

/** Takes a closed or crashed tab left mid-recording (another tab's live take is skipped). */
export async function listRecoverableTakes(): Promise<TakeMeta[]> {
    // No takes folder: nothing was ever recorded, and no worker is started to say so.
    if (!recordingSupport().ok || !(await hasTakesFolder())) return [];
    return (await worker().request({ t: 'scan' })).takes ?? [];
}

/** Make a partial take a valid WAV of what was flushed; it is no longer offered for recovery. */
export async function recoverTake(id: string): Promise<TakeMeta> {
    const { meta } = await worker().request({ t: 'recover', id });
    if (!meta) throw new Error(`take ${id}: the writer returned no metadata`);
    return meta;
}

export async function discardTake(id: string): Promise<void> {
    await worker().request({ t: 'discard', id });
}

/** The take's WAV file (a lazy OPFS `File`: reading it is up to the caller). */
export async function readTakeFile(id: string): Promise<File> {
    if (!TAKE_ID_PATTERN.test(id)) throw new Error(`bad take id ${id}`);
    const storage = navigator.storage as StorageManager & { getDirectory(): Promise<FileSystemDirectoryHandle> };
    const dir = await (await storage.getDirectory()).getDirectoryHandle(TAKES_DIR);
    return (await dir.getFileHandle(takeWavName(id))).getFile();
}

/** Decode a whole take, losslessly. For short takes (a sampler bank); the timeline streams instead. */
export async function decodeTake(id: string): Promise<DecodedAudio> {
    const file = await readTakeFile(id);
    const decoded = decodeWav(new Uint8Array(await file.arrayBuffer()));
    if (!decoded) throw new Error(`take ${id} is not a readable WAV`);
    return decoded;
}

/** A decoded take as an AudioBuffer at its own rate. */
export function toAudioBuffer(decoded: DecodedAudio): AudioBuffer {
    const length = Math.max(1, decoded.channels[0]?.length ?? 0);
    const buffer = new AudioBuffer({ length, numberOfChannels: decoded.channels.length, sampleRate: decoded.sampleRate });
    decoded.channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
    return buffer;
}
