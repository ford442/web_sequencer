import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TrackKey } from '../../constants/appDefaults';

/**
 * Mute / solo in the WAV (stem) export path.
 *
 * The renderers, encoder and ZIP writer are mocked out: what is under test is
 * which tracks `exportStemsToZip` renders and which it replaces with silence.
 */

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

vi.mock('../zipStore', () => ({
    createZipBlob: vi.fn((entries: unknown) => entries),
}));

vi.mock('../../audio/loudness', () => ({
    analyzeLoudness: vi.fn(() => ({ lufs: -14 })),
    normalizeToTarget: vi.fn(() => ({ lufs: -14, gainDb: 0 })),
    DEFAULT_LIMITER_SETTINGS: { ceilingDbtp: -1 },
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
import { trackMuteSoloStore } from '../../stores/trackMuteSoloStore';

const SAMPLE_RATE = 44100;
const LENGTH = SAMPLE_RATE;

/** Minimal stand-in for an AudioBuffer of `length` frames filled with `value`. */
function fakeBuffer(value: number, length = LENGTH, channels = 2): AudioBuffer {
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

function stubOfflineAudioContext(): void {
    globalThis.OfflineAudioContext = vi.fn().mockImplementation(
        (channels: number, length: number, sampleRate: number) => ({
            createBuffer: (ch: number, len: number, rate: number) => fakeBuffer(0, len, ch),
            length,
            sampleRate,
            numberOfChannels: channels,
        }),
    ) as unknown as typeof OfflineAudioContext;
}

function makeInput(isTrackAudible?: (t: TrackKey) => boolean): StemExportInput {
    return {
        isTrackAudible,
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

/** Peak absolute sample across a buffer's channels. */
function peak(buffer: AudioBuffer): number {
    let max = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        for (const v of buffer.getChannelData(ch)) max = Math.max(max, Math.abs(v));
    }
    return max;
}

describe('exportStemsToZip mute/solo', () => {
    beforeEach(() => {
        trackMuteSoloStore.reset();
        stubOfflineAudioContext();
        renderSynthPattern.mockReset().mockResolvedValue(fakeBuffer(0.5));
        renderDrumPattern.mockReset().mockResolvedValue(fakeBuffer(0.5));
        renderSamplerBankPattern.mockReset().mockResolvedValue(fakeBuffer(0.5));
    });

    afterEach(() => {
        globalThis.OfflineAudioContext = originalOfflineAudioContext;
        trackMuteSoloStore.reset();
    });

    it('renders every track when nothing is muted or soloed', async () => {
        await exportStemsToZip(makeInput(), { sampleRate: SAMPLE_RATE });

        expect(renderSynthPattern).toHaveBeenCalledTimes(3); // partA, partB, bass2
        expect(renderDrumPattern).toHaveBeenCalledTimes(4);
        expect(renderSamplerBankPattern).toHaveBeenCalledTimes(8);
    });

    it('skips a muted track and writes silence in its place', async () => {
        trackMuteSoloStore.toggleMute('partA');

        await exportStemsToZip(makeInput(), { sampleRate: SAMPLE_RATE });

        // partB and bass2 still render; partA does not.
        expect(renderSynthPattern).toHaveBeenCalledTimes(2);
        expect(renderDrumPattern).toHaveBeenCalledTimes(4);
    });

    it('gates each drum track individually inside the drum stem', async () => {
        trackMuteSoloStore.toggleMute('kick');
        trackMuteSoloStore.toggleMute('openHat');

        await exportStemsToZip(makeInput(), { sampleRate: SAMPLE_RATE });

        const rendered = renderDrumPattern.mock.calls.map((c) => c[0]);
        expect(rendered).toEqual(['snare', 'closedHat']);
    });

    it('renders only the soloed track', async () => {
        trackMuteSoloStore.toggleSolo('bass2');

        await exportStemsToZip(makeInput(), { sampleRate: SAMPLE_RATE });

        expect(renderSynthPattern).toHaveBeenCalledTimes(1);
        expect(renderDrumPattern).not.toHaveBeenCalled();
        expect(renderSamplerBankPattern).not.toHaveBeenCalled();
    });

    it('renders a track that is both muted and soloed', async () => {
        trackMuteSoloStore.toggleMute('partA');
        trackMuteSoloStore.toggleSolo('partA');

        await exportStemsToZip(makeInput(), { sampleRate: SAMPLE_RATE });

        expect(renderSynthPattern).toHaveBeenCalledTimes(1);
    });

    it('takes an explicit audibility snapshot over the live store', async () => {
        trackMuteSoloStore.toggleMute('partA');

        await exportStemsToZip(makeInput(() => true), { sampleRate: SAMPLE_RATE });

        expect(renderSynthPattern).toHaveBeenCalledTimes(3);
    });

    it('silences the sampler stems when the sampler track is muted', async () => {
        trackMuteSoloStore.toggleMute('sampler');

        await exportStemsToZip(makeInput(), { sampleRate: SAMPLE_RATE });

        expect(renderSamplerBankPattern).not.toHaveBeenCalled();
    });

    it('leaves the master stem silent when every track is silenced', async () => {
        const { createZipBlob } = await import('../zipStore');
        (['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler'] as TrackKey[])
            .forEach((t) => trackMuteSoloStore.toggleMute(t));

        await exportStemsToZip(makeInput(), { sampleRate: SAMPLE_RATE });

        expect(renderSynthPattern).not.toHaveBeenCalled();
        expect(renderDrumPattern).not.toHaveBeenCalled();
        expect(renderSamplerBankPattern).not.toHaveBeenCalled();

        // The ZIP still carries the full stem set — silenced, not omitted.
        const entries = vi.mocked(createZipBlob).mock.calls.at(-1)?.[0] as {
            path: string;
            data: Uint8Array;
        }[];
        expect(entries.map((e) => e.path)).toContain('stems/partA.wav');
        expect(entries.map((e) => e.path)).toContain('stems/master.wav');

        const metadata = entries.find((e) => e.path === 'metadata.json')!;
        const parsed = JSON.parse(new TextDecoder().decode(metadata.data)) as {
            silencedTracks: TrackKey[];
        };
        expect(parsed.silencedTracks).toHaveLength(8);
    });

    it('produces a non-silent stem for a track that is rendered', async () => {
        await exportStemsToZip(makeInput(), { sampleRate: SAMPLE_RATE });

        // Sanity check on the fixture: the mocked renderer really does return signal.
        expect(peak(await renderSynthPattern.mock.results[0].value as AudioBuffer)).toBeGreaterThan(0);
    });
});
