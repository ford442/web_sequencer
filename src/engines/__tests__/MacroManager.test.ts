import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/engineTelemetry', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/engineTelemetry')>()),
    logWaveformSubstitution: vi.fn(),
}));

import { logWaveformSubstitution } from '../../utils/engineTelemetry';
import { MacroOscillator } from '../MacroOscillator';
import { MacroManager, resetMacroSubstitutionReports, substituteMacroWaveform } from '../MacroManager';
import { MacroParam, macroEngineForWaveform } from '../MacroParams';
import { createPlaySynth } from '../../hooks/audioEngine/audioPlayback/playSynth';
import { createNoteOnSynth, createStopAllNotes, createStopTrackNotes } from '../../hooks/audioEngine/audioPlayback/noteControls';
import { DEFAULT_SYNTH_PARAMS_A } from '../../constants';
import type { SynthParams } from '../../types';

const ref = <T,>(current: T) => ({ current });

/** A MacroOscillator whose worklet is a recording fake. */
function readyOscillator(engineCount = 24) {
    const posted: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const osc = new MacroOscillator();
    const internals = osc as unknown as { workletNode: unknown };
    internals.workletNode = { port: { postMessage: (m: never) => posted.push(m), close: vi.fn() }, disconnect: vi.fn() };
    osc.isReady = true;
    osc.engineCount = engineCount;
    return { osc, posted };
}

function managerWith(a: MacroOscillator | null, b: MacroOscillator | null = null): MacroManager {
    const mgr = new MacroManager();
    const internals = mgr as unknown as { partA: MacroOscillator | null; partB: MacroOscillator | null };
    internals.partA = a;
    internals.partB = b;
    return mgr;
}

const macroPart = (waveform: string, macro: SynthParams['macro'] = {}): SynthParams =>
    ({ ...DEFAULT_SYNTH_PARAMS_A, waveform: waveform as SynthParams['waveform'], macro });

