/**
 * Waveform peaks (#1629 P2): the pyramid, its file, and builds from the media
 * store, page by page, that match a build from the whole audio.
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { MemoryBackendForTests } from './peakTestBackend';
import { MediaStore, peaksPath } from '../MediaStore';
import { importAudioFile } from '../importAudioFile';
import {
    PEAK_BASE_SHIFT, PeakBuilder, buildPeaks, encodePeakFile, parsePeakFile, peakRange, type PeakPyramid,
} from '../peaks';

const BUCKET = 1 << PEAK_BASE_SHIFT;

/** Deterministic noise in -1..1, with some louder-than-full-scale samples. */
function noise(frames: number, seed: number): Float32Array {
    const out = new Float32Array(frames);
    let x = seed >>> 0 || 1;
    for (let i = 0; i < frames; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        out[i] = (((x >>> 0) / 0xffffffff) * 2 - 1) * (i % 997 === 0 ? 1.4 : 0.9);
    }
    return out;
}

/** Min / max over every channel of `[from, to)`, straight from the audio. */
function bruteRange(planar: Float32Array[], from: number, to: number): [number, number] {
    let mn = Infinity;
    let mx = -Infinity;
    for (const ch of planar) {
        for (let i = Math.max(0, from); i < Math.min(ch.length, to); i++) {
            mn = Math.min(mn, ch[i]);
            mx = Math.max(mx, ch[i]);
        }
    }
    return [mn, mx];
}

const STEP = 1 / 32767;

describe('peak pyramid', () => {
    it('holds min / max per 256-frame bucket, rounded outward, up to one bucket', () => {
        const left = new Float32Array(BUCKET * 3 + 10);
        const right = new Float32Array(left.length);
        left[5] = 0.5;
        left[BUCKET + 7] = -0.25;
        right[BUCKET * 2 + 1] = 2; // clamps to full scale
        right[BUCKET * 3 + 9] = -0.125;
        const p = buildPeaks([left, right]);
        expect(p.levels.map((l) => l.buckets)).toEqual([4, 2, 1]);
        expect(p.levels.map((l) => l.shift)).toEqual([8, 9, 10]);
        const l0 = p.levels[0].data;
        // bucket 0: L [0, ceil(0.5·32767)], R [0, 0]
        expect(Array.from(l0.subarray(0, 4))).toEqual([0, 16384, 0, 0]);
        expect(Array.from(l0.subarray(4, 8))).toEqual([Math.floor(-0.25 * 32767), 0, 0, 0]);
        expect(Array.from(l0.subarray(8, 12))).toEqual([0, 0, 0, 32767]);
        // The short last bucket (10 frames) still counts.
        expect(Array.from(l0.subarray(12, 16))).toEqual([0, 0, Math.floor(-0.125 * 32767), 0]);
        expect(Array.from(p.levels[2].data)).toEqual([Math.floor(-0.25 * 32767), 16384, Math.floor(-0.125 * 32767), 32767]);
    });

    it('reads any range as the min / max of the audio there, never quieter', () => {
        const planar = [noise(BUCKET * 40 + 77, 1), noise(BUCKET * 40 + 77, 2)];
        const p = buildPeaks(planar);
        fc.assert(fc.property(fc.nat(planar[0].length - 1), fc.integer({ min: 1, max: 6000 }), (from, span) => {
            const to = Math.min(planar[0].length, from + span);
            const out = [0, 0];
            expect(peakRange(p, from, to, out)).toBe(true);
            const [mn, mx] = bruteRange(planar, from, to);
            // Covers the audio (bucket edges may widen it), clamped at full scale.
            expect(out[0]).toBeLessThanOrEqual(Math.max(-1, mn) + STEP);
            expect(out[1]).toBeGreaterThanOrEqual(Math.min(1, mx) - STEP);
            // ... and is the audio of the buckets read, no wider than one level-0 bucket either side at span ≥ 2 buckets.
            const [wideMn, wideMx] = bruteRange(planar, from - span - BUCKET, to + span + BUCKET);
            expect(out[0]).toBeGreaterThanOrEqual(Math.max(-1, wideMn) - STEP);
            expect(out[1]).toBeLessThanOrEqual(Math.min(1, wideMx) + STEP);
        }), { numRuns: 200 });
    });

    it('reports no audio outside the media', () => {
        const p = buildPeaks([new Float32Array(1000).fill(0.5)]);
        const out = [0, 0];
        expect(peakRange(p, -500, 0, out)).toBe(false);
        expect(peakRange(p, 1000, 4000, out)).toBe(false);
        expect(peakRange(p, -10, 1, out)).toBe(true);
        expect(peakRange(buildPeaks([new Float32Array(0)]), 0, 10, out)).toBe(false);
    });

    it('does not depend on how the audio was chunked', () => {
        const frames = BUCKET * 9 + 13;
        const planar = [noise(frames, 7), noise(frames, 8)];
        const whole = encodePeakFile(buildPeaks(planar));
        fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 900 }), { minLength: 1, maxLength: 40 }), (sizes) => {
            const builder = new PeakBuilder(2, frames);
            let at = 0;
            for (let i = 0; at < frames; i++) {
                const n = Math.min(frames - at, sizes[i % sizes.length]);
                builder.push(planar.map((ch) => ch.subarray(at, at + n)));
                at += n;
            }
            expect(encodePeakFile(builder.finish())).toEqual(whole);
        }), { numRuns: 50 });
    });

    it('treats NaN as silence and refuses a short or long feed', () => {
        const p = buildPeaks([new Float32Array(BUCKET).fill(NaN)]);
        expect(Array.from(p.levels[0].data)).toEqual([0, 0]);
        const builder = new PeakBuilder(1, 10);
        expect(() => builder.push([new Float32Array(11)])).toThrow(/More frames/);
        builder.push([new Float32Array(9)]);
        expect(() => builder.finish()).toThrow(/9 of 10/);
    });
});

