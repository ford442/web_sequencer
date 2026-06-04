// Voice preset system for SamplerBankParams.
//
// Presets carry a partial SamplerBankParams — only the params that define the
// voice character are set, leaving mechanical params (sampleName, delaySend, etc.)
// untouched so that `applyPreset` merges cleanly with the user's current bank.
//
// Built-in presets are immutable constants. User presets are stored in localStorage
// under STORAGE_KEY and loaded/saved via the exported helpers.

import type { SamplerBankParams } from '../types';

const STORAGE_KEY = 'hyphon:voicePresets:v1';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoicePreset {
    id: string;
    name: string;
    description: string;
    /** Short category tags for filtering (e.g. ['vocal', 'warm']). */
    tags: string[];
    isBuiltIn: boolean;
    /** Partial params — only the voice-shaping fields are stored. */
    params: Partial<SamplerBankParams>;
    createdAt?: number;
}

// ── Built-in presets ──────────────────────────────────────────────────────────

export const BUILT_IN_PRESETS: VoicePreset[] = [
    {
        id: 'builtin:clean',
        name: 'Clean',
        description: 'Unprocessed — full-range filter, no drive or modulation. Good starting point.',
        tags: ['neutral', 'clean'],
        isBuiltIn: true,
        params: {
            filterCutoff: 20000,
            filterResonance: 0,
            drive: 0,
            formantShift: 0,
            vibratoDepth: 0,
            tremoloDepth: 0,
            breathIntensity: 0,
            choir: 0,
            bitcrush: 0,
            downsample: 0,
            attack: 0.01,
            decay: 0.3,
            expressiveness: { vibratoRate: 5.5, vibratoDepth: 0, tremoloDepth: 0, breathAmount: 0 },
        },
    },
    {
        id: 'builtin:warm-vocal',
        name: 'Warm Vocal',
        description: 'Low-pass filtered with gentle breath and vibrato. Intimate, close-mic feel.',
        tags: ['vocal', 'warm', 'expressive'],
        isBuiltIn: true,
        params: {
            filterCutoff: 6000,
            filterResonance: 0.8,
            drive: 0.05,
            formantShift: 0.1,
            vibratoDepth: 0.04,
            tremoloDepth: 0.02,
            breathIntensity: 0.15,
            choir: 0,
            attack: 0.04,
            decay: 0.4,
            expressiveness: { vibratoRate: 5.2, vibratoDepth: 0.04, tremoloDepth: 0.02, breathAmount: 0.15 },
        },
    },
    {
        id: 'builtin:bright-synth',
        name: 'Bright Synth',
        description: 'Open filter, slight drive and formant raise. Electronic vocal-synth character.',
        tags: ['synth', 'bright', 'electronic'],
        isBuiltIn: true,
        params: {
            filterCutoff: 18000,
            filterResonance: 1.5,
            drive: 0.2,
            formantShift: 0.25,
            vibratoDepth: 0,
            tremoloDepth: 0,
            breathIntensity: 0,
            choir: 0.1,
            attack: 0.005,
            decay: 0.15,
            expressiveness: { vibratoRate: 6, vibratoDepth: 0, tremoloDepth: 0, breathAmount: 0 },
        },
    },
    {
        id: 'builtin:sub-bass',
        name: 'Sub Bass',
        description: 'Heavy low-pass, no formant shift. Best for bass samples pitched down.',
        tags: ['bass', 'deep', 'low'],
        isBuiltIn: true,
        params: {
            filterCutoff: 200,
            filterResonance: 0.3,
            drive: 0.1,
            formantShift: -0.3,
            vibratoDepth: 0,
            tremoloDepth: 0,
            breathIntensity: 0,
            choir: 0,
            attack: 0.02,
            decay: 0.6,
            expressiveness: { vibratoRate: 5.5, vibratoDepth: 0, tremoloDepth: 0, breathAmount: 0 },
        },
    },
    {
        id: 'builtin:choir',
        name: 'Choir',
        description: 'Wide choir ensemble with slow vibrato and breath noise. Lush and spatial.',
        tags: ['vocal', 'choir', 'lush', 'expressive'],
        isBuiltIn: true,
        params: {
            filterCutoff: 8000,
            filterResonance: 0.4,
            drive: 0,
            formantShift: 0,
            vibratoDepth: 0.06,
            tremoloDepth: 0.03,
            breathIntensity: 0.2,
            choir: 0.7,
            attack: 0.12,
            decay: 0.8,
            expressiveness: { vibratoRate: 4.8, vibratoDepth: 0.06, tremoloDepth: 0.03, breathAmount: 0.2 },
        },
    },
    {
        id: 'builtin:glitch',
        name: 'Glitch',
        description: 'Bitcrushed, downsampled, aggressive drive. Industrial / lo-fi character.',
        tags: ['glitch', 'lo-fi', 'electronic', 'aggressive'],
        isBuiltIn: true,
        params: {
            filterCutoff: 12000,
            filterResonance: 2,
            drive: 0.6,
            formantShift: 0.05,
            vibratoDepth: 0,
            tremoloDepth: 0,
            breathIntensity: 0,
            choir: 0,
            bitcrush: 0.4,
            downsample: 0.3,
            attack: 0.001,
            decay: 0.1,
            expressiveness: { vibratoRate: 5.5, vibratoDepth: 0, tremoloDepth: 0, breathAmount: 0 },
        },
    },
    {
        id: 'builtin:breathy',
        name: 'Breathy',
        description: 'High breathiness, gentle low-pass. Whispery, intimate vocal texture.',
        tags: ['vocal', 'breathy', 'soft'],
        isBuiltIn: true,
        params: {
            filterCutoff: 4000,
            filterResonance: 0.2,
            drive: 0,
            formantShift: -0.05,
            vibratoDepth: 0.01,
            tremoloDepth: 0.04,
            breathIntensity: 0.7,
            choir: 0,
            attack: 0.08,
            decay: 0.5,
            expressiveness: { vibratoRate: 4.5, vibratoDepth: 0.01, tremoloDepth: 0.04, breathAmount: 0.7 },
        },
    },
    {
        id: 'builtin:tape-echo',
        name: 'Tape Echo',
        description: 'Formant shift up with warm filtering and slight instability. Vintage tape feel.',
        tags: ['vintage', 'tape', 'warm'],
        isBuiltIn: true,
        params: {
            filterCutoff: 5000,
            filterResonance: 0.6,
            drive: 0.12,
            formantShift: 0.15,
            vibratoDepth: 0.025,
            tremoloDepth: 0.01,
            breathIntensity: 0.05,
            choir: 0.15,
            attack: 0.03,
            decay: 0.35,
            expressiveness: { vibratoRate: 3.8, vibratoDepth: 0.025, tremoloDepth: 0.01, breathAmount: 0.05 },
        },
    },
];

