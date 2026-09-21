import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AISongData } from '../../importers/ai-song';

/**
 * AI song preview (#1233).
 *
 * The renderers and the offline compiler are mocked: what is under test is that
 * the preview goes through the *one* offline graph at the resolved rate, and
 * that everything it cannot render is reported rather than dropped.
 */

const renderSynthPattern = vi.fn();
const renderDrumPattern = vi.fn();

vi.mock('../patternRenderer', () => ({
    bass2ToSynthParams: (b: unknown) => b,
    renderSynthPattern: (...args: unknown[]) => renderSynthPattern(...args),
    renderDrumPattern: (...args: unknown[]) => renderDrumPattern(...args),
}));

const bounceBuffersThroughOfflineGraph = vi.fn();

vi.mock('../../audio/offline/compileOfflineGraph', () => ({
    bounceBuffersThroughOfflineGraph: (...args: unknown[]) =>
        bounceBuffersThroughOfflineGraph(...args),
}));

import { renderAISongPreview, summarizePreviewSkips, AISongPreviewError } from '../aiSongPreview';

function fakeBuffer(length = 1024, sampleRate = 48000): AudioBuffer {
    return {
        length,
        numberOfChannels: 2,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length),
    } as unknown as AudioBuffer;
}

function song(overrides: Partial<AISongData['tracks']> = {}): AISongData {
    return {
        meta: {
            title: 'Test',
            author: 'tester',
            version: '1.0',
            createdAt: '2026-01-01T00:00:00.000Z',
            generator: 'test',
            prompt: 'a test song',
        },
        globals: { tempo: 120 },
        tracks: {
            synthA: { notes: [{ step: 0, note: 'C4' }] },
            kick: Array.from({ length: 32 }, (_, i) => i % 8 === 0),
            ...overrides,
        },
    };
}

describe('renderAISongPreview', () => {
    beforeEach(() => {
        localStorage.clear();
        renderSynthPattern.mockReset().mockResolvedValue(fakeBuffer());
        renderDrumPattern.mockReset().mockResolvedValue(fakeBuffer());
        bounceBuffersThroughOfflineGraph.mockReset().mockImplementation(async () => ({
            buffer: fakeBuffer(),
            report: {
                sampleRate: 48000,
                sampleRatePref: 'native',
                liveSampleRate: 48000,
                patchId: 'classic-electribe',
                patchName: 'Classic Electribe',
                slots: [],
                loudness: null,
            },
        }));
    });

    it('renders the requested bars through the shared offline graph exactly once', async () => {
        const result = await renderAISongPreview(song(), {
            bars: 2,
            sampleRatePref: 'native',
            liveSampleRate: 48000,
        });

        expect(bounceBuffersThroughOfflineGraph).toHaveBeenCalledTimes(1);
        const options = bounceBuffersThroughOfflineGraph.mock.calls[0][0] as {
            sampleRate: number;
            durationSeconds: number;
        };
        expect(options.sampleRate).toBe(48000);
        // 2 bars of 16 steps at 120 BPM = 32 × 0.125 s.
        expect(options.durationSeconds).toBeCloseTo(4, 5);
        expect(result.bars).toBe(2);
        expect(result.sampleRate).toBe(48000);
    });

    it('renders every track at the rate the bounce runs at', async () => {
        await renderAISongPreview(song(), { sampleRatePref: 44100 });

        for (const call of [...renderSynthPattern.mock.calls, ...renderDrumPattern.mock.calls]) {
            const options = call[call.length - 1] as { sampleRate: number };
            expect(options.sampleRate).toBe(44100);
        }
    });

    it('reports tracks with no notes as silent rather than rendering them', async () => {
        await renderAISongPreview(song());

        const silentSlots = renderSynthPattern.mock.calls.length;
        // Only synthA has notes; synthB and bass2 are silent.
        expect(silentSlots).toBe(1);
    });

    it('skips sampler banks loudly — TTS and samples do not exist before import', async () => {
        const result = await renderAISongPreview(
            song({
                sampler: [
                    { bankIndex: 0, steps: [{ step: 0, note: 'C4' }], ttsText: 'hello' },
                    { bankIndex: 1, steps: [], sampleUrl: 'https://example.com/kick.wav' },
                ],
            }),
        );

        expect(result.slots).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    slot: 'sampler-bank-1',
                    status: 'skipped',
                    reason: 'tts-not-rendered',
                }),
                expect.objectContaining({
                    slot: 'sampler-bank-2',
                    status: 'skipped',
                    reason: 'sample-not-loaded',
                }),
            ]),
        );
        expect(summarizePreviewSkips(result)).toContain('2 slots not rendered');
    });

    it('keeps the mix going when one track fails to render', async () => {
        renderSynthPattern.mockRejectedValueOnce(new Error('engine exploded'));

        const result = await renderAISongPreview(song());

        expect(result.slots).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    slot: 'synthA',
                    status: 'skipped',
                    reason: 'render-failed',
                    detail: 'engine exploded',
                }),
            ]),
        );
        expect(bounceBuffersThroughOfflineGraph).toHaveBeenCalledTimes(1);
    });

    it('surfaces unsupported WAM2 inserts from the graph report', async () => {
        bounceBuffersThroughOfflineGraph.mockImplementationOnce(async () => ({
            buffer: fakeBuffer(),
            report: {
                sampleRate: 44100,
                sampleRatePref: 44100,
                liveSampleRate: null,
                patchId: 'classic-electribe',
                patchName: 'Classic Electribe',
                slots: [
                    {
                        nodeId: 'wam2-slot-1',
                        packageId: 'community.reverb',
                        placement: 'masterInsert',
                        offline: 'unsupported',
                        status: 'bypassed',
                        reason: 'offline-unsupported',
                    },
                ],
                loudness: null,
            },
        }));

        const result = await renderAISongPreview(song());
        expect(summarizePreviewSkips(result)).toContain('1 WAM2 insert unsupported offline');
    });

    it('refuses to preview a song the importer cannot convert', async () => {
        const invalid = { meta: {}, globals: {}, tracks: {} } as unknown as AISongData;
        await expect(renderAISongPreview(invalid)).rejects.toBeInstanceOf(AISongPreviewError);
    });
});
