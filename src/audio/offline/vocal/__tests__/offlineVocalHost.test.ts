import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The offline vocal host's contract, with the audio graph faked: it renders at
 * the export rate, resamples the phrase and the vowel pack to that rate, drives
 * the live trigger at each step's time, and reports — never hides — a module
 * that fails to load. The real worklet + wasm path is covered by
 * src/__tests__/vocalFreezeParity.integration.test.ts and the E2E freeze spec.
 */

const h = vi.hoisted(() => ({
    contexts: [] as { sampleRate: number; durationSeconds: number }[],
    log: [] as string[],
    initError: null as Error | null,
    wasmError: null as Error | null,
    play: null as null | ReturnType<typeof import('vitest').vi.fn>,
    hybridFactory: null as null | (() => unknown),
    resampleTargets: [] as number[],
}));

vi.mock('../../createOfflineContext', () => ({
    createOfflineContext: (spec: { sampleRate: number; durationSeconds: number }) => {
        h.contexts.push(spec);
        const suspends: { t: number; resolve: () => void }[] = [];
        let resumed: (() => void) | null = null;
        const node = () => ({ connect: vi.fn(), gain: { value: 1 } });
        return {
            sampleRate: spec.sampleRate,
            destination: {},
            createWaveShaper: node,
            createGain: node,
            suspend: (t: number) => new Promise<void>((resolve) => { suspends.push({ t, resolve }); }),
            resume: () => { resumed?.(); return Promise.resolve(); },
            startRendering: async () => {
                h.log.push('start');
                for (const s of [...suspends].sort((a, b) => a.t - b.t)) {
                    h.log.push(`suspend@${s.t}`);
                    const done = new Promise<void>((r) => { resumed = r; });
                    s.resolve();
                    await done;
                }
                return { sampleRate: spec.sampleRate, length: 1, numberOfChannels: 2 };
            },
        };
    },
    createOfflineBuffer: (spec: { length: number; sampleRate: number }) => ({
        sampleRate: spec.sampleRate,
        length: spec.length,
        getChannelData: () => new Float32Array(spec.length),
    }),
}));

vi.mock('../../../../utils/resampleAudioBuffer', () => ({
    resampleAudioBuffer: (buffer: AudioBuffer, to: number) => {
        h.resampleTargets.push(to);
        return Promise.resolve({ ...buffer, sampleRate: to, getChannelData: () => new Float32Array(4) });
    },
}));

vi.mock('../../../../utils/publicAsset', () => ({
    fetchPublicArrayBuffer: () => (h.wasmError ? Promise.reject(h.wasmError) : Promise.resolve(new ArrayBuffer(8))),
}));

vi.mock('../../../../hooks/audioEngine/sampleManagement', () => ({ applyVoiceParamUpdate: vi.fn() }));

vi.mock('../../../../engines/SingingVoiceManager', () => ({
    SingingVoiceManager: class {
        constructor(_ctx: unknown, max: number, config: { offline?: boolean }) {
            h.log.push(`manager:${max}:offline=${String(config.offline)}`);
        }
        init() {
            return h.initError ? Promise.reject(h.initError) : Promise.resolve();
        }
        getAllVoices() {
            const listeners = new Set<(e: MessageEvent) => void>();
            const port = {
                start: () => {},
                addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
                removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
                postMessage: (msg: { type: string; data: { id: number } }) => {
                    if (msg.type !== 'SYNC') return;
                    h.log.push(`sync:${msg.data.id}`);
                    queueMicrotask(() => listeners.forEach((fn) => fn({ data: { type: 'SYNCED', id: msg.data.id } } as MessageEvent)));
                },
            };
            return [{ workletNode: { port } }];
        }
    },
}));

vi.mock('../../../../hooks/audioEngine/samplerPlayback/playSamplerVoice', () => ({
    createPlaySamplerVoice: (_ctx: unknown, _tempo: number, _refs: unknown, hybrid: () => unknown) => {
        h.hybridFactory = hybrid;
        h.play = vi.fn((_params: unknown, note: unknown, time: number) => { h.log.push(`play:${String(note)}@${time}`); });
        return h.play;
    },
}));

