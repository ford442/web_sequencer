/**
 * Regression test for Dynamic Formant Pitch Link (a8fd2eef). The logic lived in the
 * shadow `samplerPlayback.ts` that #1155 deleted and was never ported, leaving the
 * `formantPitchLink` control inert. It must reach `voice.setFormantShift`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SamplerBankParams } from '../../../../types';

vi.mock('../samplerStretchFx', () => ({
  releaseStretchFxRouting: vi.fn(),
  wireStretchFxRouting: vi.fn(() => ({
    strip: new Proxy({}, { get: () => vi.fn() }),
    voiceEntry: {},
  })),
}));

import { createPlaySamplerVoice } from '../playSamplerVoice';

function setup() {
  const voice = new Proxy({ setFormantShift: vi.fn() } as Record<string, unknown>, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = vi.fn();
      return target[prop];
    },
  });
  const buffer = { duration: 1, getChannelData: () => new Float32Array(8) };
  const ref = <T,>(current: T) => ({ current });
  const refs = {
    multisampleBanksRef: ref(new Map()),
    loadedSampleBuffersRef: ref(new Map([['s', buffer]])),
    masterSaturationRef: ref({}),
    singingVoiceManagerRef: ref({
      acquireVoiceForBank: () => ({ voice, index: 0, isNewBank: false }),
    }),
    vocalAlignmentsRef: ref(new Map()),
    choirLeftGainRef: ref(null),
    choirRightGainRef: ref(null),
    reverbNodesRef: ref({}),
    reverbTypeRef: ref('plate'),
    delayNodeRef: ref(null),
    harmonizerRef: ref(null),
    nextSamplerNoteId: ref(0),
    activeSamplerNotes: ref(new Map()),
  };
  const play = createPlaySamplerVoice({} as AudioContext, 120, refs as never);
  const setFormantShift = voice.setFormantShift as ReturnType<typeof vi.fn>;
  const run = (
    overrides: Partial<SamplerBankParams>,
    note = 'C5',
    noteParams?: Parameters<typeof play>[5],
    pitchOffsetSemitones = 0,
  ) => {
    setFormantShift.mockClear();
    const params = { sampleName: 's', mode: 'stretch', rootNote: 60, formantShift: 2, ...overrides } as SamplerBankParams;
    play(params, note, 0, 1, 0.2, noteParams, pitchOffsetSemitones);
    return setFormantShift.mock.calls.map((c) => c[0] as number);
  };
  return { run, setFormantShift };
}

describe('formantPitchLink in playSamplerVoice', () => {
  it('leaves the shift alone when the ratio is zero or unset', () => {
    const { run } = setup();
    expect(run({})).toEqual([2]);
    expect(run({ formantPitchLink: 0 })).toEqual([2]);
  });

  it('adds (noteMidi - rootNote) * ratio to the shift', () => {
    const { run } = setup();
    // C5 = 72, root 60 → +12 semitones
    expect(run({ formantPitchLink: 1 })).toEqual([2 + 12]);
    expect(run({ formantPitchLink: 0.5 })).toEqual([2 + 6]);
    expect(run({ formantPitchLink: 1 }, 'C3')).toEqual([2 - 12]);
  });

  it('includes coarse/fine tune and the pitch offset in the pitch delta', () => {
    const { run } = setup();
    expect(run({ formantPitchLink: 1, coarseTune: 3, fineTune: 50 }, 'C4')).toEqual([2 + 3.5]);
    expect(run({ formantPitchLink: 1 }, 'C4', undefined, 7)).toEqual([2 + 7]);
  });

  it('prefers the per-step ratio over the bank ratio', () => {
    const { run } = setup();
    expect(run({ formantPitchLink: 1 }, 'C5', { formantPitchLink: 0 })).toEqual([2]);
    expect(run({ formantPitchLink: 0 }, 'C5', { formantPitchLink: 0.25 })).toEqual([2 + 3]);
  });

  it('applies the link on top of the timbre/step formant shift', () => {
    const { run } = setup();
    expect(run({ formantPitchLink: 1 }, 'C5', { formantShift: 1 })).toEqual([2 + 1 + 12]);
  });

  it('still links when the bank has no base formant shift', () => {
    const { run } = setup();
    expect(run({ formantShift: undefined, formantPitchLink: 1 }, 'C5')).toEqual([12]);
  });
});
