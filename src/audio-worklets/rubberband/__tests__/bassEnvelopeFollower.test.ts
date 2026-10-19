import { describe, expect, it } from 'vitest';
import {
  BASS_ENV_ATTACK_SECONDS,
  BASS_ENV_RELEASE_SECONDS,
  BassEnvelopeFollower,
} from '../bassEnvelopeFollower';
import { BASS_TRIGGER_STRIDE, SidechainRingWriter, createSidechainRing } from '../../../utils/sidechainTriggerRing';
import { SingingVoiceManager } from '../../../engines/SingingVoiceManager';

const SR = 48000;
const BLOCK = 128;
const DT = BLOCK / SR;

function setup(options?: ConstructorParameters<typeof BassEnvelopeFollower>[0]) {
  const sab = createSidechainRing(BASS_TRIGGER_STRIDE);
  const writer = new SidechainRingWriter(sab);
  const follower = new BassEnvelopeFollower(options);
  return { sab, follower, push: (t: number, v: number, d: number) => writer.push([t, v, d]) };
}

/** Envelope per block from t0 for `seconds`. */
function trace(f: BassEnvelopeFollower, sab: SharedArrayBuffer, t0: number, seconds: number): number[] {
  const out: number[] = [];
  for (let t = t0; t < t0 + seconds; t += DT) out.push(f.process(sab, t, BLOCK, SR));
  return out;
}

describe('BassEnvelopeFollower', () => {
  it('returns 0 without a sidechain', () => {
    expect(new BassEnvelopeFollower().process(null, 0, BLOCK, SR)).toBe(0);
  });

  it('ramps up over the attack, holds for the duration, then releases exponentially', () => {
    const { sab, follower, push } = setup();
    push(0, 0.8, 0.2);
    const env = trace(follower, sab, 0, 0.6);

    // Slew is full scale per attack time, so a 0.8 peak takes 0.8 of it.
    const attackBlocks = Math.ceil((0.8 * BASS_ENV_ATTACK_SECONDS * SR) / BLOCK);
    // No step to the peak: the first block is a fraction of it, rising monotonically.
    expect(env[0]).toBeGreaterThan(0);
    expect(env[0]).toBeLessThan(0.8 / 2);
    for (let i = 1; i < attackBlocks; i++) expect(env[i]).toBeGreaterThan(env[i - 1]);
    expect(env[attackBlocks]).toBeCloseTo(0.8, 9);

    // Held until the 0.2 s duration.
    const holdEnd = Math.floor(0.2 / DT);
    expect(env[holdEnd - 1]).toBeCloseTo(0.8, 9);
    // One release time constant later, about 1/e of the peak.
    const tau = Math.round(BASS_ENV_RELEASE_SECONDS / DT);
    expect(env[holdEnd + tau]).toBeCloseTo(0.8 / Math.E, 1);
    expect(env[env.length - 1]).toBeLessThan(0.8 * 0.02);
  });

  it('release time is configurable', () => {
    const fast = setup({ releaseSeconds: 0.02 });
    const slow = setup({ releaseSeconds: 0.3 });
    fast.push(0, 1, 0.05);
    slow.push(0, 1, 0.05);
    const a = trace(fast.follower, fast.sab, 0, 0.2);
    const b = trace(slow.follower, slow.sab, 0, 0.2);
    expect(a[a.length - 1]).toBeLessThan(b[b.length - 1] * 0.1);
  });

  it('dense 16th retriggers written ahead each retrigger the envelope (none lost)', () => {
    const { sab, follower, push } = setup({ releaseSeconds: 0.01 });
    const sixteenth = 60 / 174 / 4;
    const notes = Array.from({ length: 8 }, (_, i) => 1 + i * sixteenth);
    // Whole bar posted before the worklet reaches any of it.
    for (const t of notes) push(t, 1, sixteenth / 4);
    const env = trace(follower, sab, 0.99, 8 * sixteenth + 0.05);
    // Count rising edges from near-silence: one per note.
    let onsets = 0;
    for (let i = 1; i < env.length; i++) if (env[i - 1] < 0.1 && env[i] >= 0.1) onsets++;
    expect(onsets).toBe(notes.length);
  });

  it('a lower-velocity retrigger slews down instead of stepping', () => {
    const { sab, follower, push } = setup();
    push(0, 1, 1);
    trace(follower, sab, 0, 0.05);
    push(0.05, 0.2, 1);
    const next = follower.process(sab, 0.05, BLOCK, SR);
    expect(next).toBeLessThan(1);
    expect(next).toBeGreaterThan(0.2);
  });

  it('never leaves 0..1 even for an un-normalised velocity, so grain size never goes negative', () => {
    const { sab, follower, push } = setup();
    push(0, 100, 0.1); // a raw MIDI velocity
    const env = trace(follower, sab, 0, 0.3);
    for (const e of env) {
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
    // The grain-size shrink (1 - env * depth) stays within [0, 1] at full depth.
    expect(Math.min(...env.map((e) => 1 - e * 1))).toBeGreaterThanOrEqual(0);
  });
});

describe('SingingVoiceManager trigger writers', () => {
  it('normalise velocity to 0..1 and publish to the rings the worklet reads', () => {
    const manager = new SingingVoiceManager(new AudioContext(), 1);
    const follower = new BassEnvelopeFollower({ attackSeconds: 0 });
    manager.pushBassTrigger(0, 1.7, 0.5);
    expect(follower.process(manager.getBassSidechainSAB(), 0, BLOCK, SR)).toBe(1);
    manager.pushBassTrigger(1, -3, 0.5);
    expect(follower.process(manager.getBassSidechainSAB(), 1, BLOCK, SR)).toBe(0);
  });
});

describe('GranularEngine grain size under the bass envelope', () => {
  const grainSize = async (bassEnvelopeValue: number, bassEnvDepth: number): Promise<number> => {
    const { GranularEngine } = await import('../granularEngine');
    const engine = new GranularEngine(() => 0.5);
    const buf = new Float32Array(SR);
    engine.renderGrains({
      fullSampleBuffer: buf, sampleRate: SR, hasPhonemeContext: false, phonemeVolume: 1, isVowel: 1,
      phonemeGrainJitter: -1, phonemeGrainSizeMs: -1, currentSamplePtr: SR / 2, startSamplePtr: 0, endSamplePtr: SR,
      duckingScalar: 0, envelopeValue: 0, grainJitterParam: 0, grainEnvDepth: 0, windowShape: 0,
      grainLfoDepth: 0, grainPosLfoDepth: 0, timeSmear: 0, velocity: 1, bassEnvelopeValue, bassEnvDepth,
    }, new Float32Array(BLOCK), 0, BLOCK);
    return (engine as unknown as { grains: Array<{ size: number }> }).grains[0].size;
  };

  it('shrinks with env × depth and clamps at 256 samples', async () => {
    const base = await grainSize(0, 0);
    expect(base).toBe(Math.floor(SR * 0.1));
    expect(await grainSize(0.5, 1)).toBe(base / 2);
    expect(await grainSize(1, 0.5)).toBe(base / 2);
    expect(await grainSize(1, 1)).toBe(256);
  });
});
