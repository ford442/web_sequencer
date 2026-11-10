// Project storage over the Origin Private File System (OPFS), with an
// IndexedDB fallback for browsers that expose `navigator.storage.getDirectory`
// only partially (or not at all) and an in-memory fallback for SSR/tests
// (the backends live in `projectFileBackends.ts`).
//
// Unlike `utils/projectPersistence.ts` (localStorage, 512 KB cap, strips
// samples/background image before saving), a project here is a directory:
//   hyphon-projects/<id>/project.json       — SavedSongData minus blobs
//   hyphon-projects/<id>/samples/<hash>.wav — content-addressed sample banks
//   hyphon-projects/<id>/assets/<hash>.ext  — content-addressed background image
//   hyphon-projects/<id>/shutdown.json      — { clean, at } crash-recovery marker
//   hyphon-projects/<id>/doc.ylog           — Yjs update log of the project doc (v2, see below)
// Duplicate sample content (same bank re-saved, or shared across projects)
// is written once and referenced by hash, so autosaving repeatedly does not
// multiply storage use.
//
// There is no size cap: OPFS/IndexedDB quotas are origin-wide and much larger
// than localStorage (typically a meaningful fraction of free disk), and
// `requestPersistence()` asks the browser not to evict the origin under
// storage pressure.
//
// v2 (#1597) adds the project document's update log (`src/collab/updateLog.ts`).
// A project gets one when it is first opened in a collab session; from then on
// every save keeps it in step — through the open session's live doc, or, with
// no session open, by rebuilding the doc from the log and appending the diff.
// project.json stays the readable snapshot `loadProject` reads, and projects
// that never had a session never load the CRDT library. Log writes run under a
// per-project lock (Web Locks across tabs, a promise chain within one).

import type { SavedSongData } from '@/types';
import { appendToUpdateLog, decodeUpdateLog, encodeUpdateLog } from '@/collab/updateLog';
import { detectBackend, type ProjectFileBackend } from './projectFileBackends';
import {
    AUTOSAVE_KEY,
    loadSessionFromLocalStorage,
    clearSessionFromLocalStorage,
    type StorageBackend,
} from '@/utils/projectPersistence';

/** 1 = project.json + content-addressed blobs; 2 = adds the optional `doc.ylog`. */
export const PROJECT_STORE_VERSION = 2;
export const AUTOSAVE_PROJECT_ID = 'autosave';

const PROJECTS_ROOT = 'hyphon-projects';
const DOC_LOG_FILE = 'doc.ylog';

/** An open collab session's doc for a project: saves go into it, not around it. */
export interface LiveProjectDoc {
    /** Write the saved song (blobs stripped) into the live doc and persist the change. */
    writeSavedSong(song: SavedSongData): Promise<void>;
}

/**
 * The CRDT side of a save with no session open. Loaded on demand, so the CRDT
 * library is fetched only for projects that have a doc log.
 */
export interface ProjectDocCodec {
    /**
     * The log frames after writing `song` into the doc `frames` rebuild (null
     * when it already holds it). New edits continue `clientId` when the log
     * already holds edits by it, and use a fresh id otherwise; the id used is
     * returned so the next save can pass it back.
     */
    nextFrames(
        frames: readonly Uint8Array[],
        song: SavedSongData,
        clientId: number | null,
    ): { frames: Uint8Array[] | null; clientId: number };
}

export interface ProjectStoreOptions {
    loadDocCodec?: () => Promise<ProjectDocCodec>;
}

const loadDefaultDocCodec = (): Promise<ProjectDocCodec> =>
    import('@/collab/projectDocCodec').then((module) => module.projectDocCodec);

/**
 * Doc-log lock chains, per lock name. Module-wide rather than per store, so two
 * stores in one page (tests, a second instance) also take turns.
 */
const lockChains = new Map<string, Promise<unknown>>();