// ── Preset application ────────────────────────────────────────────────────────

/**
 * Merge a preset's partial params onto a base SamplerBankParams.
 * Only fields explicitly set in the preset overwrite the base — this preserves
 * per-bank settings like `sampleName`, `delaySend`, `mode`, and `rootNote`.
 */
export function applyPreset(preset: VoicePreset, base: SamplerBankParams): SamplerBankParams {
    return { ...base, ...preset.params };
}

// ── User preset persistence ───────────────────────────────────────────────────

function readStorage(): VoicePreset[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as VoicePreset[]) : [];
    } catch {
        return [];
    }
}

function writeStorage(presets: VoicePreset[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    } catch {
        // Storage quota exceeded — silently ignore.
    }
}

/** Returns all built-in presets followed by user-saved presets. */
export function getAllPresets(): VoicePreset[] {
    return [...BUILT_IN_PRESETS, ...readStorage()];
}

/** Returns only user-saved presets. */
export function getUserPresets(): VoicePreset[] {
    return readStorage();
}

/**
 * Save a new user preset. Returns the created preset.
 * Uses `crypto.randomUUID()` for the id, with a millisecond-timestamp fallback.
 */
export function saveUserPreset(
    name: string,
    params: Partial<SamplerBankParams>,
    tags: string[] = [],
    description = '',
): VoicePreset {
    const id = `user:${
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Date.now().toString(36)
    }`;
    const preset: VoicePreset = {
        id,
        name: name.trim() || 'Untitled',
        description,
        tags,
        isBuiltIn: false,
        params,
        createdAt: Date.now(),
    };
    const existing = readStorage();
    writeStorage([...existing, preset]);
    return preset;
}

/**
 * Update the name, description, or tags of an existing user preset.
 * Has no effect on built-in presets.
 */
export function updateUserPreset(
    id: string,
    updates: Partial<Pick<VoicePreset, 'name' | 'description' | 'tags' | 'params'>>,
): boolean {
    const presets = readStorage();
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) return false;
    presets[idx] = { ...presets[idx]!, ...updates };
    writeStorage(presets);
    return true;
}

/** Remove a user preset by id. Returns true if it existed. */
export function deleteUserPreset(id: string): boolean {
    const presets = readStorage();
    const next = presets.filter(p => p.id !== id);
    if (next.length === presets.length) return false;
    writeStorage(next);
    return true;
}

/** Remove all user presets (does not affect built-ins). */
export function clearUserPresets(): void {
    writeStorage([]);
}
