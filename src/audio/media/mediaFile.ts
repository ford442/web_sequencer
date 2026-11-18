/**
 * The media file format (#1629 D2): what `media/<sha256>.f32` holds.
 *
 *   bytes 0–3   "HYMF"
 *   bytes 4–7   u32le: byte length of the JSON header (padded)
 *   bytes 8–    the JSON header (UTF-8, space-padded so the audio starts on a
 *               16-byte boundary)
 *   then        planar float32 little-endian: every frame of channel 0, then
 *               channel 1, …
 *
 * The header is deterministic (no timestamps, no file name), so the same audio
 * always encodes to the same bytes and the same SHA-256 — the store is
 * content-addressed and an import of audio the store already holds writes
 * nothing. The name a song shows lives in the song (`SavedSongData.media`).
 *
 * Planar, so a page of one channel is one contiguous byte range
 * (`channelByteRange`). Pure: no DOM, usable in a worker.
 */

export const MEDIA_MAGIC = 'HYMF';
export const MEDIA_FORMAT_VERSION = 1;
const PREAMBLE_BYTES = 8;
const DATA_ALIGN = 16;
/** Bigger than any real header; a file claiming more is corrupt. */
const MAX_HEADER_BYTES = 4096;

export interface MediaHeader {
    sampleRate: number;
    channels: number;
    frames: number;
    /** Byte offset of channel 0's first frame. */
    dataOffset: number;
}

interface HeaderJson {
    format: 'hyphon-media';
    version: number;
    layout: 'planar-f32le';
    sampleRate: number;
    channels: number;
    frames: number;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function headerBytes(sampleRate: number, channels: number, frames: number): Uint8Array {
    const json: HeaderJson = {
        format: 'hyphon-media',
        version: MEDIA_FORMAT_VERSION,
        layout: 'planar-f32le',
        sampleRate,
        channels,
        frames,
    };
    const text = new TextEncoder().encode(JSON.stringify(json));
    const padded = Math.ceil((PREAMBLE_BYTES + text.length) / DATA_ALIGN) * DATA_ALIGN - PREAMBLE_BYTES;
    const out = new Uint8Array(padded).fill(0x20);
    out.set(text);
    return out;
}

/** The whole media file for planar audio (all channels the same length). */
export function encodeMediaFile(planar: readonly Float32Array[], sampleRate: number): Uint8Array {
    if (!LITTLE_ENDIAN) throw new Error('Media files need a little-endian platform');
    const channels = planar.length;
    if (channels < 1) throw new Error('Media needs at least one channel');
    const frames = planar[0].length;
    if (planar.some((ch) => ch.length !== frames)) throw new Error('Media channels differ in length');
    if (!Number.isInteger(sampleRate) || sampleRate < 1) throw new Error(`Bad sample rate ${sampleRate}`);
    const header = headerBytes(sampleRate, channels, frames);
    const dataOffset = PREAMBLE_BYTES + header.length;
    const out = new Uint8Array(dataOffset + channels * frames * 4);
    out.set(new TextEncoder().encode(MEDIA_MAGIC), 0);
    new DataView(out.buffer).setUint32(4, header.length, true);
    out.set(header, PREAMBLE_BYTES);
    const data = new Float32Array(out.buffer, dataOffset, channels * frames);
    for (let c = 0; c < channels; c++) data.set(planar[c], c * frames);
    return out;
}

/**
 * Parse the header from the first bytes of a media file (at least
 * `PREAMBLE_BYTES` + the header; 4 KiB is always enough). Null when the bytes
 * are not a media file this build reads.
 */
export function parseMediaHeader(bytes: Uint8Array): MediaHeader | null {
    if (bytes.length < PREAMBLE_BYTES) return null;
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== MEDIA_MAGIC) return null;
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    if (length > MAX_HEADER_BYTES || bytes.length < PREAMBLE_BYTES + length) return null;
    let json: Partial<HeaderJson>;
    try {
        json = JSON.parse(new TextDecoder().decode(bytes.subarray(PREAMBLE_BYTES, PREAMBLE_BYTES + length))) as Partial<HeaderJson>;
    } catch {
        return null;
    }
    const { sampleRate, channels, frames } = json;
    if (json.format !== 'hyphon-media' || json.version !== MEDIA_FORMAT_VERSION || json.layout !== 'planar-f32le') return null;
    if (!Number.isInteger(sampleRate) || !Number.isInteger(channels) || !Number.isInteger(frames)) return null;
    if ((sampleRate as number) < 1 || (channels as number) < 1 || (frames as number) < 0) return null;
    const dataOffset = PREAMBLE_BYTES + length;
    if (dataOffset % 4 !== 0) return null;
    return { sampleRate: sampleRate as number, channels: channels as number, frames: frames as number, dataOffset };
}

/** Bytes needed to parse any header this build writes. */
export const MEDIA_HEADER_PROBE_BYTES = PREAMBLE_BYTES + MAX_HEADER_BYTES;

/** Byte range `[start, end)` of frames `[from, from + count)` of one channel. */
export function channelByteRange(header: MediaHeader, channel: number, from: number, count: number): [number, number] {
    const start = header.dataOffset + (channel * header.frames + from) * 4;
    return [start, start + count * 4];
}

/** Read float32 LE samples out of bytes that may not be 4-byte aligned. */
export function bytesToFloat32(bytes: Uint8Array): Float32Array {
    const frames = bytes.length >> 2;
    if (bytes.byteOffset % 4 === 0) return new Float32Array(bytes.buffer, bytes.byteOffset, frames).slice();
    return new Float32Array(bytes.slice(0, frames * 4).buffer);
}
