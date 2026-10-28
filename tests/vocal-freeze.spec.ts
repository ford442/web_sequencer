import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { initializeHyphonAudio } from './helpers/boot';
import { parseWav } from '../src/agent/audioMetrics';

/**
 * V2 vocal freeze (#1273 Part C): a stretch-mode bank bounces through the
 * offline Rubber Band host, with the vowel crossfade, instead of a dry
 * varispeed copy of the phrase.
 *
 * Load a phrase into bank 1 (the sampler panel's file-picker path), enable
 * vowel samples on long notes, freeze the sampler track (the export modal's
 * stem render) and check the bounce. Through `window.__HYPHON_AGENT__`, the
 * same functions the UI calls. Phoneme timing / pitch parity with live is
 * measured on the real wasm in src/__tests__/vocalFreezeParity.integration.test.ts.
 */

const SONG = {
    meta: { title: 'Vocal freeze', author: 'e2e', version: '1.0', createdAt: '2026-10-27T00:00:00Z', prompt: 'e2e prompt', generator: 'e2e', tags: ['e2e'] },
    globals: { tempo: 120 },
    tracks: {
        sampler: [{
            bankIndex: 0,
            // One long G4 (16 steps = 2 s at 120 BPM): past the 500 ms gate.
            steps: [{ step: 0, note: 'G4', velocity: 1, length: 16 }],
            params: { mode: 'stretch', useVowelSamplesOnLongNotes: true, volume: 1 },
        }],
    },
};

/** The committed "ah" as the phrase: a sung vowel the aligner can segment. */
const PHRASE = readFileSync('public/assets/vowels/ah.wav').toString('base64');

function rms(channel: Float32Array): number {
    let sum = 0;
    for (const v of channel) sum += v * v;
    return Math.sqrt(sum / Math.max(1, channel.length));
}

test('freezing a stretch bank with vowel samples bounces a non-silent Rubber Band render', async ({ page, browserName }) => {
    test.setTimeout(240_000);
    await initializeHyphonAudio(page);
    await page.waitForFunction(() => window.__HYPHON_AGENT__?.version === 1, undefined, { timeout: 90_000 });

    const result = await page.evaluate(async ([song, phrase]) => {
        const agent = window.__HYPHON_AGENT__!;
        const imported = await agent.importAISong(song);
        if (!imported.ok) throw new Error(imported.errors.join('; '));
        const loaded = await agent.loadSamplerPhrase(phrase);
        const mix = await agent.renderMix({ stems: true });
        return {
            loaded,
            stems: mix.files.map((f) => f.path),
            bank: mix.files.find((f) => f.path === 'stems/sampler-bank-1.wav')?.base64 ?? null,
            vocalOffline: mix.metadata.vocalOffline as { bank: number; unsupportedReason?: string }[],
            issues: mix.engineIssues.map((i) => `${i.id}: ${i.reason}`),
        };
    }, [SONG, PHRASE] as const);

    expect(result.loaded.bank).toBe(0);
    // The committed pack loads: no "vowel samples off" issue in the HUD.
    expect(result.issues.filter((i) => i.startsWith('vowel-samples'))).toEqual([]);

    if (browserName === 'webkit') {
        // The live engine skips the Rubber Band worklet on WebKit; the freeze
        // says so and leaves the stem out rather than shipping dry TTS.
        expect(result.bank).toBeNull();
        expect(result.vocalOffline).toEqual([expect.objectContaining({ bank: 0, unsupportedReason: expect.stringMatching(/WebKit/) })]);
        return;
    }

    expect(result.vocalOffline, JSON.stringify(result.vocalOffline)).toEqual([]);
    expect(result.bank, `stems: ${result.stems.join(', ')}`).not.toBeNull();
    const wav = parseWav(new Uint8Array(Buffer.from(result.bank!, 'base64')));
    // The held note: 0.25–1.75 s of the 2 s G4, TTS then the vowel loop.
    const held = wav.channels[0].subarray(Math.floor(0.25 * wav.sampleRate), Math.floor(1.75 * wav.sampleRate));
    expect(rms(held)).toBeGreaterThan(1e-3);
});
