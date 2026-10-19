import { describe, expect, it, vi } from 'vitest';
import { createNoteOnSynth } from '../noteControls';
import { DEFAULT_SYNTH_PARAMS_A } from '../../../../constants';
import type { SynthParams } from '../../../../types';

const ref = <T,>(current: T) => ({ current });

function setup(overrides: Record<string, unknown> = {}) {
  const pushBassTrigger = vi.fn();
  const voice = { stopNote: vi.fn() };
  const refs = {
    open303ManagerRef: ref({
      isBass2Ready: () => true,
      isBass1Ready: () => true,
      isLead303Ready: () => true,
      setBass2Drive: vi.fn(), noteOnBass2: vi.fn(), noteOffBass2: vi.fn(),
      setBass1Drive: vi.fn(), noteOnBass1: vi.fn(), noteOffBass1: vi.fn(), applyBass1Params: vi.fn(),
      setLead303Drive: vi.fn(), noteOnLead303: vi.fn(), noteOffLead303: vi.fn(), applyLead303Params: vi.fn(),
    }),
    prophecyManagerRef: ref(null),
    macroManagerRef: ref(null),
    voiceManagerARef: ref({ noteOn: vi.fn(() => voice) }),
    voiceManagerBRef: ref({ noteOn: vi.fn(() => voice) }),
    nextSynthNoteId: ref(1),
    activeSynthNotes: ref(new Map()),
    bassSidechainEQBusRef: ref(null),
    singingVoiceManagerRef: ref({ pushBassTrigger }),
    ...overrides,
  };
  const noteOn = createNoteOnSynth({ currentTime: 3 } as AudioContext, refs as never);
  return { noteOn, pushBassTrigger, refs };
}

const params = (waveform: string): SynthParams => ({ ...DEFAULT_SYNTH_PARAMS_A, waveform: waveform as SynthParams['waveform'] });

describe('interactive note-on feeds the bass envelope follower through the shared helper', () => {
  it('bass2 303: one trigger, at the engine velocity (100/127), no raw SAB writes', () => {
    const { noteOn, pushBassTrigger } = setup();
    noteOn({ ...params('303-saw'), volume: 0.3 }, 'C2', undefined, 'bass2');
    expect(pushBassTrigger).toHaveBeenCalledTimes(1);
    expect(pushBassTrigger).toHaveBeenCalledWith(3, 100 / 127, 0.25);
  });

  it('partB 303 feeds it; the partA lead does not', () => {
    const { noteOn, pushBassTrigger } = setup();
    noteOn(params('303-sqr'), 'C2', undefined, 'partB');
    expect(pushBassTrigger).toHaveBeenCalledTimes(1);
    noteOn(params('303-sqr'), 'C4', undefined, 'partA');
    expect(pushBassTrigger).toHaveBeenCalledTimes(1);
  });

  it('partB on the VoiceManager feeds it (it did not before)', () => {
    const { noteOn, pushBassTrigger } = setup();
    noteOn(params('sawtooth'), 'C2', undefined, 'partB');
    expect(pushBassTrigger).toHaveBeenCalledWith(3, 1, 0.25);
    noteOn(params('sawtooth'), 'C4', undefined, 'partA');
    expect(pushBassTrigger).toHaveBeenCalledTimes(1);
  });

  it('bass2 falling back to a VoiceManager while its 303 is not ready still feeds it', () => {
    const { noteOn, pushBassTrigger, refs } = setup();
    (refs.open303ManagerRef.current as { isBass2Ready: () => boolean }).isBass2Ready = () => false;
    noteOn(params('sawtooth'), 'C2', undefined, 'bass2');
    expect(pushBassTrigger).toHaveBeenCalledTimes(1);
  });
});