/** Runs `fn` holding the named Web Lock where the browser has them (all tabs of the origin). */
function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined'
        ? (navigator as { locks?: { request?: (n: string, cb: () => Promise<T>) => Promise<T> } }).locks
        : undefined;
    return typeof locks?.request === 'function' ? locks.request(name, fn) : fn();
}

export interface ProjectMeta {
    id: string;
    updatedAt: number;
    /** false when the last session touching this project did not shut down cleanly. */
    cleanShutdown: boolean;
}

export type { ProjectFileBackend };

export interface SaveProjectResult {
    ok: boolean;
    error?: string;
}

// ── content addressing / encoding helpers ──────────────────────────────────────

/** Non-cryptographic content hash (FNV-1a/64). Good enough for local dedup keys. */
export function contentHash(bytes: Uint8Array): string {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= BigInt(bytes[i]);
        hash = (hash * prime) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
}

function base64ToBytes(base64: string): Uint8Array {
    if (typeof atob === 'function') {
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }
    return new Uint8Array(Buffer.from(base64, 'base64'));
}

function bytesToBase64(bytes: Uint8Array): string {
    if (typeof btoa === 'function') {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }
    return Buffer.from(bytes).toString('base64');
}

function parseDataUrl(url: string): { mime: string; base64: string } | null {
    const match = /^data:([^;,]*)(?:;charset=[^;,]+)?;base64,([\s\S]*)$/.exec(url);
    if (!match) return null;
    return { mime: match[1] || 'application/octet-stream', base64: match[2] };
}

function toDataUrl(mime: string, bytes: Uint8Array): string {
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

const MIME_TO_EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
};

function mimeToExt(mime: string): string {
    return MIME_TO_EXT[mime] ?? 'bin';
}

// ── stored project.json shape ────────────────────────────────────────────────

interface StoredProjectJson extends Omit<SavedSongData, 'embeddedSamples' | 'backgroundImage'> {
    schemaVersion: number;
    updatedAt: number;
    sampleRefs?: Record<string, string>;
    backgroundImageRef?: string;
    backgroundImageMime?: string;
    /** Background image was a plain (non-data:) URL — stored verbatim, nothing to content-address. */
    backgroundImageUrl?: string;
}

interface ShutdownMeta {
    clean: boolean;
    at: number;
}

// ── ProjectStore ─────────────────────────────────────────────────────────────

export class ProjectStore {
    private backendPromise: Promise<ProjectFileBackend> | null = null;
    private readonly backendOverride?: ProjectFileBackend;
    private readonly loadDocCodec: () => Promise<ProjectDocCodec>;
    private readonly liveDocs = new Map<string, LiveProjectDoc>();
    /** Client id this store's session-less doc writes continue (per project). */
    private readonly docClientIds = new Map<string, number>();

    /** Pass a backend to bypass auto-detection (tests, or a forced fallback). */
    constructor(backendOverride?: ProjectFileBackend, options: ProjectStoreOptions = {}) {
        this.backendOverride = backendOverride;
        this.loadDocCodec = options.loadDocCodec ?? loadDefaultDocCodec;
    }

    private getBackend(): Promise<ProjectFileBackend> {
        if (this.backendOverride) return Promise.resolve(this.backendOverride);
        if (!this.backendPromise) this.backendPromise = detectBackend();
        return this.backendPromise;
    }

    async backendKind(): Promise<ProjectFileBackend['kind']> {
        return (await this.getBackend()).kind;
    }

    private path(id: string, ...segments: string[]): string {
        return [PROJECTS_ROOT, id, ...segments].join('/');
    }

