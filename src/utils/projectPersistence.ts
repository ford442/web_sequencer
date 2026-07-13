// Project auto-save / session restore via localStorage.
//
// Design goals:
// - Zero-latency save: writes synchronously (localStorage is sync) on a
//   debounced timer so continuous edits don't thrash storage.
// - No sample audio data: embedded WAV blobs can be many MB per bank.
//   Auto-save strips `embeddedSamples` and `backgroundImage` (also potentially
//   large) to keep the payload small (< 50 KB in typical use). On restore the
//   user is notified that samples need to be reloaded.
// - Schema versioning: every saved object carries `autosaveVersion` so future
//   migrations can detect and upgrade stale formats.
// - All functions are pure / side-effect-free except for localStorage access,
//   making them trivially testable with a mock storage.

import type { SavedSongData } from '../types';

export const AUTOSAVE_KEY     = 'hyphon:autosave:v1';
export const AUTOSAVE_VERSION = 1;
// Maximum safe auto-save payload in bytes (~512 KB). If exceeded we silently skip.
const MAX_PAYLOAD_BYTES = 512 * 1024;

// ── Compact representation ────────────────────────────────────────────────────

/** Subset of SavedSongData that is safe to auto-save (no large binary blobs). */
export interface CompactSongData extends Omit<SavedSongData, 'embeddedSamples' | 'backgroundImage'> {
    autosaveVersion: number;
    savedAt: number;  // Unix ms timestamp
    /** true when embeddedSamples were present but stripped for size reasons. */
    samplesStripped?: boolean;
}

/** Strip large fields from a full SavedSongData before writing to localStorage. */
export function toCompactSongData(data: SavedSongData): CompactSongData {
    const { embeddedSamples, backgroundImage: _bg, ...rest } = data;
    return {
        ...rest,
        autosaveVersion: AUTOSAVE_VERSION,
        savedAt: Date.now(),
        samplesStripped: !!embeddedSamples && Object.keys(embeddedSamples).length > 0,
    };
}

// ── Storage backend (injectable for tests) ───────────────────────────────────

export interface StorageBackend {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const defaultStorage: StorageBackend = {
    getItem:    (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k)         : null),
    setItem:    (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
    removeItem: (k) => { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist a compact (no-blobs) snapshot to localStorage.
 * Silently skips if the payload exceeds MAX_PAYLOAD_BYTES to avoid quota errors.
 * Returns true on success, false when skipped or failed.
 */
export function saveSessionToLocalStorage(
    data: SavedSongData,
    storage: StorageBackend = defaultStorage,
): boolean {
    try {
        const compact = toCompactSongData(data);
        const json = JSON.stringify(compact);
        if (json.length > MAX_PAYLOAD_BYTES) {
            // Payload too large — skip silently rather than erroring.
            return false;
        }
        storage.setItem(AUTOSAVE_KEY, json);
        return true;
    } catch {
        // Storage quota exceeded or serialization failed — non-fatal.
        return false;
    }
}

/**
 * Retrieve and deserialise the most recent auto-saved session.
 * Returns null when no session exists or the stored data is corrupt/incompatible.
 */
export function loadSessionFromLocalStorage(
    storage: StorageBackend = defaultStorage,
): CompactSongData | null {
    try {
        const raw = storage.getItem(AUTOSAVE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CompactSongData;
        // Basic schema guard
        if (typeof parsed !== 'object' || parsed === null) return null;
        if (parsed.autosaveVersion !== AUTOSAVE_VERSION) return null;
        if (!parsed.pattern || typeof parsed.tempo !== 'number') return null;
        return parsed;
    } catch {
        return null;
    }
}

/** Remove any stored auto-save session. */
export function clearSessionFromLocalStorage(
    storage: StorageBackend = defaultStorage,
): void {
    storage.removeItem(AUTOSAVE_KEY);
}

/** True when a valid auto-save session exists in storage. */
export function hasStoredSession(
    storage: StorageBackend = defaultStorage,
): boolean {
    return loadSessionFromLocalStorage(storage) !== null;
}

// ── Debounced save helper ─────────────────────────────────────────────────────

/**
 * Creates a debounced save function.
 * Call `debouncedSave(data)` after every edit; it will write to localStorage
 * only after `delayMs` of inactivity. Returns a `cancel()` function for
 * cleanup on unmount.
 *
 * Usage:
 *   const { save, cancel } = makeAutoSave(1500);
 *   // inside a useEffect: save(songData); return cancel;
 */
export function makeAutoSave(
    delayMs = 1500,
    storage: StorageBackend = defaultStorage,
): { save: (data: SavedSongData) => void; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const save = (data: SavedSongData) => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
            saveSessionToLocalStorage(data, storage);
            timer = null;
        }, delayMs);
    };

    const cancel = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    return { save, cancel };
}
