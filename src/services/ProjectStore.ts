// Project storage over the Origin Private File System (OPFS), with an
// IndexedDB fallback for browsers that expose `navigator.storage.getDirectory`
// only partially (or not at all) and an in-memory fallback for SSR/tests.
//
// Unlike `utils/projectPersistence.ts` (localStorage, 512 KB cap, strips
// samples/background image before saving), a project here is a directory:
//   hyphon-projects/<id>/project.json       — SavedSongData minus blobs
//   hyphon-projects/<id>/samples/<hash>.wav — content-addressed sample banks
//   hyphon-projects/<id>/assets/<hash>.ext  — content-addressed background image
//   hyphon-projects/<id>/shutdown.json      — { clean, at } crash-recovery marker
// Duplicate sample content (same bank re-saved, or shared across projects)
// is written once and referenced by hash, so autosaving repeatedly does not
// multiply storage use.
//
// There is no size cap: OPFS/IndexedDB quotas are origin-wide and much larger
// than localStorage (typically a meaningful fraction of free disk), and
// `requestPersistence()` asks the browser not to evict the origin under
// storage pressure.

import type { SavedSongData } from '../types';
import {
    AUTOSAVE_KEY,
    loadSessionFromLocalStorage,
    clearSessionFromLocalStorage,
    type StorageBackend,
} from '../utils/projectPersistence';

export const PROJECT_STORE_VERSION = 1;
export const AUTOSAVE_PROJECT_ID = 'autosave';

const PROJECTS_ROOT = 'hyphon-projects';

export interface ProjectMeta {
    id: string;
    updatedAt: number;
    /** false when the last session touching this project did not shut down cleanly. */
    cleanShutdown: boolean;
}

export interface SaveProjectResult {
    ok: boolean;
    error?: string;
}

// ── File backend abstraction (directory paths use '/', no leading/trailing slash) ─

export interface ProjectFileBackend {
    readonly kind: 'opfs' | 'idb' | 'memory';
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
    readFile(path: string): Promise<Uint8Array | null>;
    readText(path: string): Promise<string | null>;
    exists(path: string): Promise<boolean>;
    deleteFile(path: string): Promise<void>;
    /** Immediate child directory names under `dirPath` (no trailing slash). */
    listDirs(dirPath: string): Promise<string[]>;
    /** Recursively delete everything under (and including) `dirPath`. */
    deleteDir(dirPath: string): Promise<void>;
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

// ── in-memory backend (SSR / tests / last-resort fallback) ─────────────────────

class MemoryBackend implements ProjectFileBackend {
    readonly kind = 'memory' as const;
    private files = new Map<string, Uint8Array>();

    writeFile(path: string, data: Uint8Array | string): Promise<void> {
        this.files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
        return Promise.resolve();
    }
    readFile(path: string): Promise<Uint8Array | null> {
        return Promise.resolve(this.files.get(path) ?? null);
    }
    readText(path: string): Promise<string | null> {
        const bytes = this.files.get(path);
        return Promise.resolve(bytes ? new TextDecoder().decode(bytes) : null);
    }
    exists(path: string): Promise<boolean> {
        return Promise.resolve(this.files.has(path));
    }
    deleteFile(path: string): Promise<void> {
        this.files.delete(path);
        return Promise.resolve();
    }
    listDirs(dirPath: string): Promise<string[]> {
        const prefix = `${dirPath}/`;
        const names = new Set<string>();
        for (const key of this.files.keys()) {
            if (!key.startsWith(prefix)) continue;
            const seg = key.slice(prefix.length).split('/')[0];
            if (seg) names.add(seg);
        }
        return Promise.resolve([...names]);
    }
    deleteDir(dirPath: string): Promise<void> {
        const prefix = `${dirPath}/`;
        for (const key of [...this.files.keys()]) {
            if (key === dirPath || key.startsWith(prefix)) this.files.delete(key);
        }
        return Promise.resolve();
    }
}

// ── IndexedDB backend ────────────────────────────────────────────────────────

const IDB_NAME = 'hyphon-project-store';
const IDB_STORE = 'files';

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

class IdbBackend implements ProjectFileBackend {
    readonly kind = 'idb' as const;
    private dbPromise: Promise<IDBDatabase> | null = null;

