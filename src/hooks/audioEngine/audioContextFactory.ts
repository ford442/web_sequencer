import { getStoredLatencyMode, type LatencyMode } from '../../utils/audioLatencyMode';
import {
    getStoredRenderSizeHintPref,
    getStoredSampleRatePref,
    readRenderQuantumSize,
    recordLiveSampleRate,
    supportsRenderSizeHint,
    toAudioContextRenderSizeHint,
    toAudioContextSampleRate,
    type RenderSizeHintPref,
    type SampleRatePref,
} from '../../utils/audioContextPolicy';
import { getStoredSinkIdForConstructor, supportsSinkIdOption } from '../../utils/audioOutputDevice';

type AudioContextWindow = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
};

/**
 * Chromium-only AudioContextOptions members not yet in lib.dom:
 * `renderSizeHint` (Web Audio 1.1, Chrome 125+) and `sinkId` (Chrome 110+).
 */
type ExtendedAudioContextOptions = AudioContextOptions & {
    renderSizeHint?: 'default' | 'hardware' | number;
    sinkId?: string;
};

export interface AudioContextCreation {
    context: AudioContext;
    latencyHint: LatencyMode;
    requestedSampleRate: number | null;
    actualSampleRate: number;
    sampleRateFallback: string | null;
    /** `renderSizeHint` passed to the constructor, or null when omitted. */
    requestedRenderSizeHint: 'hardware' | number | null;
    /** Quantum the context actually renders at, when the browser exposes it. */
    renderQuantumSize: number | null;
    /** Why a requested renderSizeHint / sinkId was dropped (null if honoured or not requested). */
    optionFallback: string | null;
    /** deviceId passed as `sinkId` in the constructor, or null when not passed. */
    constructorSinkId: string | null;
}

export interface AudioContextCreateExtras {
    /** Defaults to the persisted pref; ignored where the browser lacks the field. */
    renderSizeHintPref?: RenderSizeHintPref;
    /** deviceId for `AudioContextOptions.sinkId`; defaults to the stored output's last id. */
    sinkId?: string | null;
}

/**
 * Construct the live-playback AudioContext with an explicit latencyHint and
 * optional sampleRate / renderSizeHint / sinkId. Device-native is the default
 * (omit sampleRate). A failed or ignored optional member falls back without
 * crashing init: the Chromium-only members are dropped first, then the rate.
 *
 * Synchronous on purpose — callers construct from inside a user gesture
 * (StartOverlay, HUD "Apply") and must not await anything before `resume()`.
 */
export function createAudioContext(
    latencyHint: LatencyMode = getStoredLatencyMode(),
    sampleRatePref: SampleRatePref = getStoredSampleRatePref(),
    extras: AudioContextCreateExtras = {},
): AudioContextCreation {
    const audioWindow = window as AudioContextWindow;
    const AudioContextCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextCtor) {
        throw new Error('AudioContext is not available in this browser');
    }

    const requested = toAudioContextSampleRate(sampleRatePref) ?? null;
    const baseOptions: ExtendedAudioContextOptions = { latencyHint };

    const renderSizeHint = supportsRenderSizeHint(AudioContextCtor)
        ? toAudioContextRenderSizeHint(extras.renderSizeHintPref ?? getStoredRenderSizeHintPref()) ?? null
        : null;
    const sinkId = supportsSinkIdOption(AudioContextCtor)
        ? (extras.sinkId !== undefined ? extras.sinkId : getStoredSinkIdForConstructor())
        : null;
    const chromiumOptions: ExtendedAudioContextOptions = {};
    if (renderSizeHint != null) chromiumOptions.renderSizeHint = renderSizeHint;
    if (sinkId) chromiumOptions.sinkId = sinkId;
    const hasChromiumOptions = Object.keys(chromiumOptions).length > 0;

    let optionFallback: string | null = null;
    // A stale deviceId (unplugged interface) or an out-of-range quantum makes
    // the constructor throw NotFoundError / NotSupportedError. Retry without
    // those members before touching the sample-rate request.
    const construct = (options: ExtendedAudioContextOptions): AudioContext => {
        optionFallback = null;
        if (hasChromiumOptions) {
            try {
                return new AudioContextCtor({ ...options, ...chromiumOptions } as AudioContextOptions);
            } catch (err) {
                optionFallback = `ctor-threw-options:${Object.keys(chromiumOptions).join('+')}`
                    + (err instanceof Error && err.name ? `:${err.name}` : '');
            }
        }
        return new AudioContextCtor(options);
    };

    const finish = (
        context: AudioContext,
        sampleRateFallback: string | null,
    ): AudioContextCreation => {
        const honoured = optionFallback == null;
        recordLiveSampleRate(context.sampleRate);
        return {
            context,
            latencyHint,
            requestedSampleRate: requested,
            actualSampleRate: context.sampleRate,
            sampleRateFallback,
            requestedRenderSizeHint: renderSizeHint,
            renderQuantumSize: readRenderQuantumSize(context),
            optionFallback,
            constructorSinkId: honoured && sinkId ? sinkId : null,
        };
    };

    if (requested == null) {
        return finish(construct(baseOptions), null);
    }

    try {
        const context = construct({ ...baseOptions, sampleRate: requested });
        if (context.sampleRate !== requested) {
            return finish(context, `browser-ignored-sampleRate:${requested}->${context.sampleRate}`);
        }
        return finish(context, null);
    } catch {
        return finish(construct(baseOptions), `ctor-threw-sampleRate:${requested}`);
    }
}
