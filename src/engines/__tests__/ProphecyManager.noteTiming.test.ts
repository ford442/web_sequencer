import { describe, expect, it, vi } from 'vitest';
import { ProphecyManager } from '../ProphecyManager';
import { createPlaySynth } from '../../hooks/audioEngine/audioPlayback/playSynth';
import { DEFAULT_SYNTH_PARAMS_A } from '../../constants';
import type { SynthParams } from '../../types';

/**
 * Prophecy notes are applied on the frame of their audioTime (the voice
 * core's event ring). The manager used to drop that time, so a sequenced
 * noteOn and its noteOff both landed on the next block's first frame — the
 * note released before it sounded — and a slide step, sent without a noteOff,
 * held its voice forever: the constant tone Prophecy left behind while idle.
 */

const oscillator = vi.hoisted(() => ({
  noteOn: vi.fn(),
  noteOff: vi.fn(),
}));

vi.mock('../ProphecyOscillator', () => ({
  ProphecyOscillator: class {
    isReady = true;
    init = vi.fn(async () => true);
    noteOn = oscillator.noteOn;
    noteOff = oscillator.noteOff;
  },
}));

describe('ProphecyManager note timing', () => {
  it('forwards audioTime to both parts', async () => {
    oscillator.noteOn.mockClear();
    oscillator.noteOff.mockClear();
    const manager = new ProphecyManager();
    await manager.init({} as AudioContext, 'prophecy-processor.js');

    manager.noteOnPartA(57, 100, 1.25);
    manager.noteOffPartA(57, 1.5);
    manager.noteOnPartB(36, 90, 2.25);
    manager.noteOffPartB(36, 2.5);

    expect(oscillator.noteOn.mock.calls).toEqual([[57, 100, 1.25], [36, 90, 2.25]]);
    expect(oscillator.noteOff.mock.calls).toEqual([[57, 1.5], [36, 2.5]]);
  });
});

describe('playSynth on a Prophecy wave', () => {
  const ref = <T,>(current: T) => ({ current });

  function setup() {
    const prophecy = {
      isPartAReady: () => true,
      isPartBReady: () => true,
      applyPartAParams: vi.fn(),
      applyPartBParams: vi.fn(),
      noteOnPartA: vi.fn(),
      noteOffPartA: vi.fn(),
      noteOnPartB: vi.fn(),
      noteOffPartB: vi.fn(),
    };
    const refs = {
      masterGainRef: ref({}),
      open303ManagerRef: ref(null),
      prophecyManagerRef: ref(prophecy),
      macroManagerRef: ref(null),
      voiceManagerARef: ref(null),
      voiceManagerBRef: ref(null),
      reverbNodesRef: ref(null),
      reverbTypeRef: ref('room'),
      bassSidechainEQBusRef: ref(null),
      singingVoiceManagerRef: ref(null),
    };
    const playSynth = createPlaySynth({ currentTime: 0 } as AudioContext, refs as never);
    return { playSynth, prophecy };
  }

  const params: SynthParams = { ...DEFAULT_SYNTH_PARAMS_A, waveform: 'prophecy-saw' as SynthParams['waveform'] };

  it('schedules the noteOn and its noteOff at the step time', () => {
    const { playSynth, prophecy } = setup();
    playSynth(params, 'A3', 1, 2, 0.125, undefined, 'partA');
    expect(prophecy.noteOnPartA).toHaveBeenCalledWith(57, 100, 1);
    expect(prophecy.noteOffPartA).toHaveBeenCalledWith(57, 1.25);
  });

  it('releases a slide step too: the next note takes another voice', () => {
    const { playSynth, prophecy } = setup();
    playSynth(params, 'C2', 1, 1, 0.125, 220, 'partB');
    expect(prophecy.noteOnPartB).toHaveBeenCalledWith(36, 100, 1);
    expect(prophecy.noteOffPartB).toHaveBeenCalledWith(36, 1.125);
  });
});
