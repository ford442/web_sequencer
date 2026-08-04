/**
 * Persistence for the master limiter settings.
 *
 * Only primitives are stored, and every field is re-validated on load: a
 * corrupted or hand-edited entry falls back to the default rather than feeding
 * NaN into the audio thread.
 */

import { DEFAULT_LIMITER_SETTINGS, type LimiterSettings } from './types';
import { MAX_LOOKAHEAD_MS } from './limiter';

export const LIMITER_STORAGE_KEY = 'hyphon.masterLimiter.v1';

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
        ? value
        : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

/** Coerce arbitrary parsed JSON into valid limiter settings. */
export function sanitizeLimiterSettings(raw: unknown): LimiterSettings {
    const source = (raw ?? {}) as Partial<Record<keyof LimiterSettings, unknown>>;
    const d = DEFAULT_LIMITER_SETTINGS;
    return {
        enabled: boolOr(source.enabled, d.enabled),
        monitorOnly: boolOr(source.monitorOnly, d.monitorOnly),
        ceilingDbtp: numberIn(source.ceilingDbtp, -24, 0, d.ceilingDbtp),
        attackMs: numberIn(source.attackMs, 0.01, 100, d.attackMs),
        releaseMs: numberIn(source.releaseMs, 1, 5000, d.releaseMs),
        lookaheadMs: numberIn(source.lookaheadMs, 0, MAX_LOOKAHEAD_MS, d.lookaheadMs),
    };
}

/** Load persisted limiter settings; never throws. */
export function loadLimiterSettings(storage?: Storage): LimiterSettings {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!store) return { ...DEFAULT_LIMITER_SETTINGS };
    try {
        const raw = store.getItem(LIMITER_STORAGE_KEY);
        return raw ? sanitizeLimiterSettings(JSON.parse(raw)) : { ...DEFAULT_LIMITER_SETTINGS };
    } catch {
        return { ...DEFAULT_LIMITER_SETTINGS };
    }
}

/** Persist limiter settings; never throws (private mode, quota, SSR). */
export function saveLimiterSettings(settings: LimiterSettings, storage?: Storage): void {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!store) return;
    try {
        store.setItem(LIMITER_STORAGE_KEY, JSON.stringify(sanitizeLimiterSettings(settings)));
    } catch {
        // Persisting master settings must never break playback.
    }
}
