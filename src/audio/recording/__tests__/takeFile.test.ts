import { describe, expect, it } from 'vitest';
import { decodeWav } from '../../media/wav';
import { TakeFileWriter, recoverTakeFile } from '../takeFileWriter';
import { TAKE_HEADER_BYTES, encodeTakeHeader, framesInFile, parseTakeHeader } from '../wavTakeFile';
import { MemTakeFile } from './memTakeFile';

function interleaved(frames: number, channels: number, at = 0): Float32Array {
    const out = new Float32Array(frames * channels);
    for (let f = 0; f < frames; f++) {
        for (let c = 0; c < channels; c++) out[f * channels + c] = Math.sin((at + f) * 0.01 + c) * 0.5;
    }
    return out;
}

describe('take WAV header', () => {
    it('is a 94-byte float WAV that decodeWav reads back exactly', () => {
        const file = new MemTakeFile();
        const writer = new TakeFileWriter(file, { sampleRate: 48000, channels: 2 });
        const a = interleaved(1000, 2);
        writer.append(a, 1000);
        expect(writer.finish()).toBe(1000);
        expect(file.closed).toBe(true);

        const decoded = decodeWav(file.bytes)!;
        expect(decoded.sampleRate).toBe(48000);
        expect(decoded.channels).toHaveLength(2);
        expect(decoded.channels[0].length).toBe(1000);
        for (let f = 0; f < 1000; f += 97) {
            expect(decoded.channels[0][f]).toBe(a[f * 2]);
            expect(decoded.channels[1][f]).toBe(a[f * 2 + 1]);
        }
        expect(parseTakeHeader(file.bytes)).toEqual({ sampleRate: 48000, channels: 2 });
        expect(file.bytes.length).toBe(TAKE_HEADER_BYTES + 1000 * 8);
    });

    it('writes dropped frames as silence in place, so later frames keep their position', () => {
        const file = new MemTakeFile();
        const writer = new TakeFileWriter(file, { sampleRate: 44100, channels: 1 });
        writer.append(Float32Array.from([0.1, 0.2, 0.3]), 3);
        writer.appendSilence(4);
        writer.append(Float32Array.from([0.9]), 1);
        writer.finish();
        const ch = decodeWav(file.bytes)!.channels[0];
        expect(Array.from(ch).map((v) => Math.round(v * 10) / 10)).toEqual([0.1, 0.2, 0.3, 0, 0, 0, 0, 0.9]);
    });

    it('truncates to a stop frame: the file and its header end there', () => {
        const file = new MemTakeFile();
        const writer = new TakeFileWriter(file, { sampleRate: 48000, channels: 2 });
        writer.append(interleaved(500, 2), 500);
        writer.truncate(320);
        writer.truncate(900); // never grows
        expect(writer.finish()).toBe(320);
        expect(file.getSize()).toBe(TAKE_HEADER_BYTES + 320 * 8);
        expect(decodeWav(file.bytes)!.channels[0].length).toBe(320);
    });

    it('promotes the header to RF64 past the RIFF size limit, and decodeWav still reads it', () => {
        const file = new MemTakeFile();
        const limit = TAKE_HEADER_BYTES - 8 + 100 * 8; // 100 stereo frames fit; 101 do not
        const writer = new TakeFileWriter(file, { sampleRate: 48000, channels: 2 }, { rf64Limit: limit, commitEveryFrames: 50 });
        writer.append(interleaved(100, 2), 100);
        expect(String.fromCharCode(...file.flushed.subarray(0, 4))).toBe('RIFF');
        writer.append(interleaved(1, 2, 100), 1);
        writer.finish();
        const head = String.fromCharCode(...file.bytes.subarray(0, 4));
        expect(head).toBe('RF64');
        expect(String.fromCharCode(...file.bytes.subarray(12, 16))).toBe('ds64');
        const view = new DataView(file.bytes.buffer, file.bytes.byteOffset);
        expect(view.getUint32(4, true)).toBe(0xffffffff);
        expect(view.getUint32(90, true)).toBe(0xffffffff);
        expect(Number(view.getBigUint64(28, true))).toBe(101 * 8);
        expect(Number(view.getBigUint64(36, true))).toBe(101);
        expect(decodeWav(file.bytes)!.channels[0].length).toBe(101);
    });

    it('commits once per second of audio: a killed tab leaves a valid WAV up to the last commit', () => {
        const file = new MemTakeFile();
        const writer = new TakeFileWriter(file, { sampleRate: 1000, channels: 2 });
        for (let i = 0; i < 25; i++) writer.append(interleaved(100, 2, i * 100), 100); // 2.5 s
        expect(writer.committedFrames).toBe(2000);
        // The tab dies here: only flushed bytes survive.
        const survived = file.flushed;
        expect(decodeWav(survived)!.channels[0].length).toBe(2000);
    });

    it('recovers a partial take: trims a torn frame and patches the header for what is on disk', () => {
        const file = new MemTakeFile();
        const writer = new TakeFileWriter(file, { sampleRate: 1000, channels: 2 });
        writer.append(interleaved(1000, 2), 1000); // committed
        writer.append(interleaved(500, 2, 1000), 500); // written, not committed
        // The tab dies mid-write: 1500 frames plus half a frame are on disk, the header says 1000.
        const torn = new MemTakeFile();
        torn.write(file.bytes, { at: 0 });
        torn.write(new Uint8Array(4), { at: file.bytes.length });
        expect(decodeWav(torn.bytes)!.channels[0].length).toBe(1000);

        const result = recoverTakeFile(torn);
        expect(result).toEqual({ format: { sampleRate: 1000, channels: 2 }, frames: 1500 });
        expect(torn.getSize()).toBe(TAKE_HEADER_BYTES + 1500 * 8);
        const decoded = decodeWav(torn.flushed)!;
        expect(decoded.channels[0].length).toBe(1500);
        expect(framesInFile({ sampleRate: 1000, channels: 2 }, torn.getSize())).toBe(1500);
    });

    it('refuses to recover a file it did not write', () => {
        const file = new MemTakeFile();
        file.write(new TextEncoder().encode('not a wav at all, just some bytes that are long enough to look at, really'), { at: 0 });
        expect(recoverTakeFile(file)).toBeNull();
        const pcm = encodeTakeHeader({ sampleRate: 48000, channels: 2 }, 0);
        pcm[56] = 1; // PCM, not float
        expect(parseTakeHeader(pcm)).toBeNull();
    });
});
