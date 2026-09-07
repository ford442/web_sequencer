import { describe, it, expect, beforeEach } from 'vitest';
import {
  AUDIO_OUTPUT_STORAGE_KEY,
  getStoredAudioOutput,
  setStoredAudioOutput,
  supportsSetSinkId,
} from '../audioOutputDevice';

describe('audioOutputDevice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips groupId and label', () => {
    expect(getStoredAudioOutput()).toBeNull();
    setStoredAudioOutput({ groupId: 'g1', label: 'Speakers' });
    expect(JSON.parse(localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY) ?? '{}')).toEqual({
      groupId: 'g1',
      label: 'Speakers',
    });
    expect(getStoredAudioOutput()).toEqual({ groupId: 'g1', label: 'Speakers' });
    setStoredAudioOutput(null);
    expect(getStoredAudioOutput()).toBeNull();
  });

  it('feature-detects setSinkId on AudioContext.prototype', () => {
    expect(typeof supportsSetSinkId()).toBe('boolean');
  });
});
