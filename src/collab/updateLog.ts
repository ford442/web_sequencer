/**
 * The project document's update log (`doc.ylog`, ProjectStore v2).
 *
 * A file of Yjs updates, each one a frame, applied in order to rebuild the doc:
 *
 *   "HYDL"  u8 format version  { u32le byteLength, byteLength bytes }*
 *
 * Writers append a frame per batch of local edits and, now and then, rewrite
 * the file as a single frame holding the whole doc (compaction). A write that
 * died halfway leaves a torn last frame; it is dropped on read, and the frames
 * before it still rebuild a consistent doc (every Yjs update is atomic).
 *
 * This module only knows bytes. It has no Yjs import, so ProjectStore can
 * read and append frames without loading the CRDT library.
 */

const MAGIC = [0x48, 0x59, 0x44, 0x4c] as const; // "HYDL"
export const UPDATE_LOG_FORMAT_VERSION = 1;
const HEADER_BYTES = MAGIC.length + 1;
const LENGTH_BYTES = 4;

export interface DecodedUpdateLog {
    frames: Uint8Array[];
    /** Bytes after the last whole frame (a torn write); 0 for a clean log. */
    tornBytes: number;
}

function header(): Uint8Array {
    return Uint8Array.from([...MAGIC, UPDATE_LOG_FORMAT_VERSION]);
}

function writeFrame(out: Uint8Array, offset: number, frame: Uint8Array): number {
    new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(offset, frame.byteLength, true);
    out.set(frame, offset + LENGTH_BYTES);
    return offset + LENGTH_BYTES + frame.byteLength;
}

/** A log holding exactly `frames`. */
export function encodeUpdateLog(frames: readonly Uint8Array[]): Uint8Array {
    const size = frames.reduce((sum, frame) => sum + LENGTH_BYTES + frame.byteLength, HEADER_BYTES);
    const out = new Uint8Array(size);
    out.set(header(), 0);
    let offset = HEADER_BYTES;
    for (const frame of frames) offset = writeFrame(out, offset, frame);
    return out;
}

/**
 * `log` with `frame` appended. A missing or unreadable log starts a new one; a
 * torn tail is cut off first, so the new frame stays readable.
 */
export function appendToUpdateLog(log: Uint8Array | null, frame: Uint8Array): Uint8Array {
    const decoded = log ? decodeUpdateLog(log) : null;
    if (!log || !decoded) return encodeUpdateLog([frame]);
    const keep = log.byteLength - decoded.tornBytes;
    const out = new Uint8Array(keep + LENGTH_BYTES + frame.byteLength);
    out.set(log.subarray(0, keep), 0);
    writeFrame(out, keep, frame);
    return out;
}

/** The frames of a log, or null when `bytes` is not a log this build can read. */
export function decodeUpdateLog(bytes: Uint8Array): DecodedUpdateLog | null {
    if (bytes.byteLength < HEADER_BYTES) return null;
    if (!MAGIC.every((byte, i) => bytes[i] === byte)) return null;
    if (bytes[MAGIC.length] !== UPDATE_LOG_FORMAT_VERSION) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frames: Uint8Array[] = [];
    let offset = HEADER_BYTES;
    while (offset + LENGTH_BYTES <= bytes.byteLength) {
        const length = view.getUint32(offset, true);
        const start = offset + LENGTH_BYTES;
        if (start + length > bytes.byteLength) break;
        // A copy, so a frame never pins (or aliases) the whole file's buffer.
        frames.push(bytes.slice(start, start + length));
        offset = start + length;
    }
    return { frames, tornBytes: bytes.byteLength - offset };
}