import { OfflineVocalUnsupportedError, renderVocalBankOffline, resetRubberBandWasmForTests } from '../offlineVocalHost';
import { ConcatenativeHybrid, VowelLibrary } from '@/engines/rubberband/ConcatenativeHybrid';
import type { PartSequence, SamplerBankParams } from '@/types';

const params = { sampleName: 'bank_0', mode: 'stretch', useVowelSamplesOnLongNotes: true } as SamplerBankParams;
// 120 BPM: 0.125 s per step. Two bars: notes at step 0 and 16.
const sequence: PartSequence = {
    steps: Array.from({ length: 32 }, (_, i) => (i === 0 || i === 16 ? { note: i === 0 ? 'C4' : 'G4', velocity: 1, length: 8 } : null)),
};
const sampleBuffer = { sampleRate: 44100, length: 44100, duration: 1, getChannelData: () => new Float32Array(44100) } as unknown as AudioBuffer;

function vowelPack(rate: number): VowelLibrary {
    const library = new VowelLibrary();
    library.addSample({ vowel: 'ah', midiNote: 60, audio: new Float32Array(rate), sampleRate: rate, loopStart: 100, loopEnd: 1000 });
    return library;
}

beforeEach(() => {
    h.contexts.length = 0;
    h.log.length = 0;
    h.resampleTargets.length = 0;
    h.initError = null;
    h.wasmError = null;
    resetRubberBandWasmForTests();
});

describe('renderVocalBankOffline', () => {
    it('renders at the export rate and makes the vowel plan at that rate, not 48000 hard-coded', async () => {
        await renderVocalBankOffline({
            sequence, sampleBuffer, params, tempo: 120,
            sampleRatePref: 'native', liveSampleRate: 44100,
            vowelLibrary: vowelPack(48000),
        });
        expect(h.contexts[0]).toEqual(expect.objectContaining({ sampleRate: 44100, durationSeconds: 4 }));
        // The phrase and the 48 kHz pack are both resampled to the render rate.
        expect(h.resampleTargets).toEqual([44100, 44100]);
        const hybrid = h.hybridFactory!() as ConcatenativeHybrid;
        expect(hybrid.getConfig().sampleRate).toBe(44100);
        expect(hybrid.getLibrary().getSample('ah', 60)!.sampleRate).toBe(44100);
    });

    it('follows an explicit export rate', async () => {
        await renderVocalBankOffline({ sequence, sampleBuffer, params, tempo: 120, sampleRatePref: 48000, liveSampleRate: 44100 });
        expect(h.contexts[0].sampleRate).toBe(48000);
        expect(h.hybridFactory!()).toBeNull(); // no pack: notes stay TTS
    });

    it('uses its own offline voices and triggers each note at its step, synced before the render resumes', async () => {
        await renderVocalBankOffline({ sequence, sampleBuffer, params, tempo: 120, sampleRate: 48000 });
        expect(h.log).toEqual([
            'manager:4:offline=true',
            'play:C4@0',
            'sync:1',
            'start',
            'suspend@2',
            'play:G4@2',
            'sync:2',
        ]);
        expect(h.play!.mock.calls[1][3]).toBe(8); // length in steps
        expect(h.play!.mock.calls[1][4]).toBeCloseTo(0.125, 9); // step length
    });

    it('reports the vocal chain unsupported when rubberband.wasm is missing', async () => {
        h.wasmError = new Error('rubberband.wasm not found (HTTP 404)');
        await expect(renderVocalBankOffline({ sequence, sampleBuffer, params, tempo: 120, sampleRate: 48000 }))
            .rejects.toThrow(OfflineVocalUnsupportedError);
        expect(h.log).not.toContain('start');
    });

    it('reports the vocal chain unsupported when the module fails to instantiate offline', async () => {
        h.initError = new Error('AudioWorklet initialization failed: timeout');
        const err = await renderVocalBankOffline({ sequence, sampleBuffer, params, tempo: 120, sampleRate: 48000 }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(OfflineVocalUnsupportedError);
        expect((err as Error).message).toMatch(/Rubber Band did not load offline: AudioWorklet initialization failed/);
        expect(h.log).not.toContain('start');
    });
});
