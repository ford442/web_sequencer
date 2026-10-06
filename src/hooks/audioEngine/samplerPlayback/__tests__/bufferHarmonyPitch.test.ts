/**
 * Buffer (non-stretch) sampler mode used to build playbackRate from the played note and
 * playbackSpeed alone, so harmonizer voices (pitchOffsetSemitones + detune via fineTune)
 * all played at the base pitch. Regression for the #1297 follow-up.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SamplerBankParams } from '../../../../types';

vi.mock('../samplerStretchFx', () => ({
  releaseStretchFxRouting: vi.fn(),
  wireStretchFxRouting: vi.fn(),
}));

import { createPlaySamplerVoice } from '../playSamplerVoice';
import { createPlaySampler } from '../samplerControls';

type Started = { rate: number; buffer: unknown };

function setup(pitchBank?: Map<number, unknown>) {
  const started: Started[] = [];
  const node = () => ({
    connect: vi.fn(),
    gain: { value: 1 },
    frequency: { value: 0 },
    Q: { value: 0 },
    pan: { value: 0 },
    curve: null,
  });
  const context = {
    createBufferSource: () => {
      const src = {
        buffer: null as unknown,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        stop: vi.fn(),
        start: () => started.push({ rate: src.playbackRate.value, buffer: src.buffer }),
      };
      return src;
    },
    createGain: node,
    createBiquadFilter: node,
    createWaveShaper: node,
    createStereoPanner: node,
  } as unknown as AudioContext;

  const base = { duration: 1, getChannelData: () => new Float32Array(8) };
  const ref = <T,>(current: T) => ({ current });
  const banks = new Map();
  if (pitchBank) banks.set('s', { baseBuffer: base, rootNote: 60, pitchBank });
  const refs = {
    multisampleBanksRef: ref(banks),
    loadedSampleBuffersRef: ref(new Map([['s', base]])),
    masterSaturationRef: ref({}),
    singingVoiceManagerRef: ref(null),
    vocalAlignmentsRef: ref(new Map()),
    choirLeftGainRef: ref(null),
    choirRightGainRef: ref(null),
    reverbNodesRef: ref({}),
    reverbTypeRef: ref('plate'),
    delayNodeRef: ref(null),
    harmonizerRef: ref<unknown>(null),
    nextSamplerNoteId: ref(0),
    activeSamplerNotes: ref(new Map()),
  };
  const play = createPlaySamplerVoice(context, 120, refs as never);
  const params = (o: Partial<SamplerBankParams> = {}) =>
    ({ sampleName: 's', mode: 'buffer', playbackSpeed: 1, volume: 1, filterCutoff: 20000, filterResonance: 0, drive: 0, ...o }) as SamplerBankParams;
  return { play, params, started, refs };
}

const semis = (n: number) => Math.pow(2, n / 12);

describe('buffer-mode sampler pitch', () => {
  it('applies pitchOffsetSemitones on top of the played note', () => {
    const { play, params, started } = setup();
    play(params(), 'C4', 0, 1, 0.2, undefined, 0);
    play(params(), 'C4', 0, 1, 0.2, undefined, 7);
    expect(started[0].rate).toBeCloseTo(1);
    expect(started[1].rate).toBeCloseTo(semis(7));
  });

  it('applies fineTune cents', () => {
    const { play, params, started } = setup();
    play(params({ fineTune: 50 }), 'C4', 0, 1, 0.2, undefined, 0);
    expect(started[0].rate).toBeCloseTo(semis(0.5));
  });

  it('keys the formant-preserved pitchBank on note + offset', () => {
    const shifted = { id: 'G4' };
    const { play, params, started } = setup(new Map([[67, shifted]]));
    play(params({ fineTune: 25 }), 'C4', 0, 1, 0.2, undefined, 7);
    expect(started[0].buffer).toBe(shifted);
    expect(started[0].rate).toBeCloseTo(semis(0.25));
  });

  it('gives each harmonizer voice its own pitch through createPlaySampler', () => {
    const { play, params, started, refs } = setup();
    refs.harmonizerRef.current = {
      getIsActive: () => true,
      getConfig: () => ({}),
      generateVoices: () => [
        { index: 0, pitchOffset: 0, detuneCents: 0, formantShift: 0, pan: 0, gain: 1 },
        { index: 1, pitchOffset: 4, detuneCents: 0, formantShift: 0, pan: -0.5, gain: 1 },
        { index: 2, pitchOffset: 7, detuneCents: 10, formantShift: 0, pan: 0.5, gain: 1 },
      ],
    };
    createPlaySampler(play, refs as never)(params(), 'C4', 0);
    expect(started.map((s) => s.rate)).toEqual([
      expect.closeTo(1),
      expect.closeTo(semis(4)),
      expect.closeTo(semis(7.1)),
    ]);
  });
});