    private db(): Promise<IDBDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open(IDB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(IDB_STORE)) {
                        db.createObjectStore(IDB_STORE, { keyPath: 'path' });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return this.dbPromise;
    }

    private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
        const db = await this.db();
        return db.transaction(IDB_STORE, mode).objectStore(IDB_STORE);
    }

    async writeFile(path: string, data: Uint8Array | string): Promise<void> {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const store = await this.store('readwrite');
        await reqToPromise(store.put({ path, bytes }));
    }
    async readFile(path: string): Promise<Uint8Array | null> {
        const store = await this.store('readonly');
        const rec = await reqToPromise(
            store.get(path) as IDBRequest<{ path: string; bytes: Uint8Array } | undefined>,
        );
        return rec ? rec.bytes : null;
    }
    async readText(path: string): Promise<string | null> {
        const bytes = await this.readFile(path);
        return bytes ? new TextDecoder().decode(bytes) : null;
    }
    async exists(path: string): Promise<boolean> {
        const store = await this.store('readonly');
        const key = await reqToPromise(store.getKey(path));
        return key !== undefined;
    }
    async deleteFile(path: string): Promise<void> {
        const store = await this.store('readwrite');
        await reqToPromise(store.delete(path));
    }
    async listDirs(dirPath: string): Promise<string[]> {
        const prefix = `${dirPath}/`;
        const store = await this.store('readonly');
        const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
        const keys = await reqToPromise<IDBValidKey[]>(store.getAllKeys(range));
        const names = new Set<string>();
        for (const key of keys) {
            const seg = String(key).slice(prefix.length).split('/')[0];
            if (seg) names.add(seg);
        }
        return [...names];
    }
    async deleteDir(dirPath: string): Promise<void> {
        const prefix = `${dirPath}/`;
        const store = await this.store('readwrite');
        const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
        const keys = await reqToPromise<IDBValidKey[]>(store.getAllKeys(range));
        await Promise.all(keys.map((key) => reqToPromise(store.delete(key))));
    }
}

// ── OPFS backend ─────────────────────────────────────────────────────────────
// Typed locally (not via the DOM lib) so this file compiles regardless of
// whether the project's TS `lib` includes the File System Access API.

interface OpfsWritable {
    write(data: Uint8Array | string): Promise<void>;
    close(): Promise<void>;
}
interface OpfsFileHandle {
    kind: 'file';
    getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
    createWritable(): Promise<OpfsWritable>;
}
interface OpfsDirectoryHandle {
    kind: 'directory';
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
    entries(): AsyncIterableIterator<[string, OpfsDirectoryHandle | OpfsFileHandle]>;
}

class OpfsBackend implements ProjectFileBackend {
    readonly kind = 'opfs' as const;
    private readonly root: OpfsDirectoryHandle;
    constructor(root: OpfsDirectoryHandle) {
        this.root = root;
    }

    private async getDir(segments: string[], create: boolean): Promise<OpfsDirectoryHandle | null> {
        let dir = this.root;
        for (const seg of segments) {
            try {
                dir = await dir.getDirectoryHandle(seg, { create });
            } catch {
                return null;
            }
        }
        return dir;
    }

