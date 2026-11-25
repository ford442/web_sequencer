import { describe, expect, it, vi } from 'vitest';
import { FILTER_SOURCES, FILTER_TYPES } from '../filterSource';
import { FILTER_CAPABILITIES, logFilterSubstitutions, snapFilterToSource } from '../filterCapabilities';

describe('filter capabilities', () => {
    it('every source supports the shared contract (lp/bp/hp) and at least one pole count', () => {
        for (const s of FILTER_SOURCES) {
            expect(FILTER_CAPABILITIES[s].types).toEqual(FILTER_TYPES);
            expect(FILTER_CAPABILITIES[s].poles.length).toBeGreaterThan(0);
        }
    });

    it('snaps poles to the nearest the source runs, and reports it', () => {
        const r = snapFilterToSource('native', { type: 'bp', poles: 4 });
        expect(r).toMatchObject({ type: 'bp', poles: 2 });
        expect(r.substitutions).toEqual([expect.objectContaining({ field: 'poles', requested: 4, applied: 2 })]);
        expect(snapFilterToSource('dwgs', { poles: 2 }).poles).toBe(4);
    });

    it('does not substitute a supported request and defaults to the source topology', () => {
        const r = snapFilterToSource('dwgs', { type: 'hp' });
        expect(r).toEqual({ type: 'hp', poles: 4, substitutions: [] });
    });

    it('logs substitutions', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logFilterSubstitutions('native', snapFilterToSource('native', { poles: 4 }).substitutions);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('poles 4 -> 2'));
        warn.mockRestore();
    });
});
