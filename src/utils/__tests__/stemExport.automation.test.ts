/**
 * Stem export plays the song's automation lanes (#1384): each synth stem gets
 * its lanes resolved onto the export timeline, and every routed lane the stems
 * cannot play is written to metadata.json and the export report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedAutomationLane } from '../../types';
import { automationStore } from '../../stores/automationStore';
import type { PatternAutomation } from '../../audio/offline/offlineLaneAutomation';
import { createArrangement, placeClip } from '../../arrangement/model';

type RenderFn = (...args: unknown[]) => Promise<unknown>;
const renderSynthPattern = vi.fn<RenderFn>();
const renderDrumPattern = vi.fn<RenderFn>();
const renderSamplerBankPattern = vi.fn<RenderFn>();

vi.mock('../patternRenderer', () => ({
    bass2ToSynthParams: (b: unknown) => b,
    renderSynthPattern: (...args: unknown[]) => renderSynthPattern(...args),
    renderDrumPattern: (...args: unknown[]) => renderDrumPattern(...args),
    renderSamplerBankPattern: (...args: unknown[]) => renderSamplerBankPattern(...args),
}));
vi.mock('../audioExport', () => ({
    audioBufferToWav: vi.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })),
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

import { exportStemsToZip, renderStemFiles, type StemExportInput } from '../stemExport';

const SAMPLE_RATE = 44100;
function fakeBuffer(length = SAMPLE_RATE): AudioBuffer {
    const data = [new Float32Array(length), new Float32Array(length)];
    return { length, numberOfChannels: 2, sampleRate: SAMPLE_RATE, duration: 1, getChannelData: (ch: number) => data[ch] } as unknown as AudioBuffer;
}

const originalOfflineAudioContext = globalThis.OfflineAudioContext;

function lane(overrides: Partial<UnifiedAutomationLane>): UnifiedAutomationLane {
    return {
        id: 'l', target: 'synthA', parameter: 'filterCutoff', name: 'lane',
        points: [{ step: 0, value: 0 }, { step: 15, value: 1 }],
        interpolation: 'linear', source: 'ai', scope: 'song', enabled: true,
        ...overrides,
    };
}

function input(automationLanes?: UnifiedAutomationLane[]): StemExportInput {
    return {
        isTrackAudible: () => true,
        songStructure: [],
        trackStorage: {} as StemExportInput['trackStorage'],
        currentPattern: {} as StemExportInput['currentPattern'],
        tempo: 120,
        stepCount: 16,
        params: {
            synthA: { waveform: '303-saw' }, synthB: { waveform: 'sawtooth' }, bass2: { waveform: '303-sqr' },
            kick: {}, snare: {}, closedHat: {}, openHat: {}, sampler: Array.from({ length: 8 }, () => ({})),
        } as unknown as StemExportInput['params'],
        noteFx: {},
        automationLanes,
    };
}

function automationOf(callIndex: number): PatternAutomation | undefined {
    return (renderSynthPattern.mock.calls[callIndex][1] as { automation?: PatternAutomation }).automation;
}

describe('exportStemsToZip automation lanes', () => {
    beforeEach(() => {
        globalThis.OfflineAudioContext = vi.fn().mockImplementation(function (channels: number, length: number) {
            return { createBuffer: (_ch: number, len: number) => fakeBuffer(len), length, numberOfChannels: channels };
        }) as unknown as typeof OfflineAudioContext;
        renderSynthPattern.mockReset().mockResolvedValue(fakeBuffer());
        renderDrumPattern.mockReset().mockResolvedValue(fakeBuffer());
        renderSamplerBankPattern.mockReset().mockResolvedValue(fakeBuffer());
        automationStore.reset();
    });
    afterEach(() => {
        globalThis.OfflineAudioContext = originalOfflineAudioContext;
        automationStore.reset();
    });

    it('hands each synth stem its lanes, per measure, in that voice\'s units', async () => {
        const lanes = [
            lane({}),
            lane({ id: 'b2', target: 'bass2', parameter: 'filterResonance' }),
            lane({ id: 'b2d', target: 'bass2', parameter: 'decay' }),
            // synthB is not on a 303 waveform: live, its decay lane drives nothing.
            lane({ id: 'bd', target: 'synthB', parameter: 'decay' }),
        ];
        await exportStemsToZip(input(lanes), { sampleRate: SAMPLE_RATE, useSongMode: true });

        const partA = automationOf(0)!;
        expect(partA.perStep).toBe(true);
        expect(partA.filterCutoff).toHaveLength(32);
        expect(partA.filterCutoff![15]).toBe(8000);
        // Song-scoped: read at the pattern step every measure, like the wrapped live clock.
        expect(partA.filterCutoff![16 + 7]).toBe(partA.filterCutoff![7]);
        expect(automationOf(1)).toBeUndefined();
        expect(automationOf(2)?.filterResonance?.[15]).toBe(20);
        expect(automationOf(2)?.decay?.[15]).toBe(1);
    });

    it('reports routed lanes the stems cannot play in metadata.json and the report', async () => {
        const onReport = vi.fn();
        const entries = (await exportStemsToZip(
            input([lane({}), lane({ id: 'pcf', target: 'master', parameter: 'pcfCutoff' }), lane({ id: 'v', parameter: 'volume' })]),
            { sampleRate: SAMPLE_RATE, useSongMode: false, onReport },
        )) as unknown as Array<{ path: string; data: Uint8Array }>;

        const report = (onReport.mock.calls[0][0] as { automation: { applied: string[]; notRendered: Array<{ lane: string }> } }).automation;
        expect(report.applied).toEqual(['synthA.filterCutoff']);
        expect(report.notRendered.map((s) => s.lane)).toEqual(['master.pcfCutoff', 'synthA.volume']);

        const metadata = JSON.parse(new TextDecoder().decode(entries.find((e) => e.path === 'metadata.json')!.data)) as { automation: unknown };
        expect(metadata.automation).toEqual(report);
    });

    it('hands the same files and report back unzipped (the agent render hook, #1386)', async () => {
        const onReport = vi.fn();
        const { entries, report } = await renderStemFiles(input([lane({})]), { sampleRate: SAMPLE_RATE, useSongMode: false, onReport });
        expect(report).toBe(onReport.mock.calls[0][0]);
        expect(entries.map((e) => e.path)).toContain('stems/master.wav');
        expect(entries[entries.length - 1].path).toBe('metadata.json');
        const zipped = (await exportStemsToZip(input([lane({})]), { sampleRate: SAMPLE_RATE, useSongMode: false })) as unknown as typeof entries;
        expect(zipped.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    });

    it('defaults to the live store, and to no lanes while automation playback is off', async () => {
        automationStore.importLanes([lane({})]);
        await exportStemsToZip(input(), { sampleRate: SAMPLE_RATE, useSongMode: false });
        expect(automationOf(0)?.filterCutoff?.[15]).toBe(8000);

        renderSynthPattern.mockClear();
        automationStore.setPlaybackEnabled(false);
        await exportStemsToZip(input(), { sampleRate: SAMPLE_RATE, useSongMode: false });
        expect(automationOf(0)).toBeUndefined();
    });

    it('bounces a clip-local sweep on its clip only; the next clip keeps the song lane (#1494)', async () => {
        let arrangement = placeClip(createArrangement(32), {
            id: 'a', track: 'partA', patternSlot: 0, startStep: 0, lengthSteps: 16, loop: true,
            lanes: [lane({ id: 'clip', points: [{ step: 0, value: 0 }, { step: 15, value: 0.75 }] })],
        });
        arrangement = placeClip(arrangement, { id: 'b', track: 'partA', patternSlot: 0, startStep: 16, lengthSteps: 16, loop: true });
        const song = lane({ id: 'song', points: [{ step: 0, value: 0.5 }] });
        await exportStemsToZip({ ...input([song]), arrangement }, { sampleRate: SAMPLE_RATE, useSongMode: true });

        const cutoff = automationOf(0)!.filterCutoff!;
        expect(cutoff[0]).toBe(20);
        expect(cutoff[15]).toBe(0.75 * 8000);
        expect(cutoff.slice(16)).toEqual(Array(16).fill(0.5 * 8000));
    });
});