    private split(path: string): { dirs: string[]; name: string } {
        const parts = path.split('/').filter(Boolean);
        return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] };
    }

    async writeFile(path: string, data: Uint8Array | string): Promise<void> {
        const { dirs, name } = this.split(path);
        const dir = await this.getDir(dirs, true);
        if (!dir) throw new Error(`OPFS: could not create directory for ${path}`);
        const fileHandle = await dir.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(typeof data === 'string' ? new TextEncoder().encode(data) : data);
        await writable.close();
    }
    async readFile(path: string): Promise<Uint8Array | null> {
        const { dirs, name } = this.split(path);
        const dir = await this.getDir(dirs, false);
        if (!dir) return null;
        try {
            const fileHandle = await dir.getFileHandle(name);
            const file = await fileHandle.getFile();
            return new Uint8Array(await file.arrayBuffer());
        } catch {
            return null;
        }
    }
    async readText(path: string): Promise<string | null> {
        const bytes = await this.readFile(path);
        return bytes ? new TextDecoder().decode(bytes) : null;
    }
    async exists(path: string): Promise<boolean> {
        return (await this.readFile(path)) !== null;
    }
    async deleteFile(path: string): Promise<void> {
        const { dirs, name } = this.split(path);
        const dir = await this.getDir(dirs, false);
        if (!dir) return;
        try {
            await dir.removeEntry(name);
        } catch {
            /* already gone */
        }
    }
    async listDirs(dirPath: string): Promise<string[]> {
        const segments = dirPath.split('/').filter(Boolean);
        const dir = await this.getDir(segments, false);
        if (!dir) return [];
        const names: string[] = [];
        for await (const [childName, handle] of dir.entries()) {
            if (handle.kind === 'directory') names.push(childName);
        }
        return names;
    }
    async deleteDir(dirPath: string): Promise<void> {
        const segments = dirPath.split('/').filter(Boolean);
        const name = segments.pop();
        if (!name) return;
        const parent = await this.getDir(segments, false);
        if (!parent) return;
        try {
            await parent.removeEntry(name, { recursive: true });
        } catch {
            /* already gone */
        }
    }
}

async function detectBackend(): Promise<ProjectFileBackend> {
    if (typeof navigator !== 'undefined') {
        const storage = navigator.storage as unknown as {
            getDirectory?: () => Promise<OpfsDirectoryHandle>;
        };
        if (typeof storage?.getDirectory === 'function') {
            try {
                const root = await storage.getDirectory();
                // Probe write access — some embedders expose the API but throw
                // (private browsing, permission policy) on first real use.
                const probe = await root.getDirectoryHandle('.hyphon-opfs-probe', { create: true });
                void probe;
                await root.removeEntry('.hyphon-opfs-probe', { recursive: true });
                return new OpfsBackend(root);
            } catch {
                /* fall through to IndexedDB */
            }
        }
    }
    if (typeof indexedDB !== 'undefined') {
        return new IdbBackend();
    }
    return new MemoryBackend();
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

    /** Pass a backend to bypass auto-detection (tests, or a forced fallback). */
    constructor(backendOverride?: ProjectFileBackend) {
        this.backendOverride = backendOverride;
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
            await backend.writeFile(this.path(id, 'project.json'), JSON.stringify(stored));
            // A save implies the session is mid-edit; only an explicit
            // markCleanShutdown() flips this back to a clean state.
            const dirtyMeta: ShutdownMeta = { clean: false, at: Date.now() };
            await backend.writeFile(this.path(id, 'shutdown.json'), JSON.stringify(dirtyMeta));
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }

    async loadProject(id: string): Promise<SavedSongData | null> {
        const backend = await this.getBackend();
        const text = await backend.readText(this.path(id, 'project.json'));
        if (!text) return null;

        let stored: StoredProjectJson;
        try {
            stored = JSON.parse(text) as StoredProjectJson;
        } catch {
            return null;
        }

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
     */
    async migrateLegacyAutosave(storage?: StorageBackend): Promise<boolean> {
        const legacy = loadSessionFromLocalStorage(storage);
        if (!legacy) return false;
        if (!(await this.hasProject(AUTOSAVE_PROJECT_ID))) {
            const { autosaveVersion: _av, savedAt: _sa, samplesStripped: _ss, ...rest } = legacy;
            void _av;
            void _sa;
            void _ss;
            await this.saveProject(AUTOSAVE_PROJECT_ID, rest as SavedSongData);
        }
        clearSessionFromLocalStorage(storage);
        return true;
    }
}

export const projectStore = new ProjectStore();

export { AUTOSAVE_KEY as LEGACY_AUTOSAVE_KEY };
