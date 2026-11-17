// The file backends under ProjectStore (moved out of ProjectStore.ts for the
// 700-line module budget): OPFS, with an IndexedDB fallback for browsers that
// expose `navigator.storage.getDirectory` only partially (or not at all) and an
// in-memory fallback for SSR/tests. `detectBackend` picks one.

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

interface StoredRecord {
    path: string;
    bytes: Uint8Array;
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

    /**
     * Issues a single request against a fresh transaction's object store and
     * resolves with its `.result` once the transaction actually commits
     * (`oncomplete`), not merely once the request itself reports success. A
     * request can succeed and then have its transaction abort (a quota
     * error, another request in the same transaction failing); waiting for
     * `oncomplete` is the only way to know the write is durable.
     */
    private async runRequest<T>(
        mode: IDBTransactionMode,
        fn: (store: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> {
        const db = await this.db();
        return new Promise<T>((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, mode);
            let request: IDBRequest<T>;
            try {
                request = fn(tx.objectStore(IDB_STORE));
            } catch (err) {
                reject(err as Error);
                return;
            }
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error ?? request.error ?? new Error('IndexedDB transaction failed'));
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        });
    }

    async writeFile(path: string, data: Uint8Array | string): Promise<void> {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        await this.runRequest('readwrite', (store) => store.put({ path, bytes } satisfies StoredRecord));
    }
    async readFile(path: string): Promise<Uint8Array | null> {
        const rec = await this.runRequest(
            'readonly',
            (store) => store.get(path) as IDBRequest<StoredRecord | undefined>,
        );
        return rec?.bytes ?? null;
    }
    async readText(path: string): Promise<string | null> {
        const bytes = await this.readFile(path);
        return bytes ? new TextDecoder().decode(bytes) : null;
    }
    async exists(path: string): Promise<boolean> {
        const key = await this.runRequest('readonly', (store) => store.getKey(path));
        return key !== undefined;
    }
    async deleteFile(path: string): Promise<void> {
        await this.runRequest('readwrite', (store) => store.delete(path));
    }
    async listDirs(dirPath: string): Promise<string[]> {
        const prefix = `${dirPath}/`;
        const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
        const keys = await this.runRequest('readonly', (store) => store.getAllKeys(range));
        const names = new Set<string>();
        for (const key of keys) {
            const seg = String(key).slice(prefix.length).split('/')[0];
            if (seg) names.add(seg);
        }
        return [...names];
    }
    async deleteDir(dirPath: string): Promise<void> {
        const prefix = `${dirPath}/`;
        const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
        const db = await this.db();
        // getAllKeys() and every delete() it triggers are issued within one
        // readwrite transaction, all synchronously inside getAllKeys'
        // onsuccess handler — no `await` between them, so the transaction
        // cannot go inactive mid-sequence (the classic IDB async/await
        // pitfall this backend otherwise avoids by resolving on oncomplete).
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            const store = tx.objectStore(IDB_STORE);
            const getKeysReq = store.getAllKeys(range);
            getKeysReq.onsuccess = () => {
                for (const key of getKeysReq.result) store.delete(key);
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? getKeysReq.error ?? new Error('deleteDir transaction failed'));
            tx.onabort = () => reject(tx.error ?? new Error('deleteDir transaction aborted'));
        });
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

export async function detectBackend(): Promise<ProjectFileBackend> {
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
