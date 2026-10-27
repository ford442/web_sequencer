import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ConcatenativeHybrid,
    DEFAULT_CONCATENATIVE_CONFIG,
    VowelLibrary,
    crossfadeCurve,
    parseVowelManifest,
    sustainedVowel,
    vowelForPhoneme,
    type VowelSample,
} from '../ConcatenativeHybrid';
import type { AlignmentResult } from '../alignment/types';

const SR = 48000;

function sample(vowel: VowelSample['vowel'], midiNote: number, sampleRate = SR): VowelSample {
    const audio = new Float32Array(sampleRate).map((_, i) => Math.sin((2 * Math.PI * 262 * i) / sampleRate));
    return { vowel, midiNote, audio, sampleRate, loopStart: Math.round(0.15 * sampleRate), loopEnd: Math.round(0.65 * sampleRate) };
}

function hybridWith(...samples: VowelSample[]): ConcatenativeHybrid {
    const library = new VowelLibrary();
    samples.forEach((s) => library.addSample(s));
    return new ConcatenativeHybrid({ sampleRate: samples[0]?.sampleRate ?? SR }, library);
}

const ALIGNED_LAH: AlignmentResult = {
    phonemes: [
        { phoneme: 'L', start: 0, end: 0.1, isVowel: false },
        { phoneme: 'AA1', start: 0.1, end: 0.5, isVowel: true },
    ],
    sampleRate: SR,
    duration: 0.5,
    text: 'lah',
};

describe('duration gate', () => {
    const hybrid = hybridWith(sample('ah', 60));

    it('keeps notes shorter than minNoteDurationMs (500 ms) on TTS', () => {
        expect(DEFAULT_CONCATENATIVE_CONFIG.minNoteDurationMs).toBe(500);
        expect(hybrid.planNote({ durationSec: 0.499, midiNote: 60 })).toBeNull();
        expect(hybrid.shouldUseRealSample(499, 'ah')).toBe(false);
    });

    it('sustains a note of at least 500 ms from the vowel sample', () => {
        const plan = hybrid.planNote({ durationSec: 0.5, midiNote: 60 });
        expect(plan).not.toBeNull();
        expect(plan!.sample.vowel).toBe('ah');
        expect(hybrid.shouldUseRealSample(500, 'AA1')).toBe(true);
    });

    it('takes a per-bank gate over the default', () => {
        expect(hybrid.planNote({ durationSec: 0.3, midiNote: 60, minNoteDurationMs: 250 })).not.toBeNull();
        expect(hybrid.planNote({ durationSec: 0.8, midiNote: 60, minNoteDurationMs: 1000 })).toBeNull();
    });

    it('never treats a consonant as a sustainable vowel', () => {
        expect(hybrid.shouldUseRealSample(2000, 'S')).toBe(false);
    });
});

describe('vowel and sample choice', () => {
    it('maps ARPABET (stress ignored) and pack names to pack vowels', () => {
        expect(vowelForPhoneme('AA1')).toBe('ah');
        expect(vowelForPhoneme('IY')).toBe('ee');
        expect(vowelForPhoneme('uw0')).toBe('oo');
        expect(vowelForPhoneme('oh')).toBe('oh');
        expect(vowelForPhoneme('T')).toBeNull();
    });

    it('sustains the phrase’s last vowel, from where it starts; ah from the top without an alignment', () => {
        expect(sustainedVowel(ALIGNED_LAH)).toEqual({ vowel: 'ah', onset: 0.2 });
        expect(sustainedVowel({ ...ALIGNED_LAH, phonemes: [...ALIGNED_LAH.phonemes, { phoneme: 'IY', start: 0.4, end: 0.5, isVowel: true }] }).vowel).toBe('ee');
        expect(sustainedVowel(null)).toEqual({ vowel: 'ah', onset: 0 });
    });

    it('picks the sample nearest the note', () => {
        const hybrid = hybridWith(sample('ah', 48), sample('ah', 60), sample('ah', 72));
        expect(hybrid.planNote({ durationSec: 1, midiNote: 64 })!.rootMidi).toBe(60);
        expect(hybrid.planNote({ durationSec: 1, midiNote: 70 })!.rootMidi).toBe(72);
    });

    it('stays TTS when the pack has no sample for the vowel', () => {
        const hybrid = hybridWith(sample('oo', 60));
        expect(hybrid.planNote({ durationSec: 1, midiNote: 60, alignment: ALIGNED_LAH })).toBeNull();
    });
});

