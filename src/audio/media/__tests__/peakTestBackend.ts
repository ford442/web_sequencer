import type { ProjectFileBackend } from '@/services/projectFileBackends';

/** An in-memory file backend that records its largest single read (to see paging). */
export class MemoryBackendForTests implements ProjectFileBackend {
    readonly kind: ProjectFileBackend['kind'];
    readonly files = new Map<string, Uint8Array>();
    largestRead = 0;
    reads = 0;

    constructor(kind: ProjectFileBackend['kind'] = 'memory') {
        this.kind = kind;
    }

    private saw(bytes: Uint8Array | null): Uint8Array | null {
        this.reads++;
        if (bytes) this.largestRead = Math.max(this.largestRead, bytes.length);
        return bytes;
    }

    writeFile(path: string, data: Uint8Array | string): Promise<void> {
        this.files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data.slice());
        return Promise.resolve();
    }
    readFile(path: string): Promise<Uint8Array | null> {
        return Promise.resolve(this.saw(this.files.get(path)?.slice() ?? null));
    }
    readText(path: string): Promise<string | null> {
        const bytes = this.files.get(path);
        return Promise.resolve(bytes ? new TextDecoder().decode(bytes) : null);
    }
    readRange(path: string, start: number, end: number): Promise<Uint8Array | null> {
        const bytes = this.files.get(path);
        return Promise.resolve(this.saw(bytes ? bytes.slice(start, end) : null));
    }
    exists(path: string): Promise<boolean> {
        return Promise.resolve(this.files.has(path));
    }
    deleteFile(path: string): Promise<void> {
        this.files.delete(path);
        return Promise.resolve();
    }
    listDirs(): Promise<string[]> {
        return Promise.resolve([]);
    }
    deleteDir(): Promise<void> {
        return Promise.resolve();
    }
}
