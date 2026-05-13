import { describe, it, expect } from 'vitest';
import { PatchBuilder } from '../patchBuilder';

describe('PatchBuilder', () => {
  it('creates a valid empty pattern', () => {
    const pattern = PatchBuilder.createEmptyPattern();
    expect(pattern.partA.steps).toHaveLength(16);
    expect(pattern.kick.steps).toHaveLength(16);
    expect(pattern.sampler).toHaveLength(8);
    expect(pattern.sampler[0].steps).toHaveLength(16);
  });

  it('creates valid note objects', () => {
    const note = PatchBuilder.createNote('C4', 0.9, 2.0, true);
    expect(note).toEqual({
      note: 'C4',
      velocity: 0.9,
      length: 2.0,
      slide: true,
      probability: 1.0
    });
  });

  it('creates default synth params', () => {
    const synth = PatchBuilder.createDefaultSynth();
    expect(synth.waveform).toBe('sawtooth');
    expect(synth.filterCutoff).toBe(2000);
  });

  it('creates specific synth presets', () => {
    const acid = PatchBuilder.createBass('acid');
    expect(acid.waveform).toBe('303-sqr');
    expect(acid.filterResonance).toBeGreaterThan(10);

    const pad = PatchBuilder.createPad('warm');
    expect(pad.attack).toBeGreaterThan(0.5);
    expect(pad.release).toBeGreaterThan(1.0);
  });

  it('creates drum params', () => {
    const kick = PatchBuilder.createKick('boomy');
    expect(kick.decay).toBe(0.8);

    const snare = PatchBuilder.createSnare('splashy');
    expect(snare.noise).toBe(0.8);
  });

  it('creates sampler bank params', () => {
    const bank = PatchBuilder.createSamplerBank('test_sample');
    expect(bank.sampleName).toBe('test_sample');
    expect(bank.mode).toBe('loop');
  });
});
