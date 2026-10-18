/**
 * Stem export renders each track's note FX chain (#1345): the chain, the
 * track's own loop length and — in song mode — per-measure loop passes reach
 * the pattern renderer, salted per sampler bank.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultNoteFxChain } from '../../sequencer/noteFx/types';

const renderSynthPattern = vi.fn();
const renderDrumPattern = vi.fn();
const renderSamplerBankPattern = vi.fn();

vi.mock('../patternRenderer', () => ({
    bass2ToSynthParams: (b: unknown) => b,
    renderSynthPattern: (...args: unknown[]) => renderSynthPattern(...args),
    renderDrumPattern: (...args: unknown[]) => renderDrumPattern(...args),
    renderSamplerBankPattern: (...args: unknown[]) => renderSamplerBankPattern(...args),
}));
vi.mock('../audioExport', () => ({
    audioBufferToWav: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })),
}));
vi.mock('../zipStore', () => ({ createZipBlob: vi.fn((entries: unknown) => entries) }));
vi.mock('../../audio/loudness', () => ({
    analyzeLoudness: vi.fn(() => ({ lufs: -14 })),
    normalizeToTarget: vi.fn(() => ({ lufs: -14, gainDb: 0 })),
    DEFAULT_LIMITER_SETTINGS: { ceilingDbtp: -1 },
}));
vi.mock('../../audio/offline/mixBus/mixBus', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../audio/offline/mixBus/mixBus')>();
    return { ...actual, createMixBus: () => Promise.resolve(actual.createJsMixBus()) };
});
vi.mock('../songTimeline', () => ({
    resolveSongTimeline: () => ({
        totalSteps: 32,
        measureCount: 2,
        measureStepCounts: [16, 16],
        sequences: {
            partA: { steps: [] }, partB: { steps: [] }, bass2: { steps: [] }, kick: { steps: [] },
            snare: { steps: [] }, closedHat: { steps: [] }, openHat: { steps: [] },
            sampler: Array.from({ length: 8 }, () => ({ steps: [] })),
        },
    }),
    timelineDurationSeconds: () => 1,
}));

import { exportStemsToZip, type StemExportInput } from '../stemExport';

const SAMPLE_RATE = 44100;
function fakeBuffer(length = SAMPLE_RATE): AudioBuffer {
    const data = [new Float32Array(length), new Float32Array(length)];
    return { length, numberOfChannels: 2, sampleRate: SAMPLE_RATE, duration: 1, getChannelData: (ch: number) => data[ch] } as unknown as AudioBuffer;
}

const originalOfflineAudioContext = globalThis.OfflineAudioContext;

function input(noteFx: StemExportInput['noteFx']): StemExportInput {
    return {
        isTrackAudible: () => true,
        songStructure: [],
        trackStorage: {} as StemExportInput['trackStorage'],
        currentPattern: {} as StemExportInput['currentPattern'],
        tempo: 120,
        stepCount: 16,
        trackLengths: { partA: 12 },
        params: {
            synthA: {}, synthB: {}, bass2: {}, kick: {}, snare: {},
            closedHat: {}, openHat: {}, sampler: Array.from({ length: 8 }, () => ({})),
        } as unknown as StemExportInput['params'],
        noteFx,
    };
}

describe('exportStemsToZip note FX', () => {
    beforeEach(() => {
        globalThis.OfflineAudioContext = vi.fn().mockImplementation(function (channels: number, length: number) {
            return { createBuffer: (_ch: number, len: number) => fakeBuffer(len), length, numberOfChannels: channels };
        }) as unknown as typeof OfflineAudioContext;
        renderSynthPattern.mockReset().mockResolvedValue(fakeBuffer());
        renderDrumPattern.mockReset().mockResolvedValue(fakeBuffer());
        renderSamplerBankPattern.mockReset().mockResolvedValue(fakeBuffer());
    });
    afterEach(() => {
        globalThis.OfflineAudioContext = originalOfflineAudioContext;
    });

    it('passes active chains with the track loop length; inactive tracks get none', async () => {
        const arp = defaultNoteFxChain(9);
        arp.arp.enabled = true;
        await exportStemsToZip(input({ partA: arp, partB: defaultNoteFxChain(3) }), { sampleRate: SAMPLE_RATE, useSongMode: false });
        const [partA, partB, bass2] = renderSynthPattern.mock.calls.map((c) => (c[1] as { noteFx?: unknown }).noteFx);
        expect(partA).toMatchObject({ chain: arp, loopLength: 12, passStarts: undefined });
        expect(partB).toBeUndefined();
        expect(bass2).toBeUndefined();
    });

    it('re-anchors loop passes at each measure in song mode and salts sampler banks', async () => {
        const ratchet = defaultNoteFxChain(5);
        ratchet.ratchet = { enabled: true, count: 2, decay: 1, gate: 1 };
        await exportStemsToZip(input({ partA: ratchet, sampler: ratchet }), { sampleRate: SAMPLE_RATE, useSongMode: true });
        const partA = (renderSynthPattern.mock.calls[0][1] as { noteFx: { passStarts: number[] } }).noteFx;
        expect(partA.passStarts).toEqual([0, 12, 16, 28]);
        const salts = renderSamplerBankPattern.mock.calls.map((c) => (c[6] as { salt: number }).salt);
        expect(salts).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });
});
