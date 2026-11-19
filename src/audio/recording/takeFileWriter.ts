/**
 * Writes a take to a file (#1498 P1), over the subset of OPFS's
 * `FileSystemSyncAccessHandle` it needs, so the same code runs in the take
 * writer worker and against an in-memory file in tests.
 *
 * The header is patched and the file flushed every `commitEveryFrames`
 * frames, and on finish: what a killed tab leaves behind is a valid WAV up
 * to the last commit, and `recoverTakeFile` trims anything after it to a whole
 * frame and patches the header for what is there.
 */

import {
    TAKE_DATA_OFFSET,
    TAKE_HEADER_BYTES,
    blockAlign,
    encodeTakeHeader,
    framesInFile,
    needsRf64,
    parseTakeHeader,
    type TakeFormat,
} from './wavTakeFile';

/** The part of `FileSystemSyncAccessHandle` a take needs. */
export interface TakeSyncFile {
    read(buffer: Uint8Array, options: { at: number }): number;
    write(buffer: Uint8Array, options: { at: number }): number;
    getSize(): number;
    truncate(size: number): void;
    flush(): void;
    close(): void;
}

export interface TakeFileWriterOptions {
    /** Frames between header patches + flushes (default: one second). */
    commitEveryFrames?: number;
    /** RIFF size ceiling before the RF64 form (tests lower it). */
    rf64Limit?: number;
}

const SILENCE_CHUNK_BYTES = 1 << 16;

function assertLittleEndian(): void {
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
        throw new Error('take writer: big-endian platform (WAV float32 is little-endian)');
    }
}

function writeAll(file: TakeSyncFile, bytes: Uint8Array, at: number): void {
    let done = 0;
    while (done < bytes.length) {
        const n = file.write(done === 0 ? bytes : bytes.subarray(done), { at: at + done });
        if (n <= 0) throw new Error('take writer: the file stopped accepting writes (storage full?)');
        done += n;
    }
}

export class TakeFileWriter {
    readonly format: TakeFormat;
    private readonly file: TakeSyncFile;
    private readonly commitEvery: number;
    private readonly rf64Limit: number | undefined;
    private readonly align: number;
    private framesWritten = 0;
    private framesCommitted = 0;
    private silence: Uint8Array | null = null;
    private closed = false;

    constructor(file: TakeSyncFile, format: TakeFormat, options: TakeFileWriterOptions = {}) {
        assertLittleEndian();
        this.file = file;
        this.format = format;
        this.align = blockAlign(format);
        this.commitEvery = Math.max(1, Math.floor(options.commitEveryFrames ?? format.sampleRate));
        this.rf64Limit = options.rf64Limit;
        file.truncate(0);
        writeAll(file, this.header(0), 0);
        file.flush();
    }

    get frames(): number {
        return this.framesWritten;
    }

    /** Frames covered by the header on disk. */
    get committedFrames(): number {
        return this.framesCommitted;
    }

    private header(frames: number): Uint8Array {
        const rf64 = this.rf64Limit === undefined
            ? needsRf64(this.format, frames)
            : needsRf64(this.format, frames, this.rf64Limit);
        return encodeTakeHeader(this.format, frames, rf64);
    }

    private endOffset(): number {
        return TAKE_DATA_OFFSET + this.framesWritten * this.align;
    }

    /** Append `frames` interleaved frames from `samples`. */
    append(samples: Float32Array, frames: number): void {
        if (this.closed || frames <= 0) return;
        const byteLength = frames * this.align;
        if (samples.length * 4 < byteLength) throw new Error('take writer: fewer samples than frames');
        writeAll(this.file, new Uint8Array(samples.buffer, samples.byteOffset, byteLength), this.endOffset());
        this.framesWritten += frames;
        this.maybeCommit();
    }

    /** Append `frames` frames of silence (frames the ring had to drop). */
    appendSilence(frames: number): void {
        if (this.closed || frames <= 0) return;
        this.silence ??= new Uint8Array(SILENCE_CHUNK_BYTES - (SILENCE_CHUNK_BYTES % this.align));
        let left = frames * this.align;
        while (left > 0) {
            const n = Math.min(left, this.silence.length);
            writeAll(this.file, n === this.silence.length ? this.silence : this.silence.subarray(0, n), this.endOffset());
            const wrote = n / this.align;
            this.framesWritten += wrote;
            left -= n;
        }
        this.maybeCommit();
    }

    private maybeCommit(): void {
        if (this.framesWritten - this.framesCommitted >= this.commitEvery) this.commit();
    }

    /** Patch the header for every frame written so far and flush. */
    commit(): void {
        if (this.closed) return;
        writeAll(this.file, this.header(this.framesWritten), 0);
        this.file.flush();
        this.framesCommitted = this.framesWritten;
    }

    /** Drop every frame from `frames` on (a stop that arrived after its frame). */
    truncate(frames: number): void {
        if (this.closed) return;
        const keep = Math.max(0, Math.min(this.framesWritten, Math.floor(frames)));
        if (keep === this.framesWritten) return;
        this.framesWritten = keep;
        this.file.truncate(this.endOffset());
        this.commit();
    }

    /** Commit and close. Returns the take's frames. */
    finish(): number {
        if (!this.closed) {
            this.commit();
            this.file.close();
            this.closed = true;
        }
        return this.framesWritten;
    }

    /** Close without a final commit (the take is being discarded). */
    abandon(): void {
        if (this.closed) return;
        this.closed = true;
        this.file.close();
    }
}

/**
 * Make a take a killed tab left behind valid: trim a torn last frame, patch
 * the header for the frames that are there, flush. Does not close the file.
 * Null when the file is not a take this build wrote.
 */
export function recoverTakeFile(file: TakeSyncFile, options: Pick<TakeFileWriterOptions, 'rf64Limit'> = {}): { format: TakeFormat; frames: number } | null {
    const head = new Uint8Array(TAKE_HEADER_BYTES);
    if (file.read(head, { at: 0 }) < TAKE_HEADER_BYTES) return null;
    const format = parseTakeHeader(head);
    if (!format) return null;
    const frames = framesInFile(format, file.getSize());
    file.truncate(TAKE_DATA_OFFSET + frames * blockAlign(format));
    const rf64 = options.rf64Limit === undefined ? needsRf64(format, frames) : needsRf64(format, frames, options.rf64Limit);
    writeAll(file, encodeTakeHeader(format, frames, rf64), 0);
    file.flush();
    return { format, frames };
}
