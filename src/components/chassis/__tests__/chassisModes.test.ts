import { describe, expect, it } from 'vitest';
import {
    CHASSIS_MODES,
    CHASSIS_MODE_ORDER,
    chassisModeForTrack,
    DEFAULT_SAMPLER_CHASSIS_MODE,
    SAMPLER_CHASSIS_MODES,
    chassisModeHasVoiceDeck,
    getChassisFootprint,
    isChassisQuery,
    isSamplerChassisMode,
    resolveChassisMode,
    trackForChassisMode,
} from '../chassisModes';

describe('chassis modes (#1584)', () => {
    it('lists every mode exactly once with a three-letter-or-shorter code', () => {
        expect(new Set(CHASSIS_MODE_ORDER).size).toBe(CHASSIS_MODE_ORDER.length);
        expect([...CHASSIS_MODE_ORDER].sort()).toEqual(Object.keys(CHASSIS_MODES).sort());
        for (const mode of CHASSIS_MODE_ORDER) {
            expect(CHASSIS_MODES[mode].code.length).toBeLessThanOrEqual(3);
        }
    });

    it('compact footprints are never taller than the regular ones', () => {
        for (const mode of CHASSIS_MODE_ORDER) {
            expect(getChassisFootprint(mode, true).stageHeight).toBeLessThanOrEqual(getChassisFootprint(mode).stageHeight);
            expect(getChassisFootprint(mode, true).maxWidth).toBe(getChassisFootprint(mode).maxWidth);
        }
    });

    it('keeps the oscillator stage at the legacy rack height so live panels do not reflow', () => {
        expect(getChassisFootprint('osc').stageHeight).toBe(380);
    });

    it('the Voice Designer widens and deepens the body; PCF is the shallowest panel', () => {
        const vd = getChassisFootprint('vd');
        expect(vd.maxWidth).toBeGreaterThan(getChassisFootprint('osc').maxWidth);
        expect(vd.stageHeight).toBe(Math.max(...CHASSIS_MODE_ORDER.map((m) => getChassisFootprint(m).stageHeight)));
        expect(getChassisFootprint('pcf').stageHeight).toBe(Math.min(...CHASSIS_MODE_ORDER.map((m) => getChassisFootprint(m).stageHeight)));
    });

    it('maps rack tracks onto modes', () => {
        expect(chassisModeForTrack('partA')).toBe('osc');
        expect(chassisModeForTrack('partB')).toBe('osc');
        expect(chassisModeForTrack('bass2')).toBe('osc');
        expect(chassisModeForTrack('kick')).toBe('drm');
        expect(chassisModeForTrack('openHat')).toBe('drm');
        expect(chassisModeForTrack('sampler')).toBe('smp');
    });

    it('a mode key keeps the current track when it already belongs to that mode', () => {
        expect(trackForChassisMode('osc', 'partB')).toBe('partB');
        expect(trackForChassisMode('drm', 'snare')).toBe('snare');
        expect(trackForChassisMode('osc', 'kick')).toBe('partA');
        expect(trackForChassisMode('drm', 'partA')).toBe('kick');
        expect(trackForChassisMode('smp', 'partA')).toBe('sampler');
    });

    it('modes without a live rack panel select no track', () => {
        expect(trackForChassisMode('pcf', 'kick')).toBeNull();
    });

    it('TTS and VD host the sampler track (#1582)', () => {
        expect(trackForChassisMode('tts', 'partA')).toBe('sampler');
        expect(trackForChassisMode('vd', 'kick')).toBe('sampler');
        expect(trackForChassisMode('tts', 'sampler')).toBe('sampler');
        for (const mode of SAMPLER_CHASSIS_MODES) expect(isSamplerChassisMode(mode)).toBe(true);
        expect(isSamplerChassisMode('osc')).toBe(false);
        expect(isSamplerChassisMode('pcf')).toBe(false);
    });

    it('selecting the sampler expands to its remembered view; other tracks ignore it', () => {
        expect(DEFAULT_SAMPLER_CHASSIS_MODE).toBe('tts');
        expect(resolveChassisMode('sampler', 'tts')).toBe('tts');
        expect(resolveChassisMode('sampler', 'smp')).toBe('smp');
        expect(resolveChassisMode('sampler', 'vd')).toBe('vd');
        expect(resolveChassisMode('partA', 'vd')).toBe('osc');
        expect(resolveChassisMode('kick', 'tts')).toBe('drm');
    });

    it('only TTS and VD show the voice deck, and both expand past the sampler rack', () => {
        expect(CHASSIS_MODE_ORDER.filter(chassisModeHasVoiceDeck)).toEqual(['tts', 'vd']);
        for (const mode of ['tts', 'vd'] as const) {
            expect(getChassisFootprint(mode).stageHeight).toBeGreaterThan(getChassisFootprint('smp').stageHeight);
            expect(getChassisFootprint(mode, true).stageHeight).toBeGreaterThan(getChassisFootprint('smp', true).stageHeight);
        }
    });

    it('opts in only on ?chassis / ?chassis=white / ?chassis=1', () => {
        expect(isChassisQuery('?chassis=white')).toBe(true);
        expect(isChassisQuery('?chassis')).toBe(true);
        expect(isChassisQuery('?e2e=1&chassis=1')).toBe(true);
        expect(isChassisQuery('')).toBe(false);
        expect(isChassisQuery('?chassis=dark')).toBe(false);
        expect(isChassisQuery('?visual-review=1')).toBe(false);
    });
});
