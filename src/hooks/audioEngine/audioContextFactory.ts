import { getStoredLatencyMode, type LatencyMode } from '../../utils/audioLatencyMode';
import { getStoredSampleRatePref, toAudioContextSampleRate, type SampleRatePref } from '../../utils/audioContextPolicy';

type AudioContextWindow = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
};

export interface AudioContextCreation {
    context: AudioContext;
    requestedSampleRate: number | null;
    actualSampleRate: number;
    sampleRateFallback: string | null;
}

/**
 * Construct the live-playback AudioContext with an explicit latencyHint and
 * optional sampleRate. Device-native is the default (omit sampleRate).
 * A failed or ignored rate request falls back to native without crashing init.
 */
export function createAudioContext(
    latencyHint: LatencyMode = getStoredLatencyMode(),
    sampleRatePref: SampleRatePref = getStoredSampleRatePref(),
): AudioContextCreation {
    const audioWindow = window as AudioContextWindow;
    const AudioContextCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextCtor) {
        throw new Error('AudioContext is not available in this browser');
    }

    const requested = toAudioContextSampleRate(sampleRatePref) ?? null;
    const baseOptions: AudioContextOptions = { latencyHint };

    const construct = (options: AudioContextOptions): AudioContext => new AudioContextCtor(options);

    if (requested == null) {
        const context = construct(baseOptions);
        return {
            context,
            requestedSampleRate: null,
            actualSampleRate: context.sampleRate,
            sampleRateFallback: null,
        };
    }

    try {
        const context = construct({ ...baseOptions, sampleRate: requested });
        if (context.sampleRate !== requested) {
            return {
                context,
                requestedSampleRate: requested,
                actualSampleRate: context.sampleRate,
                sampleRateFallback: `browser-ignored-sampleRate:${requested}->${context.sampleRate}`,
            };
        }
        return {
            context,
            requestedSampleRate: requested,
            actualSampleRate: context.sampleRate,
            sampleRateFallback: null,
        };
    } catch {
        const context = construct(baseOptions);
        return {
            context,
            requestedSampleRate: requested,
            actualSampleRate: context.sampleRate,
            sampleRateFallback: `ctor-threw-sampleRate:${requested}`,
        };
    }
}
