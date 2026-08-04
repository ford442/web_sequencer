import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SingingVoice } from '../../../../engines/SingingVoice';
import {
  getStretchFxStrip,
  releaseStretchFxRouting,
  wireStretchFxRouting,
} from '../samplerStretchFx';

function makeMockContext(): AudioContext & { _nodes: AudioNode[] } {
  const nodes: AudioNode[] = [];
  const mk = (type: string) => {
    const connections: AudioNode[] = [];
    const node = {
      type,
      gain: { value: 1, setValueAtTime: vi.fn() },
      frequency: { value: 1, setValueAtTime: vi.fn() },
      pan: { value: 0 },
      Q: { value: 1 },
      curve: null as Float32Array | null,
      connect: vi.fn((dest: AudioNode) => {
        connections.push(dest);
        return dest;
      }),
      disconnect: vi.fn(() => {
        connections.length = 0;
      }),
      start: vi.fn(),
      connections,
    } as unknown as AudioNode & { connections: AudioNode[] };
    nodes.push(node);
    return node;
  };

  return {
    createGain: () => mk('GainNode'),
    createBiquadFilter: () => mk('BiquadFilterNode'),
    createOscillator: () => mk('OscillatorNode'),
    createWaveShaper: () => mk('WaveShaperNode'),
    createStereoPanner: () => mk('StereoPannerNode'),
    sampleRate: 48000,
    _nodes: nodes,
  } as unknown as AudioContext & { _nodes: AudioNode[] };
}

function makeVoice(): SingingVoice {
  return { id: 1 } as unknown as SingingVoice;
}

describe('samplerStretchFx', () => {
  let context: ReturnType<typeof makeMockContext>;
  let voice: SingingVoice;
  let mainDest: AudioNode;

  beforeEach(() => {
    context = makeMockContext();
    voice = makeVoice();
    mainDest = context.createGain();
  });

  it('reuses VoiceFXStrip per voice across triggers', () => {
    const first = getStretchFxStrip(voice, context);
    const second = getStretchFxStrip(voice, context);
    expect(first).toBe(second);
  });

  it('does not grow node count when rewiring twice with drive', () => {
    const curve = () => new Float32Array(256);
    wireStretchFxRouting(voice, context, mainDest, null, null, 0.5, curve);
    const countAfterFirst = context._nodes.length;

    releaseStretchFxRouting(voice);
    wireStretchFxRouting(voice, context, mainDest, null, null, 0.6, curve);
    const countAfterSecond = context._nodes.length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('releaseStretchFxRouting disconnects shaper between triggers', () => {
    const curve = () => new Float32Array(256);
    wireStretchFxRouting(voice, context, mainDest, null, null, 0.4, curve);

    const shaper = context._nodes.find(
      (n: AudioNode & { type?: string }) => (n as { type?: string }).type === 'WaveShaperNode',
    ) as { disconnect: ReturnType<typeof vi.fn> } | undefined;
    expect(shaper).toBeDefined();

    releaseStretchFxRouting(voice);
    expect(shaper!.disconnect).toHaveBeenCalled();
  });
});