    async saveProject(id: string, data: SavedSongData): Promise<SaveProjectResult> {
        try {
            const backend = await this.getBackend();
            const { embeddedSamples, backgroundImage, ...rest } = data;

            let sampleRefs: Record<string, string> | undefined;
            if (embeddedSamples) {
                sampleRefs = {};
                for (const [bankIdx, dataUrl] of Object.entries(embeddedSamples)) {
                    const parsed = parseDataUrl(dataUrl);
                    if (!parsed) continue;
                    const bytes = base64ToBytes(parsed.base64);
                    const hash = contentHash(bytes);
                    const samplePath = this.path(id, 'samples', `${hash}.wav`);
                    if (!(await backend.exists(samplePath))) {
                        await backend.writeFile(samplePath, bytes);
                    }
                    sampleRefs[bankIdx] = hash;
                }
                if (Object.keys(sampleRefs).length === 0) sampleRefs = undefined;
            }

            let backgroundImageRef: string | undefined;
            let backgroundImageMime: string | undefined;
            let backgroundImageUrl: string | undefined;
            if (backgroundImage) {
                const parsed = parseDataUrl(backgroundImage);
                if (parsed) {
                    const bytes = base64ToBytes(parsed.base64);
                    const hash = contentHash(bytes);
                    const assetPath = this.path(id, 'assets', `${hash}.${mimeToExt(parsed.mime)}`);
                    if (!(await backend.exists(assetPath))) {
                        await backend.writeFile(assetPath, bytes);
                    }
                    backgroundImageRef = hash;
                    backgroundImageMime = parsed.mime;
                } else {
                    backgroundImageUrl = backgroundImage;
                }
            }

            const stored: StoredProjectJson = {
                ...rest,
                schemaVersion: PROJECT_STORE_VERSION,
                updatedAt: Date.now(),
                sampleRefs,
                backgroundImageRef,
                backgroundImageMime,
                backgroundImageUrl,
            };
            // Written *before* project.json: a save implies the session is
            // mid-edit, and if the app dies between these two writes, the
            // next boot should still see "dirty" rather than a stale "clean"
            // from a previous, no-longer-accurate save. Only an explicit
            // markCleanShutdown() flips this back.
            const dirtyMeta: ShutdownMeta = { clean: false, at: Date.now() };
            await backend.writeFile(this.path(id, 'shutdown.json'), JSON.stringify(dirtyMeta));
            await backend.writeFile(this.path(id, 'project.json'), JSON.stringify(stored));
            await this.syncProjectDoc(id, rest);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }

    /** project.json as stored, v1 or v2 (the formats differ only beside it). */
    private async readStoredProject(id: string): Promise<StoredProjectJson | null> {
        const backend = await this.getBackend();
        const text = await backend.readText(this.path(id, 'project.json'));
        if (!text) return null;
        try {
            return JSON.parse(text) as StoredProjectJson;
        } catch {
            return null;
        }
    }

    async loadProject(id: string): Promise<SavedSongData | null> {
        const backend = await this.getBackend();
        const stored = await this.readStoredProject(id);
        if (!stored) return null;

        const { sampleRefs, backgroundImageRef, backgroundImageMime, backgroundImageUrl, schemaVersion: _sv, updatedAt: _u, ...rest } = stored;
        void _sv;
        void _u;

        const embeddedSamples: Record<number, string> = {};
        if (sampleRefs) {
            for (const [bankIdx, hash] of Object.entries(sampleRefs)) {
                const bytes = await backend.readFile(this.path(id, 'samples', `${hash}.wav`));
                if (bytes) embeddedSamples[Number(bankIdx)] = toDataUrl('audio/wav', bytes);
            }
        }

        let backgroundImage: string | undefined = backgroundImageUrl;
        if (backgroundImageRef && backgroundImageMime) {
            const bytes = await backend.readFile(
                this.path(id, 'assets', `${backgroundImageRef}.${mimeToExt(backgroundImageMime)}`),
            );
            if (bytes) backgroundImage = toDataUrl(backgroundImageMime, bytes);
        }

        return {
            ...(rest as Omit<SavedSongData, 'embeddedSamples' | 'backgroundImage'>),
            ...(Object.keys(embeddedSamples).length ? { embeddedSamples } : {}),
            ...(backgroundImage ? { backgroundImage } : {}),
        } as SavedSongData;
    }

    /**
     * The saved song without its blobs and without resolving them: what the
     * project doc holds (samples and the background image stay content-addressed
     * files; see `saveProject`).
     */
    async loadProjectSnapshot(id: string): Promise<SavedSongData | null> {
        const stored = await this.readStoredProject(id);
        if (!stored) return null;
        const {
            sampleRefs: _sr,
            backgroundImageRef: _br,
            backgroundImageMime: _bm,
            backgroundImageUrl: _bu,
            schemaVersion: _sv,
            updatedAt: _u,
            ...rest
        } = stored;
        void [_sr, _br, _bm, _bu, _sv, _u];
        return rest as SavedSongData;
    }

    // ── project doc log (v2) ────────────────────────────────────────────────

    /**
     * Route this project's saves through an open session's doc until the
     * returned function is called. One live doc per project and store.
     */
    attachLiveDoc(id: string, live: LiveProjectDoc): () => void {
        if (this.liveDocs.has(id)) throw new Error(`Project ${id} already has a live doc`);
        this.liveDocs.set(id, live);
        return () => {
            if (this.liveDocs.get(id) === live) this.liveDocs.delete(id);
        };
    }

    /** The doc log's frames; null when the project has no log (or an unreadable one). */
    async readDocLog(id: string): Promise<Uint8Array[] | null> {
        const backend = await this.getBackend();
        const bytes = await backend.readFile(this.path(id, DOC_LOG_FILE));
        return bytes ? (decodeUpdateLog(bytes)?.frames ?? null) : null;
    }

    /** Append one update to the doc log (creating it), under the project lock. */
    async appendDocUpdate(id: string, update: Uint8Array): Promise<void> {
        await this.withProjectLock(id, async () => {
            const backend = await this.getBackend();
            const path = this.path(id, DOC_LOG_FILE);
            await backend.writeFile(path, appendToUpdateLog(await backend.readFile(path), update));
        });
    }

    /**
     * Read-modify-write of the doc log under the project lock: `fn` gets the
     * current frames (null = no log) and returns the new ones, or null to leave
     * the log as it is.
     */
    async updateDocLog(
        id: string,
        fn: (frames: Uint8Array[] | null) => Uint8Array[] | null | Promise<Uint8Array[] | null>,
    ): Promise<void> {
        await this.withProjectLock(id, async () => {
            const next = await fn(await this.readDocLog(id));
            if (next) await (await this.getBackend()).writeFile(this.path(id, DOC_LOG_FILE), encodeUpdateLog(next));
        });
    }

    private withProjectLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
        const name = `hyphon-project:${id}`;
        const run = () => withCrossTabLock(name, fn);
        const next = (lockChains.get(name) ?? Promise.resolve()).then(run, run);
        const settled = next.catch(() => undefined);
        lockChains.set(name, settled);
        void settled.then(() => {
            if (lockChains.get(name) === settled) lockChains.delete(name);
        });
        return next;
    }

