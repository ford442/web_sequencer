import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Audio tracks in the stem export (#1629): each audio track with clips is a
 * stem of its own and part of the master sum. Renderers, encoder and ZIP writer
 * are mocked (the pattern stems are silence); the media store is faked.
 */

type Render = (...args: unknown[]) => Promise<AudioBuffer>;
const renderSynthPattern = vi.fn<Render>();
const renderDrumPattern = vi.fn<Render>();
const renderSamplerBankPattern = vi.fn<Render>();

vi.mock('../patternRenderer', () => ({
    bass2ToSynthParams: (b: unknown) => b,
    renderSynthPattern: (...args: unknown[]) => renderSynthPattern(...args),
    renderDrumPattern: (...args: unknown[]) => renderDrumPattern(...args),
    renderSamplerBankPattern: (...args: unknown[]) => renderSamplerBankPattern(...args),
}));

const encoded: AudioBuffer[] = [];
vi.mock('../audioExport', () => ({
    audioBufferToWav: vi.fn((buffer: AudioBuffer) => {
        encoded.push(buffer);
        return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    }),
}));

const MEDIA = '9'.repeat(64);
vi.mock('../../audio/media/MediaStore', () => ({
    mediaStore: {
        info: (id: string) => Promise.resolve(id === MEDIA ? { id, sampleRate: 44100, channels: 1, frames: 22050 } : null),
        readFrames: () => Promise.resolve([new Float32Array(22050).fill(0.25)]),
    },
}));

vi.mock('../zipStore', () => ({
    createZipBlob: vi.fn((entries: unknown) => entries),
}));

vi.mock('../../audio/loudness', () => ({
    analyzeLoudness: vi.fn(() => ({ lufs: -14 })),
    normalizeToTarget: vi.fn(() => ({ lufs: -14, gainDb: 0 })),
    DEFAULT_LIMITER_SETTINGS: { ceilingDbtp: -1 },
}));

// The happy-dom Worker stub never answers; use the in-thread bus (#1341).
vi.mock('../../audio/offline/mixBus/mixBus', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../audio/offline/mixBus/mixBus')>();
    return { ...actual, createMixBus: () => Promise.resolve(actual.createJsMixBus()) };
});

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
import { trackMuteSoloStore } from '../../stores/trackMuteSoloStore';
import type { Arrangement } from '../../types';

const SAMPLE_RATE = 44100;

function fakeBuffer(value: number, length: number, channels = 2): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length).fill(value));
    return {
        length,
        numberOfChannels: channels,
        sampleRate: SAMPLE_RATE,
        duration: length / SAMPLE_RATE,
        getChannelData: (ch: number) => data[ch],
    } as unknown as AudioBuffer;
}

const originalOfflineAudioContext = globalThis.OfflineAudioContext;

const arrangement: Arrangement = {
    lengthSteps: 8,
    clips: [
        { kind: 'audio', id: 'clip-1', track: 'audio-1', mediaId: MEDIA, startStep: 0, lengthSteps: 8, offsetFrames: 0, gainDb: 0, warp: 'off' },
        { kind: 'audio', id: 'clip-2', track: 'audio-2', mediaId: 'e'.repeat(64), startStep: 0, lengthSteps: 8, offsetFrames: 0, gainDb: 0, warp: 'off' },
    ],
};

function input(): StemExportInput {
    return {
        songStructure: [],
        arrangement,
        audioTracks: {
            tracks: [
                { id: 'audio-1', name: 'Vox', gainDb: 0, pan: 0 },
                { id: 'audio-2', name: 'Missing', gainDb: 0, pan: 0 },
            ],
            media: {},
        },
        trackStorage: {} as StemExportInput['trackStorage'],
        currentPattern: {} as StemExportInput['currentPattern'],
        tempo: 120,
        params: {
            synthA: {}, synthB: {}, bass2: {}, kick: {}, snare: {},
            closedHat: {}, openHat: {}, sampler: Array.from({ length: 8 }, () => ({})),
        } as unknown as StemExportInput['params'],
    };
}

const peak = (buffer: AudioBuffer) => Math.max(...Array.from(buffer.getChannelData(0)).map(Math.abs));

describe('exportStemsToZip audio tracks', () => {
    beforeEach(() => {
        encoded.length = 0;
        trackMuteSoloStore.reset();
        globalThis.OfflineAudioContext = vi.fn().mockImplementation(
            function (channels: number, length: number, sampleRate: number) { return {
                createBuffer: (ch: number, len: number) => fakeBuffer(0, len, ch),
                length, sampleRate, numberOfChannels: channels,
            }; },
        ) as unknown as typeof OfflineAudioContext;
        for (const fn of [renderSynthPattern, renderDrumPattern, renderSamplerBankPattern]) {
            fn.mockReset().mockResolvedValue(fakeBuffer(0, SAMPLE_RATE));
        }
    });

    afterEach(() => {
        globalThis.OfflineAudioContext = originalOfflineAudioContext;
        trackMuteSoloStore.reset();
    });

    it('writes a stem per audio track, before the master, and sums it into the master', async () => {
        const entries = await exportStemsToZip(input(), { sampleRate: SAMPLE_RATE }) as unknown as { path: string; data: Uint8Array }[];
        const paths = entries.map((e) => e.path);
        expect(paths.indexOf('stems/audio-1.wav')).toBeGreaterThan(paths.indexOf('stems/sampler-bank-8.wav'));
        expect(paths.indexOf('stems/audio-1.wav')).toBeLessThan(paths.indexOf('stems/master.wav'));
        const vox = encoded[paths.indexOf('stems/audio-1.wav')];
        const master = encoded[paths.indexOf('stems/master.wav')];
        expect(peak(vox)).toBe(0.25);
        expect(vox.getChannelData(1)[100]).toBe(0.25); // mono media plays on both sides
        expect(peak(master)).toBe(0.25);
        const metadata = JSON.parse(new TextDecoder().decode(entries.find((e) => e.path === 'metadata.json')!.data)) as { missingMedia?: string[] };
        expect(metadata.missingMedia).toEqual(['e'.repeat(64)]);
    });

    it('writes a muted audio track as silence and keeps it out of the master', async () => {
        trackMuteSoloStore.toggleMute('audio-1');
        const entries = await exportStemsToZip(input(), { sampleRate: SAMPLE_RATE }) as unknown as { path: string }[];
        const paths = entries.map((e) => e.path);
        expect(peak(encoded[paths.indexOf('stems/audio-1.wav')])).toBe(0);
        expect(peak(encoded[paths.indexOf('stems/master.wav')])).toBe(0);
    });

    it('exports a pattern-mode song without audio stems', async () => {
        const entries = await exportStemsToZip(input(), { sampleRate: SAMPLE_RATE, useSongMode: false }) as unknown as { path: string }[];
        expect(entries.map((e) => e.path).some((p) => p.includes('audio-'))).toBe(false);
    });
});
