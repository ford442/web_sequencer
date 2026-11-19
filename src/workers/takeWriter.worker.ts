/// <reference lib="webworker" />
/**
 * Take writer worker (#1498 P1). Drains the `recorder-processor` worklet's
 * ring (or, without SharedArrayBuffer, the chunks it posts on a port handed
 * straight to this worker) into OPFS through a `FileSystemSyncAccessHandle`.
 * The page never holds the take: it allocates the ring and gets progress.
 *
 * The header is patched and the file flushed once a second, so a killed tab
 * leaves a valid WAV up to the last flush, and its `state: 'recording'` meta
 * file tells the next load to offer it (`scan` / `recover`).
 *
 * Loaded via `?worker&url` from src/audio/recording/takeRecorder.ts.
 */
import { TakeFileWriter, recoverTakeFile } from '@/audio/recording/takeFileWriter';
import { framesInFile } from '@/audio/recording/wavTakeFile';
import {
    TAKES_DIR,
    TAKE_ID_PATTERN,
    parseTakeMeta,
    takeMetaName,
    takeWavName,
    type TakeMeta,
    type TakeWorkerReply,
    type TakeWorkerRequest,
} from '@/audio/recording/takeProtocol';
import { TAKE_STATE_RECORDING, TakeRingReader, type RecorderFeed } from '@/shared/rt/takeRing';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** How often the ring is drained. The ring holds seconds, so this has slack. */
const DRAIN_MS = 20;
const PROGRESS_MS = 250;

interface ActiveTake {
    meta: TakeMeta;
    writer: TakeFileWriter;
    ring: TakeRingReader | null;
    scratch: Float32Array | null;
    port: MessagePort | null;
    /** Port mode: the worklet sent `done`. */
    portDone: boolean;
    /** Port mode: the frame the take ended on. */
    portEndFrame: number | null;
    onPortDone: (() => void) | null;
    lastProgress: number;
}

const active = new Map<string, ActiveTake>();
let timer: ReturnType<typeof setInterval> | null = null;

function post(message: TakeWorkerReply): void {
    scope.postMessage(message);
}

class UnsupportedError extends Error {}

async function takesDir(create = true): Promise<FileSystemDirectoryHandle> {
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    if (typeof storage?.getDirectory !== 'function') throw new UnsupportedError('this browser has no origin private file system');
    const root = await storage.getDirectory();
    return root.getDirectoryHandle(TAKES_DIR, { create });
}

async function openSync(dir: FileSystemDirectoryHandle, name: string, create: boolean): Promise<FileSystemSyncAccessHandle> {
    const handle = await dir.getFileHandle(name, { create });
    if (typeof (handle as { createSyncAccessHandle?: unknown }).createSyncAccessHandle !== 'function') {
        throw new UnsupportedError('this browser cannot write files from a worker (no FileSystemSyncAccessHandle)');
    }
    return handle.createSyncAccessHandle();
}

async function writeMeta(dir: FileSystemDirectoryHandle, meta: TakeMeta): Promise<void> {
    const file = await openSync(dir, takeMetaName(meta.id), true);
    try {
        const bytes = new TextEncoder().encode(JSON.stringify(meta));
        file.truncate(0);
        file.write(bytes, { at: 0 });
        file.flush();
    } finally {
        file.close();
    }
}

/**
 * Meta writes for one take, one at a time: a sync access handle is exclusive,
 * so a second write while the first holds the file would throw.
 */
const metaQueues = new Map<string, Promise<void>>();

function queueMeta(meta: TakeMeta): Promise<void> {
    const snapshot = { ...meta };
    const next = (metaQueues.get(meta.id) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => writeMeta(await takesDir(), snapshot));
    metaQueues.set(meta.id, next);
    void next.finally(() => {
        if (metaQueues.get(meta.id) === next) metaQueues.delete(meta.id);
    }).catch(() => undefined);
    return next;
}

