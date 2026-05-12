import { describe, it, expect, vi } from 'vitest';
import { initializeMasterOutput } from '../initialization';

describe('initializeMasterOutput', () => {
    it('creates and assigns masterLimiterRef.current', () => {
        const context = new (window as any).AudioContext() as AudioContext;

        const masterGainRef = { current: null as GainNode | null };
        const masterPannerRef = { current: null as StereoPannerNode | null };
        const masterSaturationRef = { current: null as WaveShaperNode | null };
        const masterCompressorRef = { current: null as DynamicsCompressorNode | null };
        const sidechainGainRef = { current: null as GainNode | null };
        const masterLimiterRef = { current: null as WaveShaperNode | null };

        const result = initializeMasterOutput(
            context,
            masterGainRef,
            masterPannerRef,
            masterSaturationRef,
            masterCompressorRef,
            sidechainGainRef,
            masterLimiterRef,
        );

        expect(masterLimiterRef.current).not.toBeNull();
        expect(result).toBe(masterSaturationRef.current);
    });

    it('sets limiter curve and oversample properties', () => {
        const context = new (window as any).AudioContext() as AudioContext;

        const masterGainRef = { current: null as GainNode | null };
        const masterPannerRef = { current: null as StereoPannerNode | null };
        const masterSaturationRef = { current: null as WaveShaperNode | null };
        const masterCompressorRef = { current: null as DynamicsCompressorNode | null };
        const sidechainGainRef = { current: null as GainNode | null };
        const masterLimiterRef = { current: null as WaveShaperNode | null };

        initializeMasterOutput(
            context,
            masterGainRef,
            masterPannerRef,
            masterSaturationRef,
            masterCompressorRef,
            sidechainGainRef,
            masterLimiterRef,
        );

        const limiter = masterLimiterRef.current!;
        expect(limiter.curve).not.toBeNull();
        expect(limiter.oversample).toBe('4x');
    });
});
