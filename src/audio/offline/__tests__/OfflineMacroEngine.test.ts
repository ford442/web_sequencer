import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/engineTelemetry', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../utils/engineTelemetry')>()),
    logWaveformSubstitution: vi.fn(),
}));

import { logWaveformSubstitution } from '../../../utils/engineTelemetry';
import {
    OFFLINE_MACRO_BLOCK,
    renderMacroBuffer,
    renderMacroOffline,
    resetOfflineMacroApiForTests,
    type OfflineMacroApi,
} from '../OfflineMacroEngine';
import { MacroParam, macroEngineForWaveform } from '../../../engines/MacroParams';
import { DEFAULT_SYNTH_PARAMS_A } from '../../../constants';
import type { SynthParams } from '../../../types';

type Event = { frame: number; type: number; target: number; value: number; args: number[] };

/** Byte offset of the fake render buffer (0 is the API's error value). */
const PTR = 64;

/** A fake macro API: records params and events, renders frame-index ramps. */
function fakeApi(engineCount = 24) {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const params: Array<[number, number]> = [];
    const events: Event[] = [];
    const renders: Array<[number, number]> = [];
    const api: OfflineMacroApi = {
        memory,
        macro_create: () => 3,
        macro_destroy: vi.fn(),
        macro_init: () => 1,
        macro_set_param: (_h, id, value) => void params.push([id, value]),
        macro_push_event: (_h, frame, type, target, value, a0, a1, a2, a3) => {
            events.push({ frame, type, target, value, args: [a0, a1, a2, a3] });
            return 1;
        },
        macro_render: (_h, start, n) => {
            renders.push([start, n]);
            const heap = new Float32Array(memory.buffer);
            const base = PTR / 4;
            for (let i = 0; i < n; i++) {
                heap[base + i] = start + i; // left: the absolute frame
                heap[base + OFFLINE_MACRO_BLOCK + i] = -(start + i); // right, one stride on
            }
            return PTR;
        },
        macro_engine_count: () => engineCount,
    };
    return { api, params, events, renders };
}

const part = (macro: SynthParams['macro'] = {}): SynthParams =>
    ({ ...DEFAULT_SYNTH_PARAMS_A, waveform: 'macro-va', pitch: 2, macro });

beforeEach(() => {
    resetOfflineMacroApiForTests();
    vi.mocked(logWaveformSubstitution).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe('renderMacroOffline', () => {
    it('sets the patch, then plays each note as noteOn / noteOff on its own frame', () => {
        const { api, params, events } = fakeApi();
        renderMacroOffline(api, {
            params: part({ timbre: 0.3 }),
            engine: macroEngineForWaveform('macro-va')!,
            notes: [
                { midi: 64, velocity: 0.5, startSeconds: 0.5, durationSeconds: 0.25, timbre: -0.2 },
                { midi: 60, velocity: 0.9, startSeconds: 0, durationSeconds: 0.5, slide: true },
            ],
            durationSeconds: 1,
            sampleRate: 48000,
        });
        const set = new Map(params);
        expect(set.get(MacroParam.ENGINE)).toBe(8);
        expect(set.get(MacroParam.TIMBRE)).toBe(0.3);
        expect(set.get(MacroParam.TRANSPOSE)).toBe(2);
        expect(events.map((e) => [e.frame, e.type, e.target])).toEqual([
            [0, 1, 60], [24000, 2, 60], [24000, 1, 64], [36000, 2, 64],
        ]);
        expect(events[0].args).toEqual([0, 1, 0, 0]);
        expect(events[2]).toMatchObject({ value: 0.5, args: [-0.2, 0, 0, 0] });
    });

    it('feeds the event ring a block at a time and copies planar stereo', () => {
        const { api, renders } = fakeApi();
        const frames = OFFLINE_MACRO_BLOCK * 2 + 100;
        const [left, right] = renderMacroOffline(api, {
            params: part(),
            engine: macroEngineForWaveform('macro-va')!,
            notes: [],
            durationSeconds: frames / 48000,
            sampleRate: 48000,
        });
        expect(renders).toEqual([[0, OFFLINE_MACRO_BLOCK], [OFFLINE_MACRO_BLOCK, OFFLINE_MACRO_BLOCK], [OFFLINE_MACRO_BLOCK * 2, 100]]);
        expect(left.length).toBe(frames);
        expect(left[OFFLINE_MACRO_BLOCK + 5]).toBe(OFFLINE_MACRO_BLOCK + 5);
        expect(right[frames - 1]).toBe(-(frames - 1));
    });

    it('puts per-note knob values on the onset and restores the part on the next plain onset', () => {
        const { api, events } = fakeApi();
        renderMacroOffline(api, {
            params: part({ harmonics: 0.1 }),
            engine: macroEngineForWaveform('macro-va')!,
            notes: [
                { midi: 60, velocity: 1, startSeconds: 0, durationSeconds: 0.1, macro: { harmonics: 0.9 } },
                { midi: 62, velocity: 1, startSeconds: 0.5, durationSeconds: 0.1 },
            ],
            durationSeconds: 1,
            sampleRate: 1000,
        });
        const harmonics = events.filter((e) => e.type === 4 && e.target === MacroParam.HARMONICS);
        expect(harmonics.map((e) => [e.frame, e.value])).toEqual([[0, 0.9], [500, 0.1]]);
    });

    it('refuses a model the wasm does not know (the caller substitutes)', () => {
        const { api } = fakeApi(8);
        expect(() => renderMacroOffline(api, {
            params: part(),
            engine: macroEngineForWaveform('macro-hihat')!,
            notes: [],
            durationSeconds: 0.1,
            sampleRate: 48000,
        })).toThrow(/knows 8 macro models/);
    });
});

describe('renderMacroBuffer', () => {
    it('reports the substitution once and returns null when the wasm cannot load', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
        const request = {
            params: part(),
            engine: macroEngineForWaveform('macro-wavetable')!,
            notes: [],
            durationSeconds: 0.1,
            sampleRate: 48000,
        };
        expect(await renderMacroBuffer(request)).toBeNull();
        expect(await renderMacroBuffer(request)).toBeNull();
        expect(logWaveformSubstitution).toHaveBeenCalledTimes(1);
        expect(vi.mocked(logWaveformSubstitution).mock.calls[0].slice(0, 4)).toEqual(['macro-offline', 'offline', 'macro-wavetable', 'sawtooth']);
    });
});
