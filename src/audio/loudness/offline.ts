/**
 * Offline loudness analysis and normalisation for the export / freeze paths.
 *
 * Uses exactly the same DSP as the real-time master worklet, so the numbers a
 * user reads while monitoring and the numbers measured in the rendered file
 * agree (the only permitted difference is a higher true-peak oversampling
 * factor offline, which can only make the reported dBTP more accurate).
 */

import { LoudnessMeter } from './loudnessMeter';
import { TruePeakLimiter } from './limiter';
import { dbToLinear, linearToDb } from './truePeak';
import {
    DEFAULT_LIMITER_SETTINGS,
    LOUDNESS_TARGETS,
    SILENCE_LUFS,
    type LimiterSettings,
    type LoudnessTargetKey,
} from './types';

export interface LoudnessReport {
    /** Gated integrated loudness, LUFS (`-Infinity` for silence). */
    integrated: number;
    /** Maximum short-term loudness observed, LUFS. */
    maxShortTerm: number;
    /** Maximum momentary loudness observed, LUFS. */
    maxMomentary: number;
    /** True peak, dBTP. */
    truePeak: number;
    /** Sample peak, dBFS. */
    samplePeak: number;
}

function channelsOf(buffer: AudioBuffer): Float32Array[] {
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
        channels.push(buffer.getChannelData(ch));
    }
    return channels;
}

/** Analysis chunk size — matches the render quantum so results match live. */
const ANALYSIS_BLOCK = 128;

/**
 * Measure BS.1770 loudness and true peak of raw channel data.
 *
 * `truePeakFactor` defaults to the real-time factor; pass 8 for a stricter
 * offline reading (the delta versus live stays well inside 0.1 dBTP).
 */
export function analyzeLoudness(
    channels: readonly Float32Array[],
    sampleRate: number,
    truePeakFactor?: number,
): LoudnessReport {
    const meter = new LoudnessMeter({
        sampleRate,
        channelCount: Math.max(1, channels.length),
        truePeakFactor,
    });

    const frames = channels[0]?.length ?? 0;
    const views: Float32Array[] = new Array(channels.length);
    let maxMomentary = SILENCE_LUFS;
    let maxShortTerm = SILENCE_LUFS;

    for (let offset = 0; offset < frames; offset += ANALYSIS_BLOCK) {
        const size = Math.min(ANALYSIS_BLOCK, frames - offset);
        for (let ch = 0; ch < channels.length; ch += 1) {
            views[ch] = channels[ch].subarray(offset, offset + size);
        }
        meter.process(views, size);
        if (meter.momentary > maxMomentary) maxMomentary = meter.momentary;
        if (meter.shortTerm > maxShortTerm) maxShortTerm = meter.shortTerm;
    }

    return {
        integrated: meter.integrated,
        maxShortTerm,
        maxMomentary,
        truePeak: meter.truePeakDb,
        samplePeak: meter.samplePeakDb,
    };
}

/** Convenience wrapper for an AudioBuffer (export / freeze render output). */
export function analyzeAudioBufferLoudness(
    buffer: AudioBuffer,
    truePeakFactor?: number,
): LoudnessReport {
    return analyzeLoudness(channelsOf(buffer), buffer.sampleRate, truePeakFactor);
}

export interface NormalizeResult extends LoudnessReport {
    /** Linear gain applied to reach the target. */
    appliedGain: number;
    /** Target the render was normalised to, LUFS. */
    targetLufs: number;
    /** Loudness after normalisation + limiting, LUFS. */
    resultingIntegrated: number;
    /** True peak after normalisation + limiting, dBTP. */
    resultingTruePeak: number;
}

/**
 * Normalise channel data in place to `target` LUFS, then run the true-peak
 * limiter so the ceiling still holds after the gain change.
 *
 * Returns the pre-normalisation report plus what was actually achieved —
 * a loud master pushed to -9 LUFS can fall short once the limiter engages,
 * and the caller should surface that rather than assume the target was met.
 */
export function normalizeToTarget(
    channels: Float32Array[],
    sampleRate: number,
    target: number | LoudnessTargetKey = 'streaming',
    limiterSettings: Partial<LimiterSettings> = {},
): NormalizeResult {
    const targetLufs = typeof target === 'number' ? target : LOUDNESS_TARGETS[target];
    const report = analyzeLoudness(channels, sampleRate);

    let appliedGain = 1;
    if (Number.isFinite(report.integrated)) {
        appliedGain = dbToLinear(targetLufs - report.integrated);
    }

    const settings: LimiterSettings = {
        ...DEFAULT_LIMITER_SETTINGS,
        ...limiterSettings,
        enabled: true,
        monitorOnly: false,
    };
    const limiter = new TruePeakLimiter(sampleRate, Math.max(1, channels.length), settings);

    const frames = channels[0]?.length ?? 0;
    const scratch: Float32Array[] = channels.map(() => new Float32Array(ANALYSIS_BLOCK));
    const outViews: Float32Array[] = new Array(channels.length);

    for (let offset = 0; offset < frames; offset += ANALYSIS_BLOCK) {
        const size = Math.min(ANALYSIS_BLOCK, frames - offset);
        for (let ch = 0; ch < channels.length; ch += 1) {
            const source = channels[ch];
            const block = scratch[ch];
            for (let i = 0; i < size; i += 1) {
                block[i] = source[offset + i] * appliedGain;
            }
            outViews[ch] = source.subarray(offset, offset + size);
        }
        limiter.process(scratch, outViews, size);
    }

    const after = analyzeLoudness(channels, sampleRate);
    return {
        ...report,
        appliedGain,
        targetLufs,
        resultingIntegrated: after.integrated,
        resultingTruePeak: after.truePeak,
    };
}

/** Format a loudness value for UI/report text (`-inf` for silence). */
export function formatLufs(value: number, digits = 1): string {
    return Number.isFinite(value) ? value.toFixed(digits) : '-inf';
}

export { linearToDb, dbToLinear };
