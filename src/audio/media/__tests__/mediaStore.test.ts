import { describe, expect, it } from 'vitest';
import type { ProjectFileBackend } from '@/services/projectFileBackends';
import { MEDIA_HEADER_PROBE_BYTES, encodeMediaFile, parseMediaHeader } from '../mediaFile';
import { decodeWav } from '../wav';
import { MediaStore, mediaPath, sha256Hex } from '../MediaStore';
import { importAudioFile, toStereo } from '../importAudioFile';

/** In-memory backend that counts bytes read, so tests can see paging. */
function memoryBackend(): ProjectFileBackend & { files: Map<string, Uint8Array>; bytesRead: number } {
    const files = new Map<string, Uint8Array>();
    const backend = {
        kind: 'memory' as const,
        files,
        bytesRead: 0,
        writeFile: (path: string, data: Uint8Array | string) => {
            files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data.slice());
            return Promise.resolve();
        },
        readFile: (path: string) => {
            const b = files.get(path) ?? null;
            if (b) backend.bytesRead += b.length;
            return Promise.resolve(b);
        },
        readText: (path: string) => Promise.resolve(files.has(path) ? new TextDecoder().decode(files.get(path)) : null),
        readRange: (path: string, start: number, end: number) => {
            const b = files.get(path);
            if (!b) return Promise.resolve(null);
            const out = b.slice(start, end);
            backend.bytesRead += out.length;
            return Promise.resolve(out);
        },
        exists: (path: string) => Promise.resolve(files.has(path)),
        deleteFile: (path: string) => {
            files.delete(path);
            return Promise.resolve();
        },
        listDirs: () => Promise.resolve([]),
        deleteDir: () => Promise.resolve(),
    };
    return backend;
}

interface WavSpec {
    channels: number;
    sampleRate: number;
    bits: 8 | 16 | 24 | 32;
    float?: boolean;
    extensible?: boolean;
    rf64?: boolean;
    /** Interleaved values in -1..1. */
    samples: number[];
}

function encodeWav(spec: WavSpec): Uint8Array {
    const bytesPerSample = spec.bits / 8;
    const dataSize = spec.samples.length * bytesPerSample;
    const fmtSize = spec.extensible ? 40 : 16;
    const ds64 = spec.rf64 ? 8 + 28 : 0;
    const out = new Uint8Array(12 + ds64 + 8 + fmtSize + 8 + dataSize + (dataSize & 1));
    const v = new DataView(out.buffer);
    const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
    tag(0, spec.rf64 ? 'RF64' : 'RIFF');
    v.setUint32(4, spec.rf64 ? 0xffffffff : out.length - 8, true);
    tag(8, 'WAVE');
    let at = 12;
    if (spec.rf64) {
        tag(at, 'ds64');
        v.setUint32(at + 4, 28, true);
        v.setBigUint64(at + 8, BigInt(out.length - 8), true);
        v.setBigUint64(at + 16, BigInt(dataSize), true);
        v.setBigUint64(at + 24, BigInt(spec.samples.length / spec.channels), true);
        at += 36;
    }
    tag(at, 'fmt ');
    v.setUint32(at + 4, fmtSize, true);
    const formatTag = spec.float ? 3 : 1;
    v.setUint16(at + 8, spec.extensible ? 0xfffe : formatTag, true);
    v.setUint16(at + 10, spec.channels, true);
    v.setUint32(at + 12, spec.sampleRate, true);
    v.setUint32(at + 16, spec.sampleRate * spec.channels * bytesPerSample, true);
    v.setUint16(at + 20, spec.channels * bytesPerSample, true);
    v.setUint16(at + 22, spec.bits, true);
    if (spec.extensible) {
        v.setUint16(at + 24, 22, true);
        v.setUint16(at + 26, spec.bits, true);
        v.setUint16(at + 32, formatTag, true);
    }
    at += 8 + fmtSize;
    tag(at, 'data');
    v.setUint32(at + 4, spec.rf64 ? 0xffffffff : dataSize, true);
    at += 8;
    for (const s of spec.samples) {
        if (spec.float) v.setFloat32(at, s, true);
        else if (spec.bits === 8) v.setUint8(at, Math.round(s * 127) + 128);
        else if (spec.bits === 16) v.setInt16(at, Math.round(s * 32767), true);
        else if (spec.bits === 24) {
            const n = Math.round(s * 8388607);
            v.setUint8(at, n & 0xff);
            v.setUint8(at + 1, (n >> 8) & 0xff);
            v.setInt8(at + 2, n >> 16);
        } else v.setInt32(at, Math.round(s * 2147483647), true);
        at += bytesPerSample;
    }
    return out;
}