describe('plan', () => {
    it('crossfades inside the sustained vowel and keeps the loop stretch at most 2x', () => {
        const hybrid = hybridWith(sample('ah', 60));
        const plan = hybrid.planNote({ durationSec: 2, midiNote: 67, alignment: ALIGNED_LAH })!;
        // onset 0.2 of 2 s, plus one 50 ms crossfade length.
        expect(plan.crossfadeStart).toBeCloseTo(0.45, 6);
        expect(plan.crossfadeDuration).toBe(0.05);
        expect(plan.curve).toBe('cosine');
        expect(plan.playDuration).toBe(2);
        expect(plan.timeRatio).toBeLessThanOrEqual(2);
        expect(plan.timeRatio * (plan.buffer.length / SR)).toBeCloseTo(2, 6);
        const loop = plan.sample.loopEnd - plan.sample.loopStart;
        expect(plan.buffer.length % loop).toBe(0);
        expect(plan.buffer[loop]).toBe(plan.buffer[0]);
    });

    it('reuses the tiled buffer for the same repeat count', () => {
        const hybrid = hybridWith(sample('ah', 60));
        const a = hybrid.planNote({ durationSec: 1.5, midiNote: 60 })!;
        const b = hybrid.planNote({ durationSec: 1.6, midiNote: 62 })!;
        expect(b.buffer).toBe(a.buffer);
        expect(b.bufferKey).toBe(a.bufferKey);
    });

    it('refuses a sample at another rate than the context: sampleRate follows the context', () => {
        const library = new VowelLibrary();
        library.addSample(sample('ah', 60, 48000));
        const hybrid = new ConcatenativeHybrid({ sampleRate: 44100 }, library);
        expect(() => hybrid.planNote({ durationSec: 1, midiNote: 60 })).toThrow(/48000 Hz but the plan is at 44100 Hz/);
    });

    it('crossfades over the configured length at the context rate', () => {
        for (const rate of [44100, 48000]) {
            const hybrid = new ConcatenativeHybrid({ sampleRate: rate });
            const out = hybrid.generateCrossfade(new Float32Array(rate).fill(1), new Float32Array(rate).fill(0));
            const fade = Math.floor(0.05 * rate);
            expect(out[0]).toBe(1);
            expect(out[fade]).toBe(0);
            expect(out[Math.floor(fade / 2)]).toBeCloseTo(0.5, 2);
        }
    });
});

describe('crossfadeCurve', () => {
    it('runs 0 → 1 in and 1 → 0 out, cosine-shaped', () => {
        const fadeIn = crossfadeCurve('cosine', 65, 'in');
        const fadeOut = crossfadeCurve('cosine', 65, 'out');
        expect(fadeIn[0]).toBe(0);
        expect(fadeIn[64]).toBeCloseTo(1, 9);
        expect(fadeIn[32]).toBeCloseTo(0.5, 9);
        expect(fadeIn[16]).toBeLessThan(0.25); // slow start: cosine, not linear
        fadeIn.forEach((v, i) => expect(v + fadeOut[i]).toBeCloseTo(1, 6));
    });
});

describe('VowelLibrary.loadFromUrl', () => {
    afterEach(() => vi.unstubAllGlobals());

    const decode = vi.fn((bytes: ArrayBuffer) => Promise.resolve({ data: new Float32Array(bytes.byteLength / 2), sampleRate: 44100 }));

    it('disables the pack with a reason when manifest.json is missing (404)', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 404 }))));
        const library = new VowelLibrary();
        const status = await library.loadFromUrl('assets/vowels/', decode);
        expect(status.state).toBe('disabled');
        expect((status as { reason: string }).reason).toContain('assets/vowels/manifest.json not found (HTTP 404)');
        expect(library.getStatus()).toBe(status);
        expect(library.size()).toBe(0);
    });

    it('does not parse the SPA index.html as the manifest', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<!doctype html><html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        }))));
        const status = await new VowelLibrary().loadFromUrl('assets/vowels/', decode);
        expect(status.state).toBe('disabled');
        expect((status as { reason: string }).reason).toMatch(/HTML page/);
        expect(decode).not.toHaveBeenCalled();
    });

    it('loads the committed pack and scales loop points to the decode rate', async () => {
        const dir = join(process.cwd(), 'public/assets/vowels');
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            const file = url.split('/').pop()!;
            const body = readFileSync(join(dir, file));
            return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'audio/wav' } }));
        }));
        const library = new VowelLibrary();
        const status = await library.loadFromUrl('assets/vowels', decode);
        expect(status).toEqual({ state: 'ready', count: 7 });
        expect(library.getAvailableVowels().sort()).toEqual(['ah', 'ee', 'eh', 'ih', 'oh', 'oo', 'uh']);
        const manifest = parseVowelManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
        const ah = library.getSample('ah', 60)!;
        expect(ah.sampleRate).toBe(44100);
        expect(ah.loopStart).toBe(Math.round(manifest.samples[0].loopStart * 44100 / manifest.sampleRate));
    });
});

describe('VowelLibrary.withSampleRate', () => {
    it('resamples to the render rate and keeps the original untouched', async () => {
        const library = new VowelLibrary();
        library.addSample(sample('ah', 60, 44100));
        const resample = vi.fn((data: Float32Array, from: number, to: number) => Promise.resolve(new Float32Array(Math.round(data.length * to / from))));
        const at48 = await library.withSampleRate(48000, resample);
        expect(resample).toHaveBeenCalledWith(expect.any(Float32Array), 44100, 48000);
        const s = at48.getSample('ah', 60)!;
        expect(s.sampleRate).toBe(48000);
        expect(s.audio.length).toBe(48000);
        expect(s.loopStart).toBe(Math.round(Math.round(0.15 * 44100) * 48000 / 44100));
        expect(library.getSample('ah', 60)!.sampleRate).toBe(44100);
        expect(await library.withSampleRate(44100, resample)).toBe(library);
    });
});

describe('parseVowelManifest', () => {
    it('rejects a manifest with bad loop points or vowels', () => {
        const base = { version: 1, sampleRate: 48000, samples: [{ vowel: 'ah', file: 'ah.wav', midiNote: 60, loopStart: 10, loopEnd: 100 }] };
        expect(parseVowelManifest(base).samples).toHaveLength(1);
        expect(() => parseVowelManifest({ ...base, samples: [{ ...base.samples[0], loopEnd: 5 }] })).toThrow(/loop points/);
        expect(() => parseVowelManifest({ ...base, samples: [{ ...base.samples[0], vowel: 'aw' }] })).toThrow(/unknown vowel/);
        expect(() => parseVowelManifest({ ...base, version: 2 })).toThrow(/version/);
    });
});
