import { describe, it, expect, beforeEach } from 'vitest';
import {
  LATENCY_MODES,
  LATENCY_MODE_STORAGE_KEY,
  DEFAULT_LATENCY_MODE,
  isLatencyMode,
  getStoredLatencyMode,
  setStoredLatencyMode,
} from '../utils/audioLatencyMode';

describe('audioLatencyMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes the three Web Audio latency categories', () => {
    expect(LATENCY_MODES).toEqual(['interactive', 'balanced', 'playback']);
  });

  it('defaults to interactive when nothing is stored', () => {
    expect(getStoredLatencyMode()).toBe(DEFAULT_LATENCY_MODE);
    expect(DEFAULT_LATENCY_MODE).toBe('interactive');
  });

  it('round-trips a valid mode through localStorage', () => {
    setStoredLatencyMode('playback');
    expect(localStorage.getItem(LATENCY_MODE_STORAGE_KEY)).toBe('playback');
    expect(getStoredLatencyMode()).toBe('playback');
  });

  it('falls back to the default for an invalid stored value', () => {
    localStorage.setItem(LATENCY_MODE_STORAGE_KEY, 'bogus-mode');
    expect(getStoredLatencyMode()).toBe(DEFAULT_LATENCY_MODE);
  });

  it('validates candidate values with isLatencyMode', () => {
    expect(isLatencyMode('interactive')).toBe(true);
    expect(isLatencyMode('balanced')).toBe(true);
    expect(isLatencyMode('playback')).toBe(true);
    expect(isLatencyMode('turbo')).toBe(false);
    expect(isLatencyMode(null)).toBe(false);
    expect(isLatencyMode(undefined)).toBe(false);
  });
});
