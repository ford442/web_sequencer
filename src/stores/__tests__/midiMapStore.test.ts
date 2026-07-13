import { describe, it, expect, beforeEach } from 'vitest';
import { midiMapStore } from '../../stores/midiMapStore';
import { makeMidiControlId } from '../../types/midi';

describe('midiMapStore', () => {
  beforeEach(() => {
    localStorage.clear();
    midiMapStore.reset();
  });

  it('adds and finds a binding', () => {
    const controlId = makeMidiControlId('synthA', 'filterCutoff');
    midiMapStore.addBinding({
      key: { type: 'cc', channel: 0, number: 1 },
      controlId,
    });
    const found = midiMapStore.findBinding({ type: 'cc', channel: 0, number: 1 });
    expect(found?.controlId).toBe(controlId);
    expect(midiMapStore.isControlMapped(controlId)).toBe(true);
  });

  it('replaces binding on same MIDI key', () => {
    midiMapStore.addBinding({
      key: { type: 'cc', channel: 0, number: 7 },
      controlId: makeMidiControlId('kick', 'pitch'),
    });
    midiMapStore.addBinding({
      key: { type: 'cc', channel: 0, number: 7 },
      controlId: makeMidiControlId('kick', 'decay'),
    });
    expect(midiMapStore.getState().mappings).toHaveLength(1);
    expect(midiMapStore.getState().mappings[0].controlId).toBe('kick:decay');
  });

  it('persists to localStorage', () => {
    midiMapStore.addBinding({
      key: { type: 'cc', channel: 1, number: 10 },
      controlId: makeMidiControlId('master', 'volume'),
    });
    midiMapStore.reset();
    const reloaded = midiMapStore.getState().mappings;
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].controlId).toBe('master:volume');
  });

  it('clears bindings for a control', () => {
    const id = makeMidiControlId('snare', 'tone');
    midiMapStore.addBinding({ key: { type: 'cc', channel: 0, number: 2 }, controlId: id });
    midiMapStore.clearBindingsForControl(id);
    expect(midiMapStore.isControlMapped(id)).toBe(false);
  });
});