    /** Keep the doc log in step with a save (see the file header). */
    private async syncProjectDoc(id: string, song: SavedSongData): Promise<void> {
        try {
            const live = this.liveDocs.get(id);
            if (live) {
                await live.writeSavedSong(song);
                return;
            }
            const backend = await this.getBackend();
            if (!(await backend.exists(this.path(id, DOC_LOG_FILE)))) return;
            const codec = await this.loadDocCodec();
            await this.updateDocLog(id, (frames) => {
                if (!frames) return null;
                const result = codec.nextFrames(frames, song, this.docClientIds.get(id) ?? null);
                this.docClientIds.set(id, result.clientId);
                return result.frames;
            });
        } catch (err) {
            throw new Error(`Project doc log: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    async hasProject(id: string): Promise<boolean> {
        const backend = await this.getBackend();
        return backend.exists(this.path(id, 'project.json'));
    }

    async deleteProject(id: string): Promise<void> {
        const backend = await this.getBackend();
        await backend.deleteDir(this.path(id));
    }

    async listProjects(): Promise<ProjectMeta[]> {
        const backend = await this.getBackend();
        const ids = await backend.listDirs(PROJECTS_ROOT);
        const metas: ProjectMeta[] = [];
        for (const id of ids) {
            const text = await backend.readText(this.path(id, 'project.json'));
            if (!text) continue;
            let updatedAt = 0;
            try {
                updatedAt = (JSON.parse(text) as { updatedAt?: number }).updatedAt ?? 0;
            } catch {
                /* corrupt project.json — still list it so it can be inspected/deleted */
            }
            const shutdown = await this.readShutdownMeta(backend, id);
            metas.push({ id, updatedAt, cleanShutdown: shutdown?.clean ?? true });
        }
        return metas.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    private async readShutdownMeta(backend: ProjectFileBackend, id: string): Promise<ShutdownMeta | null> {
        const text = await backend.readText(this.path(id, 'shutdown.json'));
        if (!text) return null;
        try {
            return JSON.parse(text) as ShutdownMeta;
        } catch {
            return null;
        }
    }

    async markCleanShutdown(id: string): Promise<void> {
        const backend = await this.getBackend();
        if (!(await backend.exists(this.path(id, 'project.json')))) return;
        const cleanMeta: ShutdownMeta = { clean: true, at: Date.now() };
        await backend.writeFile(this.path(id, 'shutdown.json'), JSON.stringify(cleanMeta));
    }

    /**
     * True/false = whether the project's last session shut down cleanly.
     * Null = the project does not exist (nothing to recover).
     */
    async wasCleanShutdown(id: string): Promise<boolean | null> {
        const backend = await this.getBackend();
        if (!(await backend.exists(this.path(id, 'project.json')))) return null;
        const meta = await this.readShutdownMeta(backend, id);
        // No shutdown.json yet (older data, or first-ever save mid-flight) — assume clean.
        return meta ? meta.clean : true;
    }

    /** Ask the browser not to evict this origin's storage under pressure. */
    async requestPersistence(): Promise<boolean> {
        if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
        try {
            return await navigator.storage.persist();
        } catch {
            return false;
        }
    }

    async getQuota(): Promise<{ usage: number; quota: number } | null> {
        if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
        try {
            const { usage, quota } = await navigator.storage.estimate();
            return { usage: usage ?? 0, quota: quota ?? 0 };
        } catch {
            return null;
        }
    }

    /**
     * Lift a legacy `hyphon:autosave:v1` localStorage payload (see
     * utils/projectPersistence.ts) into the autosave project on first run,
     * then clear the old key. No-op (but still clears the key) when a newer
     * OPFS/IndexedDB autosave already exists, so a stale localStorage blob
     * never clobbers fresher data. Returns true when a legacy payload was found.
     * The localStorage key is cleared only once the data is durably migrated
     * (or was already superseded) — never on a failed save, which would
     * otherwise delete the only copy.
     */
    async migrateLegacyAutosave(storage?: StorageBackend): Promise<boolean> {
        const legacy = loadSessionFromLocalStorage(storage);
        if (!legacy) return false;
        if (!(await this.hasProject(AUTOSAVE_PROJECT_ID))) {
            const { autosaveVersion: _av, savedAt: _sa, samplesStripped: _ss, ...rest } = legacy;
            void _av;
            void _sa;
            void _ss;
            const result = await this.saveProject(AUTOSAVE_PROJECT_ID, rest as SavedSongData);
            if (!result.ok) {
                throw new Error(result.error ?? 'Legacy autosave migration failed');
            }
        }
        clearSessionFromLocalStorage(storage);
        return true;
    }
}

export const projectStore = new ProjectStore();

export { AUTOSAVE_KEY as LEGACY_AUTOSAVE_KEY };
