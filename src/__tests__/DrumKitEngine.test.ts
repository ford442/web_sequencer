/**
 * Tests for DrumKitEngine and DrumKitPresets
 */
import { describe, it, expect } from 'vitest';
import { DrumKitEngine } from '../engines/DrumKitEngine';
import { DRUM_KIT_PRESETS, getDrumKitDefaults, PRESET_808, PRESET_909 } from '../engines/DrumKitPresets';

describe('DrumKitPresets', () => {
  it('provides 808 and 909 presets', () => {
    expect(DRUM_KIT_PRESETS['808']).toBeDefined();
    expect(DRUM_KIT_PRESETS['909']).toBeDefined();
  });

  it('808 preset has deeper kick (lower pitch)', () => {
    expect(PRESET_808.kick.pitch).toBeLessThan(PRESET_909.kick.pitch);
  });

  it('808 preset has longer kick decay', () => {
    expect(PRESET_808.kick.decay).toBeGreaterThan(PRESET_909.kick.decay);
  });

  it('909 preset has higher snare tone', () => {
    expect(PRESET_909.snare.tone).toBeGreaterThan(PRESET_808.snare.tone);
  });

  it('909 preset has more snare noise (crispier)', () => {
    expect(PRESET_909.snare.noise).toBeGreaterThan(PRESET_808.snare.noise);
  });

  it('getDrumKitDefaults returns correct preset', () => {
    const defaults808 = getDrumKitDefaults('808');
    expect(defaults808.name).toBe('TR-808');
    expect(defaults808.kick.pitch).toBe(50);

    const defaults909 = getDrumKitDefaults('909');
    expect(defaults909.name).toBe('TR-909');
    expect(defaults909.kick.pitch).toBe(65);
  });
});

describe('DrumKitEngine', () => {
  it('initializes with default 808 kit', () => {
    const engine = new DrumKitEngine();
    expect(engine.kitType).toBe('808');
  });

  it('initializes with specified kit type', () => {
    const engine = new DrumKitEngine('909');
    expect(engine.kitType).toBe('909');
  });

  it('setKit changes the active kit', () => {
    const engine = new DrumKitEngine('808');
    expect(engine.kitType).toBe('808');
    engine.setKit('909');
    expect(engine.kitType).toBe('909');
    engine.setKit('808');
    expect(engine.kitType).toBe('808');
  });
});
