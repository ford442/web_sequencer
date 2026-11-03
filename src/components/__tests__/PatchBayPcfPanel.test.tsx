/**
 * PCF panel status line: what a PCF node plays, and why when it is not what
 * the patch asks for.
 */

import { describe, expect, it } from 'vitest';

import { pcfModeStatusText } from '../PatchBayPcfPanel';

const base = { openrbAvailable: true, bitExact: null } as const;

describe('pcfModeStatusText', () => {
    it('describes the pattern PCF', () => {
        expect(pcfModeStatusText({ ...base, mode: 'rbj', active: 'rbj' })).toMatch(/^pattern PCF/);
    });

    it('says the openrb branch is static, and when it is not bit-exact', () => {
        expect(pcfModeStatusText({ ...base, mode: 'openrb', active: 'openrb' })).toMatch(/static ReBirth low-pass/);
        expect(pcfModeStatusText({ ...base, mode: 'openrb', active: 'openrb', bitExact: false })).toMatch(/not bit-exact/);
    });

    it('says why openrb is not playing', () => {
        expect(
            pcfModeStatusText({ ...base, mode: 'openrb', active: 'rbj', held: 'PCF is off' }),
        ).toBe('plays pattern PCF · PCF is off');
        expect(
            pcfModeStatusText({ mode: 'openrb', active: 'rbj', openrbAvailable: false, reason: 'not loaded', bitExact: null }),
        ).toBe('plays pattern PCF · not loaded · patch keeps openrb');
    });
});
