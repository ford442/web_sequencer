import type { TakeSyncFile } from '../takeFileWriter';

/** An in-memory `FileSystemSyncAccessHandle` stand-in: what reached `flush()` is what a killed tab leaves. */
export class MemTakeFile implements TakeSyncFile {
    bytes = new Uint8Array(0);
    /** The file as of the last flush. */
    flushed = new Uint8Array(0);
    flushes = 0;
    closed = false;

    private ensure(size: number): void {
        if (size <= this.bytes.length) return;
        const grown = new Uint8Array(Math.max(size, this.bytes.length * 2));
        grown.set(this.bytes);
        this.bytes = grown.subarray(0, size);
        // Keep the backing store but expose `size` bytes.
        this.bytes = new Uint8Array(grown.buffer, 0, size);
    }

    read(buffer: Uint8Array, { at }: { at: number }): number {
        const n = Math.max(0, Math.min(buffer.length, this.bytes.length - at));
        buffer.set(this.bytes.subarray(at, at + n));
        return n;
    }

    write(buffer: Uint8Array, { at }: { at: number }): number {
        if (this.closed) throw new Error('closed');
        this.ensure(at + buffer.length);
        this.bytes.set(buffer, at);
        return buffer.length;
    }

    getSize(): number {
        return this.bytes.length;
    }

    truncate(size: number): void {
        if (size <= this.bytes.length) this.bytes = this.bytes.slice(0, size);
        else this.ensure(size);
    }

    flush(): void {
        this.flushes++;
        this.flushed = this.bytes.slice();
    }

    close(): void {
        this.closed = true;
    }
}
