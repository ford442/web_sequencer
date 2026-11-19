/**
 * Waveform peaks (#1629 D5): a min/max pyramid of one piece of media, built
 * once and stored next to it (`media/<id>.peaks`), so the timeline draws a
 * clip at any zoom without reading its audio.
 *
 * Level 0 holds, per channel, the min and max of every `2^PEAK_BASE_SHIFT`
 * frames (the last bucket may be shorter). Each next level merges pairs of
 * buckets of the one below, up to the level with a single bucket. Values are
 * int16 (±32767 = ±1.0; louder samples clamp there), interleaved per bucket:
 * `[min c0, max c0, min c1, max c1, …]`. A min rounds down and a max up, so a
 * drawn peak never looks quieter than the audio.
 *
 *   bytes 0–3   "HYMP"
 *   bytes 4–7   u32le: byte length of the JSON header (padded)
 *   bytes 8–    the JSON header (space-padded so the data starts 4-aligned)
 *   then        int16 little-endian, level 0 first
 *
 * The header is deterministic, like the media file's (`mediaFile.ts`): the
 * same media always gives the same bytes. A file of another version reads as
 * missing, and is rebuilt from the media. Pure: no DOM, usable in a worker.
 */

/** Level 0 buckets are 256 frames: about 2 per pixel at the closest ARR zoom. */
export const PEAK_BASE_SHIFT = 8;
export const PEAKS_MAGIC = 'HYMP';
export const PEAKS_FORMAT_VERSION = 1;

const PREAMBLE_BYTES = 8;
const MAX_HEADER_BYTES = 4096;
const FULL_SCALE = 32767;

export interface PeakLevel {
    /** log2 of the frames one bucket covers. */
    shift: number;
    buckets: number;
    /** `buckets × channels × 2` values: per bucket, min and max of each channel. */
    data: Int16Array;
}

export interface PeakPyramid {
    channels: number;
    /** Length of the media in frames. */
    frames: number;
    /** Finest first. Empty for media with no frames. */
    levels: PeakLevel[];
}

interface HeaderJson {
    format: 'hyphon-peaks';
    version: number;
    layout: 'minmax-i16le';
    baseShift: number;
    channels: number;
    frames: number;
    /** Bucket count of each level, finest first. */
    levels: number[];
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function quantizeMin(v: number): number {
    const q = Math.floor(v * FULL_SCALE);
    return q < -FULL_SCALE ? -FULL_SCALE : q > FULL_SCALE ? FULL_SCALE : q;
}

function quantizeMax(v: number): number {
    const q = Math.ceil(v * FULL_SCALE);
    return q < -FULL_SCALE ? -FULL_SCALE : q > FULL_SCALE ? FULL_SCALE : q;
}

/** Buckets of `2^shift` frames needed for `frames`. */
function bucketCount(frames: number, shift: number): number {
    return Math.ceil(frames / 2 ** shift);
}

/** Level `k + 1` from level `k`: each bucket is the merge of two below it. */
function mergeLevel(below: PeakLevel, channels: number): PeakLevel {
    const buckets = Math.ceil(below.buckets / 2);
    const stride = channels * 2;
    const data = new Int16Array(buckets * stride);
    const src = below.data;
    for (let b = 0; b < buckets; b++) {
        const a = 2 * b * stride;
        const hasPair = 2 * b + 1 < below.buckets;
        for (let i = 0; i < stride; i += 2) {
            let mn = src[a + i];
            let mx = src[a + i + 1];
            if (hasPair) {
                const mn2 = src[a + stride + i];
                const mx2 = src[a + stride + i + 1];
                if (mn2 < mn) mn = mn2;
                if (mx2 > mx) mx = mx2;
            }
            data[b * stride + i] = mn;
            data[b * stride + i + 1] = mx;
        }
    }
    return { shift: below.shift + 1, buckets, data };
}

/**
 * Builds a pyramid from audio fed in order, in chunks of any size, so a worker
 * can page media through it without holding the whole file. The result does
 * not depend on how the audio was chunked.
 */
export class PeakBuilder {
    readonly channels: number;
    readonly frames: number;
    private readonly level0: Int16Array;
    private readonly bucketFrames = 1 << PEAK_BASE_SHIFT;
    private readonly min: Float64Array;
    private readonly max: Float64Array;
    private pushed = 0;