const ramp = (n: number, channels: number) =>
    Array.from({ length: n * channels }, (_, i) => ((i % 17) - 8) / 10);

describe('media file format', () => {
    it('round-trips planar audio and lands the samples on a 16-byte boundary', () => {
        const planar = [new Float32Array([0.5, -0.25, 1]), new Float32Array([0, 0.125, -1])];
        const bytes = encodeMediaFile(planar, 44100);
        const header = parseMediaHeader(bytes.subarray(0, MEDIA_HEADER_PROBE_BYTES))!;
        expect(header).toMatchObject({ sampleRate: 44100, channels: 2, frames: 3 });
        expect(header.dataOffset % 16).toBe(0);
        const data = new Float32Array(bytes.buffer, header.dataOffset, 6);
        expect(Array.from(data)).toEqual([0.5, -0.25, 1, 0, 0.125, -1]);
    });

    it('is deterministic, so equal audio has one hash', async () => {
        const a = encodeMediaFile([new Float32Array([0.1, 0.2])], 48000);
        const b = encodeMediaFile([new Float32Array([0.1, 0.2])], 48000);
        expect(await sha256Hex(a)).toBe(await sha256Hex(b));
        expect(await sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects bytes that are not a media file', () => {
        expect(parseMediaHeader(new TextEncoder().encode('RIFF....WAVE'))).toBeNull();
        expect(parseMediaHeader(new Uint8Array(4))).toBeNull();
    });
});

describe('decodeWav', () => {
    it.each([
        ['16-bit PCM', { bits: 16 as const }, 1 / 32767],
        ['24-bit PCM', { bits: 24 as const }, 1 / 8388607],
        ['32-bit PCM', { bits: 32 as const }, 1e-6],
        ['8-bit PCM', { bits: 8 as const }, 1 / 64],
        ['32-bit float', { bits: 32 as const, float: true }, 1e-7],
        ['extensible 24-bit', { bits: 24 as const, extensible: true }, 1 / 8388607],
        ['RF64 float', { bits: 32 as const, float: true, rf64: true }, 1e-7],
    ])('%s', (_name, extra, tolerance) => {
        const samples = ramp(50, 2);
        const decoded = decodeWav(encodeWav({ channels: 2, sampleRate: 48000, samples, ...extra }))!;
        expect(decoded.sampleRate).toBe(48000);
        expect(decoded.channels).toHaveLength(2);
        expect(decoded.channels[0]).toHaveLength(50);
        for (let f = 0; f < 50; f++) {
            expect(Math.abs(decoded.channels[0][f] - samples[f * 2])).toBeLessThanOrEqual(tolerance * 1.01);
            expect(Math.abs(decoded.channels[1][f] - samples[f * 2 + 1])).toBeLessThanOrEqual(tolerance * 1.01);
        }
    });

    it('decodes a truncated data chunk up to its last whole frame', () => {
        const bytes = encodeWav({ channels: 2, sampleRate: 44100, bits: 16, samples: ramp(10, 2) });
        const decoded = decodeWav(bytes.subarray(0, bytes.length - 3))!;
        expect(decoded.channels[0]).toHaveLength(9);
    });

    it('returns null for other files', () => {
        expect(decodeWav(new TextEncoder().encode('ID3 not a wav file at all'))).toBeNull();
    });
});

describe('MediaStore', () => {
    it('stores media under its hash, once', async () => {
        const backend = memoryBackend();
        const store = new MediaStore(backend);
        const planar = [new Float32Array([0.1, 0.2, 0.3])];
        const first = await store.put(planar, 48000);
        expect(first).toMatchObject({ sampleRate: 48000, channels: 1, frames: 3, created: true });
        expect(backend.files.has(mediaPath(first.id))).toBe(true);
        expect(first.id).toBe(await sha256Hex(backend.files.get(mediaPath(first.id))!));

        const second = await new MediaStore(backend).put([new Float32Array([0.1, 0.2, 0.3])], 48000);
        expect(second).toMatchObject({ id: first.id, created: false });
        expect(backend.files.size).toBe(1);
    });

    it('reads a page of frames without reading the rest of the file', async () => {
        const backend = memoryBackend();
        const store = new MediaStore(backend);
        const frames = 48000 * 4;
        const left = Float32Array.from({ length: frames }, (_, i) => i / frames);
        const right = Float32Array.from({ length: frames }, (_, i) => -i / frames);
        const { id } = await store.put([left, right], 48000);
        const reader = new MediaStore(backend);
        backend.bytesRead = 0;
        const page = (await reader.readFrames(id, 1000, 256))!;
        expect(Array.from(page[0])).toEqual(Array.from(left.subarray(1000, 1256)));
        expect(Array.from(page[1])).toEqual(Array.from(right.subarray(1000, 1256)));
        // The header probe plus two 1 KiB channel ranges — not the 1.5 MB file.
        expect(backend.bytesRead).toBeLessThan(MEDIA_HEADER_PROBE_BYTES + 4 * 1024);
    });

    it('clamps a page to the media length and answers null for unknown media', async () => {
        const store = new MediaStore(memoryBackend());
        const { id } = await store.put([new Float32Array([1, 2, 3, 4])], 8000);
        expect((await store.readFrames(id, 2, 10))!.map((c) => Array.from(c))).toEqual([[3, 4]]);
        expect((await store.readFrames(id, 9, 10))![0]).toHaveLength(0);
        expect(await store.readFrames('0'.repeat(64), 0, 1)).toBeNull();
        expect(await store.info('not-a-hash')).toBeNull();
        await store.remove(id);
        expect(await store.has(id)).toBe(false);
    });
});

describe('importAudioFile', () => {
    it('imports a WAV losslessly at its own rate', async () => {
        const store = new MediaStore(memoryBackend());
        const wav = encodeWav({ channels: 1, sampleRate: 22050, bits: 32, float: true, samples: [0.5, -0.5, 0.25] });
        const file = Object.assign(new Blob([wav as Uint8Array<ArrayBuffer>]), { name: 'vox.wav' });
        const imported = await importAudioFile(file, { store });
        expect(imported).toMatchObject({ decoder: 'wav', created: true, ref: { name: 'vox.wav', sampleRate: 22050, channels: 1, frames: 3 } });
        expect(Array.from((await store.readFrames(imported.mediaId, 0, 3))![0])).toEqual([0.5, -0.5, 0.25]);
    });

    it('hands other formats to the browser decoder and mixes surround down to stereo', async () => {
        const store = new MediaStore(memoryBackend());
        const file = Object.assign(new Blob([new Uint8Array([1, 2, 3])]), { name: 'loop.mp3' });
        const imported = await importAudioFile(file, {
            store,
            decodeWithBrowser: () => Promise.resolve({
                sampleRate: 48000,
                channels: [0, 1, 2, 3].map((c) => new Float32Array([c, c])),
            }),
        });
        expect(imported).toMatchObject({ decoder: 'browser', ref: { channels: 2, frames: 2 } });
        const [l, r] = (await store.readFrames(imported.mediaId, 0, 2))!;
        expect(Array.from(l)).toEqual([1, 1]); // (0 + 2) / 2
        expect(Array.from(r)).toEqual([2, 2]); // (1 + 3) / 2
    });

    it('says why a file cannot be imported', async () => {
        const store = new MediaStore(memoryBackend());
        const junk = Object.assign(new Blob([new Uint8Array([9])]), { name: 'notes.txt' });
        await expect(importAudioFile(junk, { store, decodeWithBrowser: () => Promise.reject(new Error('EncodingError')) }))
            .rejects.toThrow(/notes\.txt: not an audio file this browser can decode/);
        const empty = Object.assign(new Blob([encodeWav({ channels: 1, sampleRate: 8000, bits: 16, samples: [] }) as Uint8Array<ArrayBuffer>]), { name: 'empty.wav' });
        await expect(importAudioFile(empty, { store })).rejects.toThrow(/holds no audio/);
    });

    it('keeps mono and stereo as they are', () => {
        const mono = [new Float32Array([1])];
        expect(toStereo(mono)).toBe(mono);
    });
});