async function readMeta(dir: FileSystemDirectoryHandle, id: string): Promise<TakeMeta | null> {
    try {
        const file = await (await dir.getFileHandle(takeMetaName(id))).getFile();
        return parseTakeMeta(await file.text());
    } catch {
        return null;
    }
}

/** Move whatever the ring holds into the file. */
function drain(take: ActiveTake): void {
    const { ring, scratch, writer } = take;
    if (!ring || !scratch) return;
    const { frames, dropped } = ring.drain(scratch);
    if (frames > 0 && take.meta.startFrame === null) noteStart(take, ring.startFrame());
    writer.append(scratch, frames);
    writer.appendSilence(dropped);
    take.meta.droppedFrames += dropped;
}

function noteStart(take: ActiveTake, startFrame: number): void {
    take.meta.startFrame = startFrame;
    // The start frame is what aligns the take: put it on disk with the first frames.
    queueMeta(take.meta).catch(() => { /* written again at finish */ });
}

function progress(take: ActiveTake, now: number): void {
    if (now - take.lastProgress < PROGRESS_MS) return;
    take.lastProgress = now;
    post({ t: 'progress', id: take.meta.id, frames: take.writer.frames, dropped: take.meta.droppedFrames });
}

function tick(): void {
    const now = Date.now();
    for (const take of active.values()) {
        try {
            drain(take);
        } catch (err) {
            console.error('[take writer] drain failed:', err);
        }
        progress(take, now);
    }
    if (active.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
    }
}

function onFeed(take: ActiveTake, msg: RecorderFeed): void {
    if (msg.t === 'frames') {
        if (take.meta.startFrame === null) noteStart(take, msg.takeStart);
        take.writer.append(msg.data, msg.frames);
        progress(take, Date.now());
    } else if (msg.t === 'done') {
        take.portDone = true;
        take.portEndFrame = msg.endFrame;
        take.onPortDone?.();
    }
}

async function begin(meta: TakeMeta, ring: SharedArrayBuffer | null, port: MessagePort | null): Promise<TakeMeta> {
    if (!TAKE_ID_PATTERN.test(meta.id)) throw new Error(`bad take id ${meta.id}`);
    const dir = await takesDir();
    const file = await openSync(dir, takeWavName(meta.id), true);
    const writer = new TakeFileWriter(file, { sampleRate: meta.sampleRate, channels: meta.channels });
    const reader = ring ? new TakeRingReader(ring) : null;
    const take: ActiveTake = {
        meta: { ...meta, state: 'recording', frames: 0, droppedFrames: 0, startFrame: null },
        writer,
        ring: reader,
        scratch: reader ? new Float32Array(reader.capacity * reader.channels) : null,
        port,
        portDone: false,
        portEndFrame: null,
        onPortDone: null,
        lastProgress: 0,
    };
    await queueMeta(take.meta);
    active.set(meta.id, take);
    if (port) {
        port.onmessage = (e: MessageEvent<RecorderFeed>) => {
            try {
                onFeed(take, e.data);
            } catch (err) {
                console.error('[take writer] write failed:', err);
            }
        };
    }
    if (reader) timer ??= setInterval(tick, DRAIN_MS);
    return take.meta;
}

async function finish(id: string): Promise<TakeMeta> {
    const take = active.get(id);
    if (!take) throw new Error(`no take ${id} is recording`);
    if (take.port && !take.portDone) {
        // The worklet's last chunk and `done` travel on the port, not with this request.
        await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 2000);
            take.onPortDone = () => {
                clearTimeout(timeout);
                resolve();
            };
        });
    }
    drain(take);
    active.delete(id);
    take.port?.close();
    const meta: TakeMeta = { ...take.meta, state: 'complete' };
    if (meta.startFrame === null && take.ring) meta.startFrame = take.ring.startFrame();
    // The take ends on its stop frame even when the stop reached the worklet late.
    const endFrame = take.ring ? take.ring.endFrame() : take.portEndFrame;
    if (meta.startFrame !== null && endFrame !== null && take.ring?.state() !== TAKE_STATE_RECORDING) {
        take.writer.truncate(endFrame - meta.startFrame);
    }
    meta.droppedFrames = Math.min(meta.droppedFrames, take.writer.frames);
    const frames = take.writer.finish();
    meta.frames = frames;
    await queueMeta(meta);
    post({ t: 'progress', id, frames, dropped: meta.droppedFrames });
    return meta;
}

