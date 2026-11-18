/**
 * WAV / RF64 decoder for the media store (#1629 D2): lossless, exact, no
 * resampling and no AudioContext, so it runs anywhere (main thread, a worker,
 * Node). Other formats go through the browser decoder (`importAudioFile.ts`).
 *
 * Reads RIFF and RF64 (ds64 sizes) WAVE files with PCM 8/16/24/32-bit integer
 * or 32/64-bit float samples, plain or WAVE_FORMAT_EXTENSIBLE. A truncated
 * data chunk decodes up to its last whole frame.
 */

export interface DecodedAudio {
    sampleRate: number;
    /** Planar, one array per channel, all the same length. */
    channels: Float32Array[];
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function fourcc(view: DataView, offset: number): string {
    return String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
}

/** True when the bytes start like a RIFF / RF64 WAVE file. */
export function isWav(bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const riff = fourcc(view, 0);
    return (riff === 'RIFF' || riff === 'RF64') && fourcc(view, 8) === 'WAVE';
}

interface WavFormat {
    tag: number;
    channels: number;
    sampleRate: number;
    blockAlign: number;
    bits: number;
}

/** Decode a WAV file. Null when it is not one, or uses a sample format this decoder does not read. */
export function decodeWav(bytes: Uint8Array): DecodedAudio | null {
    if (!isWav(bytes)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const rf64 = fourcc(view, 0) === 'RF64';
    let ds64DataSize: number | null = null;
    let format: WavFormat | null = null;
    let dataStart = -1;
    let dataSize = 0;

    for (let offset = 12; offset + 8 <= bytes.length;) {
        const id = fourcc(view, offset);
        let size = view.getUint32(offset + 4, true);
        const body = offset + 8;
        if (id === 'ds64' && size >= 24) {
            // riffSize (u64) · dataSize (u64) · sampleCount (u64); dataSize is all we need.
            ds64DataSize = Number(view.getBigUint64(body + 8, true));
        } else if (id === 'fmt ' && size >= 16) {
            let tag = view.getUint16(body, true);
            const bits = view.getUint16(body + 14, true);
            if (tag === WAVE_FORMAT_EXTENSIBLE && size >= 40) tag = view.getUint16(body + 24, true);
            format = {
                tag,
                channels: view.getUint16(body + 2, true),
                sampleRate: view.getUint32(body + 4, true),
                blockAlign: view.getUint16(body + 12, true),
                bits,
            };
        } else if (id === 'data') {
            if (rf64 && size === 0xffffffff && ds64DataSize !== null) size = ds64DataSize;
            dataStart = body;
            dataSize = Math.min(size, bytes.length - body);
            break;
        }
        if (size === 0xffffffff) break;
        offset = body + size + (size & 1);
    }

    if (!format || dataStart < 0) return null;
    const { tag, channels, sampleRate, bits } = format;
    const bytesPerSample = bits >> 3;
    if (channels < 1 || sampleRate < 1 || bits % 8 !== 0 || bytesPerSample < 1) return null;
    const pcm = tag === WAVE_FORMAT_PCM && bits >= 8 && bits <= 32;
    const float = tag === WAVE_FORMAT_IEEE_FLOAT && (bits === 32 || bits === 64);
    if (!pcm && !float) return null;
    const blockAlign = format.blockAlign || channels * bytesPerSample;
    if (blockAlign < channels * bytesPerSample) return null;

    const frames = Math.floor(dataSize / blockAlign);
    const out = Array.from({ length: channels }, () => new Float32Array(frames));
    for (let f = 0; f < frames; f++) {
        const frameAt = dataStart + f * blockAlign;
        for (let c = 0; c < channels; c++) {
            const at = frameAt + c * bytesPerSample;
            let v: number;
            if (float) {
                v = bits === 32 ? view.getFloat32(at, true) : view.getFloat64(at, true);
            } else if (bits === 8) {
                v = (view.getUint8(at) - 128) / 128;
            } else if (bits === 16) {
                v = view.getInt16(at, true) / 32768;
            } else if (bits === 24) {
                const raw = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
                v = raw / 8388608;
            } else {
                v = view.getInt32(at, true) / 2147483648;
            }
            out[c][f] = v;
        }
    }
    return { sampleRate, channels: out };
}
