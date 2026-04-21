import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SingingVoice } from '../engines/SingingVoice';
// Open303Oscillator tests removed as it no longer supports fallback

// Mock AudioContext and related APIs
beforeEach(() => {
    vi.clearAllMocks();
});

describe('AudioWorklet Fallback Support', () => {
    // Tests removed, fallback support is dropped from engines.
    it('is a placeholder', () => {
        expect(true).toBe(true);
    });
});
