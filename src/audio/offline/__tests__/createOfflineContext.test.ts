import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
    createOfflineBuffer,
    createOfflineContext,
    resolveOfflineLength,
    resolveOfflineSpec,
} from '../createOfflineContext';
import { recordLiveSampleRate, SAMPLE_RATE_STORAGE_KEY } from '../../../utils/audioContextPolicy';

const original = globalThis.OfflineAudioContext;

describe('createOfflineContext', () => {
    let ctor: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        ctor = vi.fn().mockImplementation(function (this: Record<string, unknown>, channels: number, length: number, sampleRate: number) {
            this.channels = channels;
            this.length = length;
            this.sampleRate = sampleRate;
            this.createBuffer = (c: number, l: number, sr: number) => ({ numberOfChannels: c, length: l, sampleRate: sr });
        });
        globalThis.OfflineAudioContext = ctor as unknown as typeof OfflineAudioContext;
    });

    afterEach(() => {
        globalThis.OfflineAudioContext = original;
        localStorage.removeItem(SAMPLE_RATE_STORAGE_KEY);
        recordLiveSampleRate(null);
    });

    it('rounds a duration up to whole frames', () => {
        createOfflineContext({ channels: 2, durationSeconds: 1.00001, sampleRate: 44100 });
        expect(ctor).toHaveBeenCalledWith(2, 44101, 44100);
        expect(resolveOfflineLength({ length: 10.2 }, 48000)).toBe(11);
    });

    it('never asks for a zero-length context', () => {
        createOfflineContext({ durationSeconds: 0, sampleRate: 48000 });
        expect(ctor).toHaveBeenCalledWith(2, 1, 48000);
        expect(resolveOfflineLength({ length: 0 }, 48000)).toBe(1);
    });

    it('defaults to stereo and clamps the channel count', () => {
        expect(resolveOfflineSpec({ length: 8, sampleRate: 44100 }).channels).toBe(2);
        expect(resolveOfflineSpec({ length: 8, sampleRate: 44100, channels: 0 }).channels).toBe(1);
        expect(resolveOfflineSpec({ length: 8, sampleRate: 44100, channels: 99 }).channels).toBe(32);
    });

    it('takes an explicit rate verbatim and otherwise follows the export policy', () => {
        expect(resolveOfflineSpec({ length: 1, sampleRate: 22050 }).sampleRate).toBe(22050);

        localStorage.setItem(SAMPLE_RATE_STORAGE_KEY, '48000');
        expect(resolveOfflineSpec({ length: 1 }).sampleRate).toBe(48000);

        localStorage.setItem(SAMPLE_RATE_STORAGE_KEY, 'native');
        recordLiveSampleRate(96000);
        expect(resolveOfflineSpec({ length: 1 }).sampleRate).toBe(96000);
        // null = "no live context": native falls back to the export default.
        expect(resolveOfflineSpec({ length: 1, liveSampleRate: null }).sampleRate).toBe(44100);
    });

    it('rejects a missing length and an invalid rate', () => {
        expect(() => resolveOfflineSpec({ sampleRate: 44100 })).toThrow(/finite length/);
        expect(() => resolveOfflineSpec({ length: 4, sampleRate: 0 })).toThrow(/invalid offline sample rate/);
    });

    it('throws a clear error where OfflineAudioContext does not exist', () => {
        // @ts-expect-error -- simulating an environment without Web Audio
        delete globalThis.OfflineAudioContext;
        expect(() => createOfflineContext({ length: 4, sampleRate: 44100 })).toThrow(/not available/);
    });

    it('createOfflineBuffer shapes the buffer like the spec', () => {
        const buffer = createOfflineBuffer({ channels: 1, length: 0, sampleRate: 48000 });
        expect(buffer).toEqual({ numberOfChannels: 1, length: 1, sampleRate: 48000 });
    });
});

describe('OfflineAudioContext construction', () => {
    const SRC = resolve(__dirname, '../../..');
    const FACTORY = 'audio/offline/createOfflineContext.ts';

    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === '__tests__' || entry.name.startsWith('.')) continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full, out);
            else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
        }
        return out;
    }

    it('goes through createOfflineContext everywhere outside tests', () => {
        const offenders = walk(SRC)
            .filter((file) => relative(SRC, file) !== FACTORY)
            .filter((file) => /new\s+(?:\(?\s*(?:window|globalThis|self)\s*(?:as\s+[^)]*)?\)?\s*\.\s*)?(?:webkit)?OfflineAudioContext\s*\(/.test(readFileSync(file, 'utf8')))
            .map((file) => relative(SRC, file));
        expect(offenders).toEqual([]);
    });
});