beforeEach(() => {
    resetMacroSubstitutionReports();
    vi.mocked(logWaveformSubstitution).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe('MacroOscillator', () => {
    it('sends the whole patch once, then only what changed', () => {
        const { osc, posted } = readyOscillator();
        osc.setParams([[MacroParam.ENGINE, 8], [MacroParam.TIMBRE, 0.5]], 1.5);
        osc.setParams([[MacroParam.ENGINE, 8], [MacroParam.TIMBRE, 0.5]], 2);
        osc.setParams([[MacroParam.ENGINE, 8], [MacroParam.TIMBRE, 0.7]], 3);
        expect(posted).toEqual([
            { type: 'set-params', data: { params: [0, 8, 2, 0.5], audioTime: 1.5 } },
            { type: 'set-params', data: { params: [2, 0.7], audioTime: 3 } },
        ]);
    });

    it('routes knob moves through set-params-now', () => {
        const { osc, posted } = readyOscillator();
        osc.setParamsNow([[MacroParam.MORPH, 0.2]]);
        expect(posted).toEqual([{ type: 'set-params-now', data: { params: [3, 0.2] } }]);
    });

    it('carries the audio time and per-note options on notes', () => {
        const { osc, posted } = readyOscillator();
        osc.noteOn(60, 0.9, 4.25, { timbre: 0.1, slide: true });
        osc.noteOff(60, 4.5);
        expect(posted).toEqual([
            { type: 'noteOn', data: { note: 60, velocity: 0.9, audioTime: 4.25, timbre: 0.1, morph: undefined, slide: true, fine: undefined } },
            { type: 'noteOff', data: { note: 60, audioTime: 4.5 } },
        ]);
    });

    it('posts nothing before the worklet is ready', () => {
        const { osc, posted } = readyOscillator();
        osc.isReady = false;
        osc.noteOn(60, 1);
        osc.setParams([[MacroParam.ENGINE, 1]]);
        expect(posted).toEqual([]);
    });
});

describe('MacroManager', () => {
    it('plays a model only when the part is ready and the wasm knows it', () => {
        const mgr = managerWith(readyOscillator(24).osc, readyOscillator(10).osc);
        expect(mgr.canPlay('partA', macroEngineForWaveform('macro-hihat')!)).toBe(true);
        expect(mgr.canPlay('partB', macroEngineForWaveform('macro-va')!)).toBe(true);
        expect(mgr.canPlay('partB', macroEngineForWaveform('macro-hihat')!)).toBe(false);
        expect(managerWith(null).canPlay('partA', macroEngineForWaveform('macro-va')!)).toBe(false);
    });

    it('applies model, knobs, level and TUNE as native params', () => {
        const { osc, posted } = readyOscillator();
        const mgr = managerWith(osc);
        mgr.applyParams('partA', { ...macroPart('macro-chords', { harmonics: 0.25 }), pitch: -3, volume: 0.4 }, macroEngineForWaveform('macro-chords')!, 2);
        const params = posted[0].data!.params as number[];
        const sent = new Map<number, number>();
        for (let i = 0; i < params.length; i += 2) sent.set(params[i], params[i + 1]);
        expect(sent.get(MacroParam.ENGINE)).toBe(14);
        expect(sent.get(MacroParam.HARMONICS)).toBe(0.25);
        expect(sent.get(MacroParam.VOLUME)).toBe(0.4);
        expect(sent.get(MacroParam.TRANSPOSE)).toBe(-3);
        expect(posted[0].data!.audioTime).toBe(2);
    });

    it('schedules automation on its audio time, bipolar lanes mapped to −1…1', () => {
        const { osc, posted } = readyOscillator();
        managerWith(osc).scheduleParamAtTime('partA', 'macroTimbreMod', 0.25, 3.5);
        expect(posted).toEqual([{ type: 'set-param', data: { paramId: MacroParam.TIMBRE_MOD, value: -0.5, audioTime: 3.5 } }]);
    });

    it('attaches each part to its macroVoice socket, or its track bus when the patch has none', () => {
        const { osc: a } = readyOscillator();
        const { osc: b } = readyOscillator();
        const attach = vi.fn();
        const graph = { ports: new Map([['macroA', { engineSocket: { factory: 'macroVoice', voice: 'partA', attach } }]]) };
        const busB = {} as AudioNode;
        const connectB = vi.spyOn(b, 'connect').mockImplementation(() => {});
        const missing = managerWith(a, b).attachToGraph(graph as never, { partB: busB });
        expect(attach).toHaveBeenCalledWith(a);
        expect(missing).toEqual(['partB']);
        expect(connectB).toHaveBeenCalledWith(busB);
    });

    it('reports a substitution once per part + model and names the fallback', () => {
        expect(substituteMacroWaveform('partA', 'macro-modal', null)).toBe('sine');
        expect(substituteMacroWaveform('partA', 'macro-modal', null)).toBe('sine');
        expect(substituteMacroWaveform('partB', 'macro-modal', null)).toBe('sine');
        expect(logWaveformSubstitution).toHaveBeenCalledTimes(2);
        expect(vi.mocked(logWaveformSubstitution).mock.calls[0]).toEqual(['macro', 'partA', 'macro-modal', 'sine', 'macro engine not initialised']);
        expect(substituteMacroWaveform('partA', 'sawtooth', null)).toBeUndefined();
    });
});

describe('macro note routing', () => {
    const context = { currentTime: 0 } as AudioContext;

    function playbackRefs(mgr: MacroManager | null) {
        const playNote = vi.fn(() => null);
        return {
            playNote,
            refs: {
                masterGainRef: ref({}),
                open303ManagerRef: ref(null),
                prophecyManagerRef: ref(null),
                macroManagerRef: ref(mgr),
                voiceManagerARef: ref({ playNote }),
                voiceManagerBRef: ref({ playNote }),
                reverbNodesRef: ref({}),
                reverbTypeRef: ref('room'),
                bassSidechainEQBusRef: ref(null),
                singingVoiceManagerRef: ref(null),
            } as never,
        };
    }

    it('plays every chord note as its own voice, gated for the note length', () => {
        const { osc, posted } = readyOscillator();
        const { refs, playNote } = playbackRefs(managerWith(osc));
        const play = createPlaySynth(context, refs);
        play(macroPart('macro-va'), ['C4', 'E4', 'G4'], 1, 2, 0.25, undefined, 'partA', { velocity: 0.5, timbre: 0.75 });
        const notes = posted.filter((m) => m.type === 'noteOn' || m.type === 'noteOff');
        expect(notes.map((m) => [m.type, m.data!.note, m.data!.audioTime])).toEqual([
            ['noteOn', 60, 1], ['noteOff', 60, 1.5],
            ['noteOn', 64, 1], ['noteOff', 64, 1.5],
            ['noteOn', 67, 1], ['noteOff', 67, 1.5],
        ]);
        expect(notes[0].data).toMatchObject({ velocity: 0.5, timbre: 0.25, slide: false });
        expect(posted[0].type).toBe('set-params');
        expect(playNote).not.toHaveBeenCalled();
    });

    it('marks a slid step so the engine glides (legato when mono)', () => {
        const { osc, posted } = readyOscillator();
        const play = createPlaySynth(context, playbackRefs(managerWith(osc)).refs);
        play(macroPart('macro-va', { polyphony: 1 }), 'A2', 0.5, 1, 0.25, 110, 'partA');
        expect(posted.find((m) => m.type === 'noteOn')!.data).toMatchObject({ note: 45, slide: true });
        expect(posted.some((m) => m.type === 'noteOff')).toBe(true);
    });

    it('substitutes the fallback waveform through VoiceManager when the engine is not there', () => {
        const { refs, playNote } = playbackRefs(null);
        createPlaySynth(context, refs)(macroPart('macro-fm2'), 'C4', 1, 1, 0.25, undefined, 'partB');
        expect(playNote).toHaveBeenCalledOnce();
        expect((playNote.mock.calls[0] as unknown[])[0]).toMatchObject({ waveform: 'sine' });
        expect(logWaveformSubstitution).toHaveBeenCalledWith('macro', 'partB', 'macro-fm2', 'sine', 'macro engine not initialised');
    });

    it('live keyboard: a held key is a voice until released; unavailable → fallback', () => {
        const { osc, posted } = readyOscillator();
        const voiceNoteOn = vi.fn(() => ({ stopNote: vi.fn() }));
        const active = new Map<number, { stop: () => void }>();
        const refs = {
            open303ManagerRef: ref(null),
            prophecyManagerRef: ref(null),
            macroManagerRef: ref(managerWith(osc)),
            voiceManagerARef: ref({ noteOn: voiceNoteOn }),
            voiceManagerBRef: ref({ noteOn: voiceNoteOn }),
            nextSynthNoteId: ref(1),
            activeSynthNotes: ref(active),
            bassSidechainEQBusRef: ref(null),
            singingVoiceManagerRef: ref(null),
        };
        const noteOn = createNoteOnSynth(context, refs as never);
        const id = noteOn(macroPart('macro-modal'), 'A4', undefined, 'partA');
        expect(posted.find((m) => m.type === 'noteOn')!.data).toMatchObject({ note: 69 });
        active.get(id!)!.stop();
        expect(posted.find((m) => m.type === 'noteOff')!.data).toMatchObject({ note: 69 });
        expect(voiceNoteOn).not.toHaveBeenCalled();

        refs.macroManagerRef.current = null as never;
        noteOn(macroPart('macro-modal'), 'A4', undefined, 'partA');
        expect((voiceNoteOn.mock.calls[0] as unknown[])[0]).toMatchObject({ waveform: 'sine' });
    });

    it('transport stop and track stop reach the macro parts', () => {
        const mgr = { allNotesOff: vi.fn() };
        createStopAllNotes({
            activeSynthNotes: ref(new Map()),
            activeSamplerNotes: ref(new Map()),
            voiceManagerARef: ref(null),
            voiceManagerBRef: ref(null),
            singingVoiceManagerRef: ref(null),
            open303ManagerRef: ref(null),
            prophecyManagerRef: ref(null),
            macroManagerRef: ref(mgr),
            drumKitEngineRef: ref(null),
        } as never)();
        expect(mgr.allNotesOff).toHaveBeenCalledWith();
        createStopTrackNotes({
            activeSamplerNotes: ref(new Map()),
            voiceManagerARef: ref(null),
            voiceManagerBRef: ref(null),
            singingVoiceManagerRef: ref(null),
            open303ManagerRef: ref(null),
            prophecyManagerRef: ref(null),
            macroManagerRef: ref(mgr),
        } as never)('partB');
        expect(mgr.allNotesOff).toHaveBeenLastCalledWith('partB');
    });
});
