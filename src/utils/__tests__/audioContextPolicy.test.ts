import { beforeEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_EXPORT_SAMPLE_RATE,
    SAMPLE_RATE_STORAGE_KEY,
    resolveExportSampleRate,
    setStoredSampleRatePref,
} from '../audioContextPolicy';

describe('resolveExportSampleRate', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('takes an explicit rate preference verbatim', () => {
        expect(resolveExportSampleRate(44100, 48000)).toBe(44100);
        expect(resolveExportSampleRate(48000, 44100)).toBe(48000);
    });

    it('resolves `native` to the live context rate, whatever the device gave us', () => {
        expect(resolveExportSampleRate('native', 96000)).toBe(96000);
        expect(resolveExportSampleRate('native', 44100)).toBe(44100);
    });

    it('falls back when there is no live context to read a rate from', () => {
        expect(resolveExportSampleRate('native', null)).toBe(DEFAULT_EXPORT_SAMPLE_RATE);
        expect(resolveExportSampleRate('native')).toBe(DEFAULT_EXPORT_SAMPLE_RATE);
    });

    it('ignores a live rate that is not a usable number', () => {
        expect(resolveExportSampleRate('native', 0)).toBe(DEFAULT_EXPORT_SAMPLE_RATE);
        expect(resolveExportSampleRate('native', Number.NaN)).toBe(DEFAULT_EXPORT_SAMPLE_RATE);
        expect(resolveExportSampleRate('native', -48000)).toBe(DEFAULT_EXPORT_SAMPLE_RATE);
    });

    it('defaults to the stored live policy, so export follows playback', () => {
        setStoredSampleRatePref(48000);
        expect(localStorage.getItem(SAMPLE_RATE_STORAGE_KEY)).toBe('48000');
        expect(resolveExportSampleRate()).toBe(48000);

        setStoredSampleRatePref('native');
        expect(resolveExportSampleRate(undefined, 88200)).toBe(88200);
    });
});
