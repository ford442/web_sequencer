/**
 * The one place an `OfflineAudioContext` is constructed (#1345 Phase 0).
 *
 * Every offline render — freeze, stem export, pattern bounce, multisample
 * generation, resampling, the renderer worker, `compileOfflineGraph` — asks
 * this module for its context, so two rules hold everywhere instead of at
 * fourteen call sites that each re-derived them:
 *
 * - **Sample rate.** An explicit `sampleRate` (a resample target, a source
 *   buffer's own rate) is taken verbatim. Otherwise the export policy decides
 *   (`resolveExportSampleRate`, #1136): `44100` / `48000` as chosen, `native`
 *   as the live `AudioContext` actually came up with.
 * - **Length.** Whole frames, rounded *up* (a render must never end a frame
 *   short of its duration) and never below 1 (`OfflineAudioContext` throws on
 *   a zero length).
 *
 * The constructor is looked up on `globalThis` at call time, so tests that
 * stub `OfflineAudioContext` keep working.
 */
import {
    resolveExportSampleRate,
    type SampleRatePref,
} from '../../utils/audioContextPolicy';

export interface OfflineContextSpec {
    /** Defaults to 2 — every bounce in the app is stereo unless it says otherwise. */
    channels?: number;
    /** Render length in frames. Give this or `durationSeconds`. */
    length?: number;
    /** Render length in seconds, converted at the resolved rate. */
    durationSeconds?: number;
    /** Explicit rate. When omitted, `sampleRatePref` + `liveSampleRate` decide. */
    sampleRate?: number;
    sampleRatePref?: SampleRatePref;
    /**
     * `AudioContext.sampleRate` of the running engine. `undefined` falls back to
     * the last live context recorded; `null` means "no live context".
     */
    liveSampleRate?: number | null;
}

/** Most channels an `OfflineAudioContext` is required to support. */
const MAX_OFFLINE_CHANNELS = 32;

export function resolveOfflineSampleRate(spec: Pick<OfflineContextSpec, 'sampleRate' | 'sampleRatePref' | 'liveSampleRate'>): number {
    if (spec.sampleRate !== undefined) {
        if (!Number.isFinite(spec.sampleRate) || spec.sampleRate <= 0) {
            throw new RangeError(`invalid offline sample rate: ${spec.sampleRate}`);
        }
        return spec.sampleRate;
    }
    return resolveExportSampleRate(spec.sampleRatePref, spec.liveSampleRate);
}

/** Whole frames, rounded up, at least 1. */
export function resolveOfflineLength(spec: Pick<OfflineContextSpec, 'length' | 'durationSeconds'>, sampleRate: number): number {
    const raw = spec.length ?? (spec.durationSeconds !== undefined ? spec.durationSeconds * sampleRate : NaN);
    if (!Number.isFinite(raw)) {
        throw new RangeError('offline render needs a finite length or durationSeconds');
    }
    return Math.max(1, Math.ceil(raw));
}

function resolveChannels(channels: number | undefined): number {
    const n = Math.round(channels ?? 2);
    return Math.min(MAX_OFFLINE_CHANNELS, Math.max(1, n));
}

export interface ResolvedOfflineSpec {
    channels: number;
    length: number;
    sampleRate: number;
}

export function resolveOfflineSpec(spec: OfflineContextSpec): ResolvedOfflineSpec {
    const sampleRate = resolveOfflineSampleRate(spec);
    return {
        channels: resolveChannels(spec.channels),
        length: resolveOfflineLength(spec, sampleRate),
        sampleRate,
    };
}

export function createOfflineContext(spec: OfflineContextSpec): OfflineAudioContext {
    const Ctor = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (typeof Ctor === 'undefined') {
        throw new Error('OfflineAudioContext is not available in this environment');
    }
    const { channels, length, sampleRate } = resolveOfflineSpec(spec);
    return new Ctor(channels, length, sampleRate);
}

/**
 * An empty `AudioBuffer` shaped like `spec`, for callers that only wrap
 * samples they already rendered (Pyodide output, mix-bus channels, padding).
 */
export function createOfflineBuffer(spec: OfflineContextSpec): AudioBuffer {
    const resolved = resolveOfflineSpec(spec);
    const ctx = createOfflineContext(resolved);
    return ctx.createBuffer(resolved.channels, resolved.length, resolved.sampleRate);
}
