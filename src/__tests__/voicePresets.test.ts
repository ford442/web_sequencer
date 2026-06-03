import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    BUILT_IN_PRESETS,
    getAllPresets,
    getUserPresets,
    saveUserPreset,
    deleteUserPreset,
    updateUserPreset,
    clearUserPresets,
    applyPreset,
    type VoicePreset,
} from '../utils/voicePresets';
import type { SamplerBankParams } from '../types';

// ── localStorage mock ─────────────────────────────────────────────────────────
// happy-dom provides a real localStorage, but we want a clean slate per test.

beforeEach(() => {
    localStorage.clear();
});

// ── Built-in presets ──────────────────────────────────────────────────────────

describe('BUILT_IN_PRESETS', () => {
    it('are all marked isBuiltIn=true', () => {
        expect(BUILT_IN_PRESETS.every(p => p.isBuiltIn)).toBe(true);
    });

    it('have unique ids', () => {
        const ids = BUILT_IN_PRESETS.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('each has a non-empty name, description, and at least one tag', () => {
        for (const p of BUILT_IN_PRESETS) {
            expect(p.name.length).toBeGreaterThan(0);
            expect(p.description.length).toBeGreaterThan(0);
            expect(p.tags.length).toBeGreaterThan(0);
        }
    });

    it('params contain only numeric or expressiveness fields (no sampleName etc.)', () => {
        const mechanical = ['sampleName', 'delaySend', 'mode', 'sampleName'];
        for (const p of BUILT_IN_PRESETS) {
            for (const key of mechanical) {
                expect(key in p.params).toBe(false);
            }
        }
    });

    it('filterCutoff when present is a positive number', () => {
        for (const p of BUILT_IN_PRESETS) {
            if (p.params.filterCutoff !== undefined) {
                expect(p.params.filterCutoff).toBeGreaterThan(0);
            }
        }
    });
});

// ── getAllPresets / getUserPresets ─────────────────────────────────────────────

describe('getAllPresets', () => {
    it('returns built-ins when no user presets exist', () => {
        const all = getAllPresets();
        expect(all.length).toBe(BUILT_IN_PRESETS.length);
    });

    it('includes user presets after saving one', () => {
        saveUserPreset('My Voice', { drive: 0.5 });
        const all = getAllPresets();
        expect(all.length).toBe(BUILT_IN_PRESETS.length + 1);
    });

    it('built-ins come before user presets', () => {
        saveUserPreset('User', {});
        const all = getAllPresets();
        const builtInCount = all.filter(p => p.isBuiltIn).length;
        expect(builtInCount).toBe(BUILT_IN_PRESETS.length);
        // All built-ins precede user presets
        const firstUser = all.findIndex(p => !p.isBuiltIn);
        const lastBuiltIn = all.reduce((acc, p, i) => (p.isBuiltIn ? i : acc), -1);
        expect(firstUser).toBeGreaterThan(lastBuiltIn);
    });
});

describe('getUserPresets', () => {
    it('returns empty array initially', () => {
        expect(getUserPresets()).toEqual([]);
    });

    it('returns only user presets', () => {
        saveUserPreset('U', {});
        const user = getUserPresets();
        expect(user.every(p => !p.isBuiltIn)).toBe(true);
        expect(user).toHaveLength(1);
    });
});

// ── saveUserPreset ────────────────────────────────────────────────────────────

describe('saveUserPreset', () => {
    it('returns a VoicePreset with correct fields', () => {
        const p = saveUserPreset('Test Voice', { drive: 0.3 }, ['lo-fi'], 'My test');
        expect(p.name).toBe('Test Voice');
        expect(p.params.drive).toBe(0.3);
        expect(p.tags).toContain('lo-fi');
        expect(p.description).toBe('My test');
        expect(p.isBuiltIn).toBe(false);
        expect(typeof p.id).toBe('string');
        expect(p.id.startsWith('user:')).toBe(true);
        expect(typeof p.createdAt).toBe('number');
    });

    it('persists across multiple saves', () => {
        saveUserPreset('A', { drive: 0.1 });
        saveUserPreset('B', { drive: 0.2 });
        expect(getUserPresets()).toHaveLength(2);
    });

    it('trims whitespace from name and defaults to "Untitled"', () => {
        const p = saveUserPreset('   ', {});
        expect(p.name).toBe('Untitled');
    });
});

// ── deleteUserPreset ──────────────────────────────────────────────────────────

describe('deleteUserPreset', () => {
    it('removes the preset and returns true', () => {
        const p = saveUserPreset('Del me', {});
        expect(deleteUserPreset(p.id)).toBe(true);
        expect(getUserPresets()).toHaveLength(0);
    });

    it('returns false for unknown id', () => {
        expect(deleteUserPreset('user:nonexistent')).toBe(false);
    });

    it('does not remove other presets', () => {
        saveUserPreset('Keep', {});
        const del = saveUserPreset('Delete', {});
        deleteUserPreset(del.id);
        const remaining = getUserPresets();
        expect(remaining).toHaveLength(1);
        expect(remaining[0]!.name).toBe('Keep');
    });
});

// ── updateUserPreset ──────────────────────────────────────────────────────────

describe('updateUserPreset', () => {
    it('updates name and returns true', () => {
        const p = saveUserPreset('Old Name', {});
        expect(updateUserPreset(p.id, { name: 'New Name' })).toBe(true);
        const all = getUserPresets();
        expect(all[0]!.name).toBe('New Name');
    });

    it('returns false for unknown id', () => {
        expect(updateUserPreset('user:nope', { name: 'X' })).toBe(false);
    });
});

// ── clearUserPresets ──────────────────────────────────────────────────────────

describe('clearUserPresets', () => {
    it('removes all user presets without affecting built-ins', () => {
        saveUserPreset('A', {});
        saveUserPreset('B', {});
        clearUserPresets();
        expect(getUserPresets()).toHaveLength(0);
        expect(getAllPresets()).toHaveLength(BUILT_IN_PRESETS.length);
    });
});

// ── applyPreset ───────────────────────────────────────────────────────────────

describe('applyPreset', () => {
    const base: SamplerBankParams = {
        sampleName: 'my-sample',
        playbackSpeed: 1,
        volume: 0.9,
        filterCutoff: 20000,
        filterResonance: 0,
        drive: 0,
        delaySend: 0.3,
    };

    it('merges preset params onto the base', () => {
        const preset: VoicePreset = {
            id: 'test', name: 'T', description: '', tags: [], isBuiltIn: false,
            params: { drive: 0.5, filterCutoff: 5000 },
        };
        const result = applyPreset(preset, base);
        expect(result.drive).toBe(0.5);
        expect(result.filterCutoff).toBe(5000);
    });

    it('does not overwrite mechanical fields not in the preset', () => {
        const preset: VoicePreset = {
            id: 'test', name: 'T', description: '', tags: [], isBuiltIn: false,
            params: { drive: 0.5 },
        };
        const result = applyPreset(preset, base);
        // Mechanical fields preserved
        expect(result.sampleName).toBe('my-sample');
        expect(result.delaySend).toBe(0.3);
    });

    it('returns a new object (immutable)', () => {
        const preset: VoicePreset = {
            id: 'test', name: 'T', description: '', tags: [], isBuiltIn: false,
            params: { drive: 0.5 },
        };
        const result = applyPreset(preset, base);
        expect(result).not.toBe(base);
    });

    it('applying the clean preset produces zeroed voice params', () => {
        const clean = BUILT_IN_PRESETS.find(p => p.id === 'builtin:clean')!;
        expect(clean).toBeDefined();
        const result = applyPreset(clean, base);
        expect(result.drive).toBe(0);
        expect(result.formantShift).toBe(0);
        expect(result.choir).toBe(0);
    });
});
