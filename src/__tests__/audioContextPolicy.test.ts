import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SAMPLE_RATE_PREF,
  SAMPLE_RATE_STORAGE_KEY,
  getStoredSampleRatePref,
  parseSampleRatePref,
  setStoredSampleRatePref,
  toAudioContextSampleRate,
} from '../utils/audioContextPolicy';

describe('audioContextPolicy', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to device native', () => {
    expect(getStoredSampleRatePref()).toBe(DEFAULT_SAMPLE_RATE_PREF);
    expect(toAudioContextSampleRate('native')).toBeUndefined();
  });

  it('round-trips 44100 and 48000 through localStorage', () => {
    setStoredSampleRatePref(44100);
    expect(localStorage.getItem(SAMPLE_RATE_STORAGE_KEY)).toBe('44100');
    expect(getStoredSampleRatePref()).toBe(44100);
    expect(toAudioContextSampleRate(44100)).toBe(44100);

    setStoredSampleRatePref(48000);
    expect(getStoredSampleRatePref()).toBe(48000);
    expect(toAudioContextSampleRate(48000)).toBe(48000);
  });

  it('falls back to native for invalid stored values', () => {
    localStorage.setItem(SAMPLE_RATE_STORAGE_KEY, '96000');
    expect(getStoredSampleRatePref()).toBe('native');
  });

  it('parses stored strings', () => {
    expect(parseSampleRatePref('native')).toBe('native');
    expect(parseSampleRatePref('44100')).toBe(44100);
    expect(parseSampleRatePref('bogus')).toBeNull();
  });
});
