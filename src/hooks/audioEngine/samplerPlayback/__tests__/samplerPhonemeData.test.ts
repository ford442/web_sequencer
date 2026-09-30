/**
 * The step's Phoneme Painter edits (pitch bend, volume, elasticity) must reach
 * the Rubber Band worklet. Before #1273 the stretch path called
 * sendPhonemeDataToWorklet(targetDuration) without them, so painter edits were
 * saved but never heard.
 */
import { describe, expect, it, vi } from 'vitest';
import { createPlaySamplerVoice } from '../playSamplerVoice';
import type { SamplerPlaybackRefs } from '../types';
import type { PhonemeData, SamplerBankParams } from '@/types';
import type { AlignmentResult } from '@/engines/rubberband/PhonemeAligner';

function audioParam() {
  return { value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
}

function mockContext(): AudioContext {
  const node = () => ({
    gain: audioParam(), frequency: audioParam(), Q: audioParam(), pan: audioParam(), curve: null,
    connect: vi.fn((d: unknown) => d), disconnect: vi.fn(), start: vi.fn(),
  });
  return {
    currentTime: 0,
    sampleRate: 48000,
    createGain: node, createBiquadFilter: node, createOscillator: node,
    createWaveShaper: node, createStereoPanner: node,
  } as unknown as AudioContext;
}

/** Any method the stretch path calls is a spy. */
function mockVoice() {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  return new Proxy(calls, {
    get: (target, key: string) => (target[key] ??= vi.fn()),
  }) as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

describe('playSamplerVoice → worklet phoneme data', () => {
  it('forwards the step phonemes (with elasticity) to sendPhonemeDataToWorklet', () => {
    const voice = mockVoice();
    const alignment: AlignmentResult = {
      phonemes: [{ phoneme: 'HH', start: 0, end: 0.2, isVowel: false }, { phoneme: 'AY', start: 0.2, end: 1, isVowel: true }],
      sampleRate: 48000,
      duration: 1,
      text: 'hi',
    };
    const ref = <T,>(current: T) => ({ current });
    const refs = {
      multisampleBanksRef: ref(new Map()),
      loadedSampleBuffersRef: ref(new Map([['bank_0', { duration: 1, getChannelData: () => new Float32Array(48000) }]])),
      masterSaturationRef: ref({ connect: vi.fn() }),
      singingVoiceManagerRef: ref({ acquireVoiceForBank: () => ({ voice, index: 0, isNewBank: true }) }),
      vocalAlignmentsRef: ref(new Map([['bank_0', alignment]])),
      choirLeftGainRef: ref(null),
      choirRightGainRef: ref(null),
      reverbNodesRef: ref({}),
      reverbTypeRef: ref('plate'),
      delayNodeRef: ref(null),
      harmonizerRef: ref(null),
      nextSamplerNoteId: ref(0),
      activeSamplerNotes: ref(new Map()),
    } as unknown as SamplerPlaybackRefs;

    const phonemes: PhonemeData[] = [
      { id: 'a', symbol: 'HH', start: 0, end: 0.2, pitchBend: 0 },
      { id: 'b', symbol: 'AY', start: 0.2, end: 1, pitchBend: 25, elasticity: 1.4 },
    ];
    const play = createPlaySamplerVoice(mockContext(), 120, refs);
    play({ sampleName: 'bank_0', mode: 'stretch', volume: 1 } as unknown as SamplerBankParams, 'C4', 0, 2, 0.25, { phonemes });

    expect(voice.setAlignment).toHaveBeenCalledWith(alignment);
    expect(voice.sendPhonemeDataToWorklet).toHaveBeenCalledWith(0.5, phonemes);
  });
});
