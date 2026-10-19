/**
 * Listening without ears: the metrics `pnpm run ai-song:render` writes to
 * `report.json` for every stem and the master.
 *
 * An agent that composed a song cannot hear the render, but it can read
 * "bar 2 is 9 dB quieter than bar 1" or "the centroid climbs from 900 Hz to
 * 3 kHz across the sweep". Pure TypeScript, no DOM: the CLI runs it in Node on
 * the WAV bytes the agent hook returns, and the unit tests run it directly.
 *
 * Loudness is the BS.1770 meter the master bus and the export path already
 * use (`src/audio/loudness`), so the LUFS here is the LUFS the app reports.
 */

import { analyzeLoudness } from '../audio/loudness/offline';

export interface DecodedWav {
    sampleRate: number;
    channels: Float32Array[];
}

/** Decode a RIFF/WAVE file: PCM 8/16/24/32-bit or IEEE float 32/64. */
export function parseWav(bytes: Uint8Array): DecodedWav {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
        throw new Error('not a RIFF/WAVE file');
    }

    let format = 0;
    let channelCount = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataOffset = -1;
    let dataLength = 0;
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const id = tag(offset);
        const size = view.getUint32(offset + 4, true);
        const body = offset + 8;
        if (id === 'fmt ') {
            format = view.getUint16(body, true);
            channelCount = view.getUint16(body + 2, true);
            sampleRate = view.getUint32(body + 4, true);
            bitsPerSample = view.getUint16(body + 14, true);
            if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
        } else if (id === 'data') {
            dataOffset = body;
            dataLength = Math.min(size, bytes.length - body);
            break;
        }
        offset = body + size + (size % 2);
    }
    if (dataOffset < 0 || channelCount === 0 || sampleRate === 0) {
        throw new Error('WAV has no fmt or data chunk');
    }

    const bytesPerSample = bitsPerSample / 8;
    const frames = Math.floor(dataLength / (bytesPerSample * channelCount));
    const read = (offset: number): number => {
        if (format === 3) return bitsPerSample === 64 ? view.getFloat64(offset, true) : view.getFloat32(offset, true);
        if (format !== 1) throw new Error(`unsupported WAV format ${format}`);
        switch (bitsPerSample) {
            case 8: return (view.getUint8(offset) - 128) / 128;
            case 16: return view.getInt16(offset, true) / 32768;
            case 24: {
                const v = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16);
                return v / 8388608;
            }
            case 32: return view.getInt32(offset, true) / 2147483648;
            default: throw new Error(`unsupported PCM bit depth ${bitsPerSample}`);
        }
    };

    const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
    for (let frame = 0; frame < frames; frame++) {
        const base = dataOffset + frame * bytesPerSample * channelCount;
        for (let ch = 0; ch < channelCount; ch++) channels[ch][frame] = read(base + ch * bytesPerSample);
    }
    return { sampleRate, channels };
}

// ---------------------------------------------------------------------------
// Spectrum
// ---------------------------------------------------------------------------

const FFT_SIZE = 2048;
const HOP = 1024;

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k;
                const b = a + len / 2;
                const tr = re[b] * cr - im[b] * ci;
                const ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                const next = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = next;
            }
        }
    }
}

const HANN = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));

/** Channel average (the centroid and RMS read the mid signal). */
export function mixDown(channels: readonly Float32Array[]): Float32Array {
    if (channels.length === 1) return channels[0];
    const out = new Float32Array(channels[0]?.length ?? 0);
    for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
    return out;
}

/**
 * Spectral centroid (Hz) of `mono` over `[start, end)` samples: the centroid of
 * each 2048-point Hann frame, weighted by that frame's energy so a note's tail
 * and the silence between notes do not drag it around. Null when silent.
 */
export function spectralCentroid(mono: Float32Array, sampleRate: number, start = 0, end = mono.length): number | null {
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);
    let weighted = 0;
    let energy = 0;
    for (let frame = start; frame < end; frame += HOP) {
        for (let i = 0; i < FFT_SIZE; i++) {
            const idx = frame + i;
            re[i] = idx < end ? mono[idx] * HANN[i] : 0;
            im[i] = 0;
        }
        fft(re, im);
        let mag = 0;
        let magHz = 0;
        let power = 0;
        for (let bin = 1; bin < FFT_SIZE / 2; bin++) {
            const p = re[bin] * re[bin] + im[bin] * im[bin];
            const m = Math.sqrt(p);
            mag += m;
            magHz += m * ((bin * sampleRate) / FFT_SIZE);
            power += p;
        }
        if (mag > 0) {
            weighted += (magHz / mag) * power;
            energy += power;
        }
    }
    // -100 dBFS-ish floor: a dithered or denormal tail is not a centroid.
    return energy > 1e-9 ? weighted / energy : null;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** A level in dBFS, or null for digital silence (JSON has no -Infinity). */