    constructor(channels: number, frames: number) {
        if (!Number.isInteger(channels) || channels < 1) throw new Error(`Bad channel count ${channels}`);
        if (!Number.isInteger(frames) || frames < 0) throw new Error(`Bad frame count ${frames}`);
        this.channels = channels;
        this.frames = frames;
        this.level0 = new Int16Array(bucketCount(frames, PEAK_BASE_SHIFT) * channels * 2);
        this.min = new Float64Array(channels).fill(Infinity);
        this.max = new Float64Array(channels).fill(-Infinity);
    }

    /** Frames fed so far. */
    get framesPushed(): number {
        return this.pushed;
    }

    private flushBucket(bucket: number): void {
        const stride = this.channels * 2;
        for (let c = 0; c < this.channels; c++) {
            // A bucket of NaNs only (never a finite sample) reads as silence.
            const empty = !(this.min[c] <= this.max[c]);
            this.level0[bucket * stride + c * 2] = empty ? 0 : quantizeMin(this.min[c]);
            this.level0[bucket * stride + c * 2 + 1] = empty ? 0 : quantizeMax(this.max[c]);
            this.min[c] = Infinity;
            this.max[c] = -Infinity;
        }
    }

    /** Feed the next frames: one array per channel, all the same length. */
    push(planar: readonly Float32Array[]): void {
        if (planar.length !== this.channels) throw new Error(`Expected ${this.channels} channels, got ${planar.length}`);
        const n = planar[0].length;
        if (planar.some((ch) => ch.length !== n)) throw new Error('Peak chunk channels differ in length');
        if (this.pushed + n > this.frames) throw new Error('More frames pushed than the media holds');
        let i = 0;
        while (i < n) {
            const inBucket = this.pushed & (this.bucketFrames - 1);
            const take = Math.min(n - i, this.bucketFrames - inBucket);
            for (let c = 0; c < this.channels; c++) {
                const ch = planar[c];
                let mn = this.min[c];
                let mx = this.max[c];
                for (let f = i; f < i + take; f++) {
                    const v = ch[f];
                    if (v < mn) mn = v;
                    if (v > mx) mx = v;
                }
                this.min[c] = mn;
                this.max[c] = mx;
            }
            i += take;
            this.pushed += take;
            if ((this.pushed & (this.bucketFrames - 1)) === 0) this.flushBucket((this.pushed >> PEAK_BASE_SHIFT) - 1);
        }
    }

