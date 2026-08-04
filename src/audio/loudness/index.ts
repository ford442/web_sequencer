/**
 * Master-bus loudness suite: BS.1770-5 metering + true-peak limiting.
 *
 * The same DSP runs in the real-time AudioWorklet and in the offline export
 * path, which is what keeps the live meters and the rendered file in agreement.
 */

export { KWeightingFilter, shelfCoefficients, highPassCoefficients } from './kWeighting';
export type { BiquadCoefficients } from './kWeighting';

export {
    TruePeakDetector,
    buildPolyphaseCoefficients,
    measureTruePeakDbtp,
    oversamplingFactorFor,
    linearToDb,
    dbToLinear,
    TAPS_PER_PHASE,
} from './truePeak';

export { LoudnessMeter, meanSquareToLufs } from './loudnessMeter';
export type { LoudnessMeterOptions } from './loudnessMeter';

export { TruePeakLimiter, MAX_LOOKAHEAD_MS } from './limiter';

export {
    analyzeLoudness,
    analyzeAudioBufferLoudness,
    normalizeToTarget,
    formatLufs,
} from './offline';
export type { LoudnessReport, NormalizeResult } from './offline';

export {
    loadLimiterSettings,
    saveLimiterSettings,
    sanitizeLimiterSettings,
    LIMITER_STORAGE_KEY,
} from './settings';

export {
    MasterLoudnessStage,
    createMasterLoudnessStage,
    IDLE_LOUDNESS_STATS,
} from './masterLoudnessStage';
export type { LoudnessStatsListener, MasterLoudnessStageOptions } from './masterLoudnessStage';

export {
    setMasterLoudnessStage,
    getMasterLoudnessStage,
    subscribeMasterLoudnessStage,
} from './registry';

export {
    DEFAULT_LIMITER_SETTINGS,
    LOUDNESS_TARGETS,
    MASTER_LOUDNESS_PROCESSOR_NAME,
    SILENCE_LUFS,
} from './types';
export type {
    LimiterSettings,
    LoudnessStats,
    LoudnessTargetKey,
    MasterLoudnessCommand,
    MasterLoudnessReport,
} from './types';