function db(linear: number): number | null {
    return linear > 0 ? round(20 * Math.log10(linear), 2) : null;
}

function round(value: number, digits: number): number {
    const k = 10 ** digits;
    return Math.round(value * k) / k;
}

function finiteOrNull(value: number, digits = 2): number | null {
    return Number.isFinite(value) ? round(value, digits) : null;
}

function rms(mono: Float32Array, start: number, end: number): number {
    let sum = 0;
    for (let i = start; i < end; i++) sum += mono[i] * mono[i];
    return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

/** Below this sample peak a render counts as silent (-80 dBFS). */
export const SILENCE_PEAK = 1e-4;

/**
 * Seconds to the first 10 ms window above `thresholdDb` (RMS), or null. A live
 * capture starts before the transport does; this finds where the music starts.
 */
export function firstOnsetSeconds(channels: readonly Float32Array[], sampleRate: number, thresholdDb = -50): number | null {
    const mono = mixDown(channels);
    const win = Math.max(1, Math.round(sampleRate * 0.01));
    const threshold = 10 ** (thresholdDb / 20);
    for (let start = 0; start + win <= mono.length; start += win) {
        if (rms(mono, start, start + win) >= threshold) return start / sampleRate;
    }
    return null;
}

export interface BarMetrics {
    /** 1-based bar number. */
    bar: number;
    startSeconds: number;
    rmsDbfs: number | null;
    centroidHz: number | null;
}

export interface AudioMetrics {
    durationSeconds: number;
    sampleRate: number;
    channels: number;
    /** Sample peak, linear and dBFS. */
    peak: number;
    peakDbfs: number | null;
    /** Gated BS.1770 integrated loudness; null for silence. */
    integratedLufs: number | null;
    truePeakDbtp: number | null;
    rmsDbfs: number | null;
    /**
     * Peak below -80 dBFS, or nothing above BS.1770's -70 LUFS absolute gate
     * (`integratedLufs` null). The live-patch master carries a constant
     * ~-61 dBFS floor even with no notes, so peak alone cannot tell.
     */
    silent: boolean;
    bars: BarMetrics[];
}

export interface BarGrid {
    /** Seconds per 16th step: `60 / tempo / 4`. */
    stepSeconds: number;
    /** 16th steps per bar: `numerator * 16 / denominator`. */
    stepsPerBar: number;
    /** Where bar 1 starts in the file (a live capture's onset). Default 0. */
    offsetSeconds?: number;
}

/** Peak, loudness, and RMS + centroid per bar of a decoded render. */
export function analyzeAudio(channels: readonly Float32Array[], sampleRate: number, grid: BarGrid): AudioMetrics {
    const frames = channels[0]?.length ?? 0;
    let peak = 0;
    for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    const mono = mixDown(channels);
    const loudness = frames > 0 ? analyzeLoudness([...channels], sampleRate, 4) : null;

    const barSamples = grid.stepSeconds * grid.stepsPerBar * sampleRate;
    const offset = Math.round((grid.offsetSeconds ?? 0) * sampleRate);
    const bars: BarMetrics[] = [];
    if (barSamples > 0) {
        for (let bar = 0; offset + Math.round(bar * barSamples) < frames; bar++) {
            const start = offset + Math.round(bar * barSamples);
            const end = Math.min(frames, offset + Math.round((bar + 1) * barSamples));
            const centroid = spectralCentroid(mono, sampleRate, start, end);
            bars.push({
                bar: bar + 1,
                startSeconds: round(start / sampleRate, 4),
                rmsDbfs: db(rms(mono, start, end)),
                centroidHz: centroid === null ? null : Math.round(centroid),
            });
        }
    }

    const integratedLufs = loudness ? finiteOrNull(loudness.integrated) : null;
    return {
        durationSeconds: round(frames / sampleRate, 4),
        sampleRate,
        channels: channels.length,
        peak: round(peak, 6),
        peakDbfs: db(peak),
        integratedLufs,
        truePeakDbtp: loudness ? finiteOrNull(loudness.truePeak) : null,
        rmsDbfs: db(rms(mono, 0, frames)),
        silent: peak < SILENCE_PEAK || integratedLufs === null,
        bars,
    };
}

/** 16th steps per bar of a time signature (the song meter's bar). */
export function stepsPerBar(timeSignature: readonly [number, number] | undefined): number {
    const [num, den] = timeSignature ?? [4, 4];
    return Math.max(1, Math.round((num * 16) / den));
}