describe('peak file', () => {
    it('round-trips and is deterministic', () => {
        const planar = [noise(BUCKET * 5 + 3, 3)];
        const bytes = encodePeakFile(buildPeaks(planar));
        expect(encodePeakFile(buildPeaks(planar))).toEqual(bytes);
        const parsed = parsePeakFile(bytes) as PeakPyramid;
        expect(parsed.frames).toBe(planar[0].length);
        expect(encodePeakFile(parsed)).toEqual(bytes);
        // An empty file has no levels.
        expect(parsePeakFile(encodePeakFile(buildPeaks([new Float32Array(0), new Float32Array(0)]))))
            .toEqual({ channels: 2, frames: 0, levels: [] });
    });

    it('reads a corrupt, truncated or other-version file as missing', () => {
        const bytes = encodePeakFile(buildPeaks([noise(BUCKET * 3, 4)]));
        expect(parsePeakFile(bytes.slice(0, bytes.length - 2))).toBeNull();
        const magic = bytes.slice();
        magic[0] = 0x58;
        expect(parsePeakFile(magic)).toBeNull();
        const text = new TextDecoder().decode(bytes.subarray(8, 8 + new DataView(bytes.buffer).getUint32(4, true)));
        const bumped = new TextEncoder().encode(text.replace('"version":1', '"version":9'));
        const other = bytes.slice();
        other.set(bumped, 8);
        expect(parsePeakFile(other)).toBeNull();
        const lie = bytes.slice();
        lie.set(new TextEncoder().encode(text.replace(/"frames":\d+/, '"frames":5')), 8);
        expect(parsePeakFile(lie)).toBeNull();
    });
});

describe('peaks in the media store', () => {
    it('builds page by page what a build from the whole audio gives, without reading the whole file at once', async () => {
        const backend = new MemoryBackendForTests();
        const store = new MediaStore(backend);
        const planar = [noise(BUCKET * 70 + 5, 5), noise(BUCKET * 70 + 5, 6)];
        const { id } = await store.put(planar, 48000);
        backend.largestRead = 0;
        const built = await store.buildPeaks(id, 1000);
        expect(built && encodePeakFile(built)).toEqual(encodePeakFile(buildPeaks(planar)));
        // A page of one channel is the largest read (1000 rounds up to 1024 frames).
        expect(backend.largestRead).toBeLessThanOrEqual(1024 * 4 + 4096 + 8);
        expect(await store.buildPeaks('a'.repeat(64))).toBeNull();
    });

    it('stores, reads and removes peaks next to the media', async () => {
        const backend = new MemoryBackendForTests();
        const store = new MediaStore(backend);
        const { id } = await store.put([noise(3000, 9)], 44100);
        expect(await store.readPeaks(id)).toBeNull();
        const peaks = (await store.buildPeaks(id))!;
        await store.writePeaks(id, peaks);
        expect(backend.files.has(peaksPath(id))).toBe(true);
        expect(encodePeakFile((await store.readPeaks(id))!)).toEqual(encodePeakFile(peaks));
        await store.remove(id);
        expect(backend.files.size).toBe(0);
    });

    it('is written by the import, from the audio it decoded', async () => {
        const backend = new MemoryBackendForTests();
        const store = new MediaStore(backend);
        const audio = noise(9000, 11);
        const imported = await importAudioFile(new File([new Uint8Array([1, 2, 3])], 'hit.ogg'), {
            store,
            decodeWithBrowser: () => Promise.resolve({ sampleRate: 48000, channels: [audio] }),
        });
        expect(encodePeakFile(imported.peaks)).toEqual(encodePeakFile(buildPeaks([audio])));
        expect(encodePeakFile((await store.readPeaks(imported.mediaId))!)).toEqual(encodePeakFile(imported.peaks));
        expect(encodePeakFile((await store.buildPeaks(imported.mediaId))!)).toEqual(encodePeakFile(imported.peaks));
    });

    it('still imports when the peaks cannot be stored', async () => {
        const backend = new MemoryBackendForTests();
        const store = new MediaStore(backend);
        const write = backend.writeFile.bind(backend);
        backend.writeFile = (path, data) => (path.endsWith('.peaks') ? Promise.reject(new Error('quota')) : write(path, data));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const imported = await importAudioFile(new File([new Uint8Array([1])], 'x.ogg'), {
            store,
            decodeWithBrowser: () => Promise.resolve({ sampleRate: 48000, channels: [noise(500, 1)] }),
        });
        expect(imported.peaks.frames).toBe(500);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
