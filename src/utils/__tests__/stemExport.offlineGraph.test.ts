import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Sample-rate policy and master-bus routing in the stem export (#1233).
 *
 * Renderers, encoder and ZIP writer are mocked; what is under test is the rate
 * every stem is rendered at and whether the master stem went through the shared
 * offline patch-bay compiler.
 */

const renderSynthPattern = vi.fn();
const renderDrumPattern = vi.fn();
const renderSamplerBankPattern = vi.fn();

vi.mock('../patternRenderer', () => ({
    bass2ToSynthParams: (b: unknown) => b,
    renderSynthPattern: (...args: unknown[]): unknown => renderSynthPattern(...args),
    renderDrumPattern: (...args: unknown[]): unknown => renderDrumPattern(...args),
    renderSamplerBankPattern: (...args: unknown[]): unknown => renderSamplerBankPattern(...args),
}));

vi.mock('../audioExport', () => ({
    audioBufferToWav: vi.fn(() =>
        Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
    ),
}));

const zipEntries = vi.fn();
vi.mock('../zipStore', () => ({
    createZipBlob: vi.fn((entries: { path: string; data: Uint8Array }[]) => {
        zipEntries(entries);
        return entries;
    }),
}));

vi.mock('../../audio/loudness', () => ({
    analyzeLoudness: vi.fn(() => ({ integrated: -14 })),
    normalizeToTarget: vi.fn(() => ({ integrated: -14 })),
    DEFAULT_LIMITER_SETTINGS: { ceilingDbtp: -1 },
}));

const bounceBuffersThroughOfflineGraph = vi.fn();
vi.mock('../../audio/offline/compileOfflineGraph', () => ({
    bounceBuffersThroughOfflineGraph: (...args: unknown[]): unknown =>
        bounceBuffersThroughOfflineGraph(...args),
}));

vi.mock('../songTimeline', () => ({
    resolveSongTimeline: () => ({
        totalSteps: 32,
        measureCount: 1,
        sequences: {
            partA: { steps: [] },
            partB: { steps: [] },
            bass2: { steps: [] },
            kick: { steps: [] },
            snare: { steps: [] },
            closedHat: { steps: [] },
            openHat: { steps: [] },
            sampler: Array.from({ length: 8 }, () => ({ steps: [] })),
        },
    }),
    timelineDurationSeconds: () => 1,
}));

import { exportStemsToZip, type StemExportInput } from '../stemExport';
import { SAMPLE_RATE_STORAGE_KEY, recordLiveSampleRate } from '../audioContextPolicy';

function fakeBuffer(length: number, sampleRate: number): AudioBuffer {
    const data = [new Float32Array(length), new Float32Array(length)];
    return {
        length,
        numberOfChannels: 2,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (ch: number) => data[ch],
    } as unknown as AudioBuffer;
}

const originalOfflineAudioContext = globalThis.OfflineAudioContext;

function stubOfflineAudioContext(): void {
    globalThis.OfflineAudioContext = vi.fn().mockImplementation(
        (channels: number, length: number, sampleRate: number) => ({
            createBuffer: (ch: number, len: number, rate: number) => fakeBuffer(len, rate),
            length,
            sampleRate,
            numberOfChannels: channels,
        }),
    ) as unknown as typeof OfflineAudioContext;
}

function makeInput(): StemExportInput {
    return {
        isTrackAudible: () => true,
        songStructure: [],
        trackStorage: {} as StemExportInput['trackStorage'],
        currentPattern: {} as StemExportInput['currentPattern'],
        tempo: 120,
        params: {
            synthA: {}, synthB: {}, bass2: {}, kick: {}, snare: {},
            closedHat: {}, openHat: {}, sampler: Array.from({ length: 8 }, () => ({})),
        } as unknown as StemExportInput['params'],
    };
}

/** metadata.json as the ZIP writer received it. */
function writtenMetadata(): Record<string, unknown> {
    const entries = zipEntries.mock.calls.at(-1)?.[0] as { path: string; data: Uint8Array }[];
    const meta = entries.find((entry) => entry.path === 'metadata.json');
    return JSON.parse(new TextDecoder().decode(meta!.data)) as Record<string, unknown>;
}

describe('exportStemsToZip sample rate + master routing', () => {
    beforeEach(() => {
        localStorage.clear();
        stubOfflineAudioContext();
        zipEntries.mockClear();
        renderSynthPattern.mockReset().mockImplementation(
            (_params: unknown, options: { sampleRate: number }) =>
                Promise.resolve(fakeBuffer(options.sampleRate, options.sampleRate)),
        );
        renderDrumPattern.mockReset().mockImplementation(
            (_type: unknown, _params: unknown, options: { sampleRate: number }) =>
                Promise.resolve(fakeBuffer(options.sampleRate, options.sampleRate)),
        );
        renderSamplerBankPattern.mockReset().mockImplementation(
            (
                _seq: unknown,
                _buf: unknown,
                _params: unknown,
                _tempo: number,
                sampleRate: number,
            ) => Promise.resolve(fakeBuffer(sampleRate, sampleRate)),
        );
        bounceBuffersThroughOfflineGraph.mockReset().mockImplementation(
            (options: { durationSeconds: number; sampleRate: number }) =>
                Promise.resolve({
                    buffer: fakeBuffer(
                        Math.ceil(options.durationSeconds * options.sampleRate),
                        options.sampleRate,
                    ),
                    report: {
                        sampleRate: options.sampleRate,
                        sampleRatePref: 'native',
                        liveSampleRate: options.sampleRate,
                        patchId: 'classic-electribe',
                        patchName: 'Classic Electribe',
                        slots: [],
                        loudness: null,
                    },
                }),
        );
    });

    afterEach(() => {
        globalThis.OfflineAudioContext = originalOfflineAudioContext;
    });

    it('renders at the live rate when the policy says native', async () => {
        await exportStemsToZip(makeInput(), {
            sampleRatePref: 'native',
            liveSampleRate: 48000,
        });

        const options = renderSynthPattern.mock.calls[0][1] as { sampleRate: number };
        expect(options.sampleRate).toBe(48000);
        expect(writtenMetadata().sampleRate).toBe(48000);
    });

    it('resolves a stored native policy to the last live context rate, not 44100', async () => {
        localStorage.setItem(SAMPLE_RATE_STORAGE_KEY, 'native');
        recordLiveSampleRate(96000);
        try {
            await exportStemsToZip(makeInput());
        } finally {
            recordLiveSampleRate(null);
        }

        const options = renderSynthPattern.mock.calls[0][1] as { sampleRate: number };
        expect(options.sampleRate).toBe(96000);
        expect(writtenMetadata().sampleRate).toBe(96000);
    });

    it('falls back to the stored policy when the caller passes none', async () => {
        localStorage.setItem(SAMPLE_RATE_STORAGE_KEY, '48000');
        await exportStemsToZip(makeInput());

        expect(writtenMetadata().sampleRate).toBe(48000);
    });

    it('lets an explicit rate override the policy', async () => {
        await exportStemsToZip(makeInput(), {
            sampleRate: 44100,
            sampleRatePref: 'native',
            liveSampleRate: 48000,
        });

        expect(writtenMetadata().sampleRate).toBe(44100);
    });

    it('keeps the dry-exclusive master by default — no offline graph built', async () => {
        await exportStemsToZip(makeInput(), { sampleRate: 44100 });

        expect(bounceBuffersThroughOfflineGraph).not.toHaveBeenCalled();
        const metadata = writtenMetadata();
        expect(metadata.routing).toBe('dry-exclusive');
        expect(metadata.offlineGraph).toBeNull();
    });

    it('bounces the master through the live patch when asked', async () => {
        const onReport = vi.fn();
        await exportStemsToZip(makeInput(), {
            sampleRate: 44100,
            masterChain: 'live-patch',
            onReport,
        });

        expect(bounceBuffersThroughOfflineGraph).toHaveBeenCalledTimes(1);
        const options = bounceBuffersThroughOfflineGraph.mock.calls[0][0] as {
            sampleRate: number;
            buffers: AudioBuffer[];
        };
        expect(options.sampleRate).toBe(44100);
        expect(options.buffers).toHaveLength(1);

        const metadata = writtenMetadata();
        expect(metadata.routing).toBe('live-patch');
        expect(metadata.offlineGraph).toMatchObject({ patchId: 'classic-electribe' });

        // The UI is told what the bounce did rather than having to open the ZIP.
        expect(onReport).toHaveBeenCalledWith(
            expect.objectContaining({ routing: 'live-patch', sampleRate: 44100 }),
        );
    });

    it('falls back to the dry sum — and says so — when the patch bounce fails', async () => {
        bounceBuffersThroughOfflineGraph.mockRejectedValueOnce(new Error('no OfflineAudioContext'));

        await exportStemsToZip(makeInput(), {
            sampleRate: 44100,
            masterChain: 'live-patch',
        });

        const metadata = writtenMetadata();
        expect(metadata.routing).toBe('dry-exclusive-fallback');
        expect(String(metadata.routingNote)).toContain('no OfflineAudioContext');
    });
});