    /** The pyramid. Every frame of the media must have been pushed. */
    finish(): PeakPyramid {
        if (this.pushed !== this.frames) throw new Error(`Peaks got ${this.pushed} of ${this.frames} frames`);
        if (this.frames === 0) return { channels: this.channels, frames: 0, levels: [] };
        if ((this.pushed & (this.bucketFrames - 1)) !== 0) this.flushBucket(this.pushed >> PEAK_BASE_SHIFT);
        const levels: PeakLevel[] = [{
            shift: PEAK_BASE_SHIFT,
            buckets: bucketCount(this.frames, PEAK_BASE_SHIFT),
            data: this.level0,
        }];
        while (levels[levels.length - 1].buckets > 1) levels.push(mergeLevel(levels[levels.length - 1], this.channels));
        return { channels: this.channels, frames: this.frames, levels };
    }
}

/** The pyramid of audio already in memory. */
export function buildPeaks(planar: readonly Float32Array[]): PeakPyramid {
    const builder = new PeakBuilder(planar.length, planar[0]?.length ?? 0);
    if (builder.frames > 0) builder.push(planar);
    return builder.finish();
}

/**
 * Min and max over every channel of source frames `[from, to)`, as −1 … 1,
 * into `out` (`[min, max]`). Returns false when the range holds no frame of
 * the media. Reads the coarsest level whose buckets are no longer than the
 * range, so it costs a few buckets at any zoom; a range shorter than a
 * level-0 bucket gets that whole bucket.
 */
export function peakRange(pyramid: PeakPyramid, from: number, to: number, out: Float32Array | number[]): boolean {
    const a = Math.max(0, Math.floor(from));
    const b = Math.min(pyramid.frames, Math.ceil(to));
    if (b <= a || pyramid.levels.length === 0) return false;
    const span = b - a;
    let level = pyramid.levels[0];
    for (const candidate of pyramid.levels) {
        if (2 ** candidate.shift > span) break;
        level = candidate;
    }
    const stride = pyramid.channels * 2;
    const first = a >> level.shift;
    const last = Math.min(level.buckets - 1, (b - 1) >> level.shift);
    let mn = FULL_SCALE;
    let mx = -FULL_SCALE;
    const data = level.data;
    for (let bucket = first; bucket <= last; bucket++) {
        const o = bucket * stride;
        for (let i = 0; i < stride; i += 2) {
            if (data[o + i] < mn) mn = data[o + i];
            if (data[o + i + 1] > mx) mx = data[o + i + 1];
        }
    }
    out[0] = mn / FULL_SCALE;
    out[1] = mx / FULL_SCALE;
    return true;
}

// ---------------------------------------------------------------------------
// The peaks file
// ---------------------------------------------------------------------------

function headerBytes(pyramid: PeakPyramid): Uint8Array {
    const json: HeaderJson = {
        format: 'hyphon-peaks',
        version: PEAKS_FORMAT_VERSION,
        layout: 'minmax-i16le',
        baseShift: PEAK_BASE_SHIFT,
        channels: pyramid.channels,
        frames: pyramid.frames,
        levels: pyramid.levels.map((l) => l.buckets),
    };
    const text = new TextEncoder().encode(JSON.stringify(json));
    const padded = Math.ceil((PREAMBLE_BYTES + text.length) / 4) * 4 - PREAMBLE_BYTES;
    const out = new Uint8Array(padded).fill(0x20);
    out.set(text);
    return out;
}

export function encodePeakFile(pyramid: PeakPyramid): Uint8Array {
    if (!LITTLE_ENDIAN) throw new Error('Peak files need a little-endian platform');
    const header = headerBytes(pyramid);
    const dataOffset = PREAMBLE_BYTES + header.length;
    const values = pyramid.levels.reduce((sum, l) => sum + l.data.length, 0);
    const out = new Uint8Array(dataOffset + values * 2);
    out.set(new TextEncoder().encode(PEAKS_MAGIC), 0);
    new DataView(out.buffer).setUint32(4, header.length, true);
    out.set(header, PREAMBLE_BYTES);
    let at = dataOffset;
    for (const level of pyramid.levels) {
        out.set(new Uint8Array(level.data.buffer, level.data.byteOffset, level.data.byteLength), at);
        at += level.data.byteLength;
    }
    return out;
}

/** Parse a peaks file. Null when the bytes are not one this build reads. */
export function parsePeakFile(bytes: Uint8Array): PeakPyramid | null {
    if (!LITTLE_ENDIAN || bytes.length < PREAMBLE_BYTES) return null;
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== PEAKS_MAGIC) return null;
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    if (length > MAX_HEADER_BYTES || bytes.length < PREAMBLE_BYTES + length) return null;
    let json: Partial<HeaderJson>;
    try {
        json = JSON.parse(new TextDecoder().decode(bytes.subarray(PREAMBLE_BYTES, PREAMBLE_BYTES + length))) as Partial<HeaderJson>;
    } catch {
        return null;
    }
    const { channels, frames, levels } = json;
    if (json.format !== 'hyphon-peaks' || json.version !== PEAKS_FORMAT_VERSION || json.layout !== 'minmax-i16le') return null;
    if (json.baseShift !== PEAK_BASE_SHIFT || !Number.isInteger(channels) || !Number.isInteger(frames)) return null;
    if ((channels as number) < 1 || (frames as number) < 0 || !Array.isArray(levels)) return null;
    // The level sizes follow from the frame count; anything else is corrupt.
    const expected: number[] = [];
    if ((frames as number) > 0) {
        expected.push(bucketCount(frames as number, PEAK_BASE_SHIFT));
        while (expected[expected.length - 1] > 1) expected.push(Math.ceil(expected[expected.length - 1] / 2));
    }
    if (levels.length !== expected.length || levels.some((n, i) => n !== expected[i])) return null;
    const stride = (channels as number) * 2;
    const dataOffset = PREAMBLE_BYTES + length;
    const total = expected.reduce((sum, n) => sum + n * stride, 0);
    if (dataOffset % 2 !== 0 || bytes.length !== dataOffset + total * 2) return null;
    const all = new Int16Array(total);
    new Uint8Array(all.buffer).set(bytes.subarray(dataOffset));
    const out: PeakLevel[] = [];
    let at = 0;
    expected.forEach((buckets, k) => {
        out.push({ shift: PEAK_BASE_SHIFT + k, buckets, data: all.subarray(at, at + buckets * stride) });
        at += buckets * stride;
    });
    return { channels: channels as number, frames: frames as number, levels: out };
}