async function remove(dir: FileSystemDirectoryHandle, id: string): Promise<void> {
    for (const name of [takeWavName(id), takeMetaName(id)]) {
        try {
            await dir.removeEntry(name);
        } catch {
            /* already gone */
        }
    }
}

async function abort(id: string): Promise<void> {
    const take = active.get(id);
    if (take) {
        active.delete(id);
        take.port?.close();
        take.writer.abandon();
    }
    await metaQueues.get(id)?.catch(() => undefined);
    await remove(await takesDir(), id);
}

/** Takes a dead tab left mid-recording. A take another tab is still writing is locked and skipped. */
async function scan(): Promise<TakeMeta[]> {
    let dir: FileSystemDirectoryHandle;
    try {
        dir = await takesDir(false);
    } catch {
        return []; // nothing was ever recorded
    }
    const found: TakeMeta[] = [];
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
        const id = name.slice(0, -'.json'.length);
        if (!TAKE_ID_PATTERN.test(id) || active.has(id)) continue;
        const meta = await readMeta(dir, id);
        if (!meta || meta.state !== 'recording') continue;
        let file: FileSystemSyncAccessHandle;
        try {
            file = await openSync(dir, takeWavName(id), false);
        } catch {
            continue; // locked by a live recorder, or the audio is gone
        }
        try {
            const format = { sampleRate: meta.sampleRate, channels: meta.channels };
            found.push({ ...meta, frames: framesInFile(format, file.getSize()) });
        } finally {
            file.close();
        }
    }
    found.sort((a, b) => a.createdAt - b.createdAt);
    return found;
}

async function recover(id: string): Promise<TakeMeta> {
    if (!TAKE_ID_PATTERN.test(id)) throw new Error(`bad take id ${id}`);
    const dir = await takesDir();
    const meta = await readMeta(dir, id);
    if (!meta) throw new Error(`take ${id} has no metadata`);
    if (meta.state !== 'recording') return meta;
    const file = await openSync(dir, takeWavName(id), false);
    let result: ReturnType<typeof recoverTakeFile>;
    try {
        result = recoverTakeFile(file);
    } finally {
        file.close();
    }
    if (!result) throw new Error(`take ${id} is not a file this build wrote`);
    const recovered: TakeMeta = { ...meta, state: 'recovered', frames: result.frames };
    await queueMeta(recovered);
    return recovered;
}

async function handle(msg: TakeWorkerRequest): Promise<Omit<Extract<TakeWorkerReply, { ok: true }>, 't' | 'rid' | 'ok'>> {
    switch (msg.t) {
        case 'begin': return { meta: await begin(msg.meta, msg.ring, msg.port) };
        case 'finish': return { meta: await finish(msg.id) };
        case 'abort': await abort(msg.id); return {};
        case 'scan': return { takes: await scan() };
        case 'recover': return { meta: await recover(msg.id) };
        case 'discard':
            if (!TAKE_ID_PATTERN.test(msg.id)) throw new Error(`bad take id ${msg.id}`);
            if (active.has(msg.id)) throw new Error(`take ${msg.id} is still recording`);
            await remove(await takesDir(), msg.id);
            return {};
    }
}

scope.onmessage = (event: MessageEvent<TakeWorkerRequest>) => {
    const msg = event.data;
    if (!msg || typeof msg.rid !== 'number') return;
    handle(msg).then(
        (body) => post({ t: 'reply', rid: msg.rid, ok: true, ...body }),
        (err: unknown) => post({
            t: 'reply',
            rid: msg.rid,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            unsupported: err instanceof UnsupportedError,
        }),
    );
};
