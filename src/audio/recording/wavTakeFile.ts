/**
 * The on-disk layout of a recorded take (#1498 P1): 32-bit float WAV with a
 * fixed 94-byte header that is patched in place, so the file is a valid WAV
 * after every flush and a killed tab leaves a playable partial take.
 *
 *   0   RIFF|RF64  u32 riffSize  WAVE
 *   12  JUNK|ds64  u32 28        riffSize64 · dataSize64 · sampleCount64 · tableLength (u32)
 *   48  fmt        u32 18        IEEE float, channels, rate, byteRate, blockAlign, 32 bits, cbSize 0
 *   74  fact       u32 4         frames
 *   86  data       u32 dataSize
 *   94  interleaved float32 LE frames
 *
 * The JUNK chunk reserves room for a ds64 chunk (EBU Tech 3306): a take that
 * passes 4 GiB is promoted to RF64 by rewriting the header only, and its
 * 32-bit sizes read 0xFFFFFFFF. `decodeWav` (`src/audio/media/wav.ts`) reads
 * both forms.
 */

export const TAKE_HEADER_BYTES = 94;
export const TAKE_DATA_OFFSET = TAKE_HEADER_BYTES;
export const TAKE_BYTES_PER_SAMPLE = 4;

const WAVE_FORMAT_IEEE_FLOAT = 3;
const U32_MAX = 0xffffffff;
/** Largest RIFF size field: everything after the first 8 bytes. */
const RIFF_LIMIT = U32_MAX;

export interface TakeFormat {
    sampleRate: number;
    channels: number;
}

function ascii(view: DataView, at: number, text: string): void {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
}

/** Bytes per interleaved frame. */
export function blockAlign(format: TakeFormat): number {
    return format.channels * TAKE_BYTES_PER_SAMPLE;
}

/**
 * Whether a take of `frames` frames needs the RF64 form. `limit` is the RIFF
 * size ceiling (tests lower it to exercise the promotion without 4 GiB).
 */
export function needsRf64(format: TakeFormat, frames: number, limit = RIFF_LIMIT): boolean {
    return TAKE_HEADER_BYTES - 8 + frames * blockAlign(format) > limit;
}

/**
 * The full header of a take holding `frames` frames. `rf64` forces the RF64
 * form; otherwise it is chosen from the size.
 */
export function encodeTakeHeader(format: TakeFormat, frames: number, rf64 = needsRf64(format, frames)): Uint8Array {
    const bytes = new Uint8Array(TAKE_HEADER_BYTES);
    const view = new DataView(bytes.buffer);
    const align = blockAlign(format);
    const dataSize = frames * align;
    const riffSize = TAKE_HEADER_BYTES - 8 + dataSize;

    ascii(view, 0, rf64 ? 'RF64' : 'RIFF');
    view.setUint32(4, rf64 ? U32_MAX : riffSize, true);
    ascii(view, 8, 'WAVE');

    ascii(view, 12, rf64 ? 'ds64' : 'JUNK');
    view.setUint32(16, 28, true);
    if (rf64) {
        view.setBigUint64(20, BigInt(riffSize), true);
        view.setBigUint64(28, BigInt(dataSize), true);
        view.setBigUint64(36, BigInt(frames), true);
        view.setUint32(44, 0, true);
    }

    ascii(view, 48, 'fmt ');
    view.setUint32(52, 18, true);
    view.setUint16(56, WAVE_FORMAT_IEEE_FLOAT, true);
    view.setUint16(58, format.channels, true);
    view.setUint32(60, format.sampleRate, true);
    view.setUint32(64, format.sampleRate * align, true);
    view.setUint16(68, align, true);
    view.setUint16(70, TAKE_BYTES_PER_SAMPLE * 8, true);
    view.setUint16(72, 0, true);

    ascii(view, 74, 'fact');
    view.setUint32(78, 4, true);
    view.setUint32(82, rf64 ? U32_MAX : frames, true);

    ascii(view, 86, 'data');
    view.setUint32(90, rf64 ? U32_MAX : dataSize, true);
    return bytes;
}

/** The format a take file's header declares; null when it is not one of ours. */
export function parseTakeHeader(bytes: Uint8Array): TakeFormat | null {
    if (bytes.length < TAKE_HEADER_BYTES) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const riff = tag(0);
    if ((riff !== 'RIFF' && riff !== 'RF64') || tag(8) !== 'WAVE' || tag(48) !== 'fmt ' || tag(86) !== 'data') return null;
    if (view.getUint16(56, true) !== WAVE_FORMAT_IEEE_FLOAT || view.getUint16(70, true) !== 32) return null;
    const channels = view.getUint16(58, true);
    const sampleRate = view.getUint32(60, true);
    if (channels < 1 || channels > 2 || sampleRate < 1) return null;
    return { sampleRate, channels };
}

/** Whole frames a take file of `fileBytes` bytes holds (a torn last frame is not counted). */
export function framesInFile(format: TakeFormat, fileBytes: number): number {
    return Math.max(0, Math.floor((fileBytes - TAKE_DATA_OFFSET) / blockAlign(format)));
}

/** Byte offset of frame `frame` in a take file. */
export function frameOffset(format: TakeFormat, frame: number): number {
    return TAKE_DATA_OFFSET + frame * blockAlign(format);
}
