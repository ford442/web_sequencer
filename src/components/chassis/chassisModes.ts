/**
 * Chassis modes (#1584): which interface the transforming stage is showing and
 * how big the body becomes for it. The LED strip (top) and key bed (bottom)
 * never move; only the stage height and the body width morph between modes.
 */
import type { TrackKey } from '../../constants/appDefaults';

export type ChassisMode = 'osc' | 'drm' | 'smp' | 'tts' | 'vd' | 'pcf';

export interface ChassisModeSpec {
    /** Three-letter code shown on the mode key and in the LCD badge. */
    code: string;
    /** Human label (tooltip / aria). */
    label: string;
    /** Stage height in px at the regular layout. */
    stageHeight: number;
    /** Stage height in px under the compact layout. */
    compactStageHeight: number;
    /** Body max-width in px; wider panels (Voice Designer) widen the chassis. */
    maxWidth: number;
}

export const CHASSIS_MODES: Readonly<Record<ChassisMode, ChassisModeSpec>> = {
    osc: { code: 'OSC', label: 'Oscillator', stageHeight: 380, compactStageHeight: 320, maxWidth: 1000 },
    drm: { code: 'DRM', label: 'Drum voice', stageHeight: 340, compactStageHeight: 290, maxWidth: 1000 },
    smp: { code: 'SMP', label: 'Sampler', stageHeight: 420, compactStageHeight: 340, maxWidth: 1000 },
    tts: { code: 'TTS', label: 'Voice / TTS', stageHeight: 460, compactStageHeight: 360, maxWidth: 1060 },
    vd: { code: 'VD', label: 'Voice Designer', stageHeight: 520, compactStageHeight: 400, maxWidth: 1180 },
    pcf: { code: 'PCF', label: 'Filter (PCF)', stageHeight: 320, compactStageHeight: 270, maxWidth: 1000 },
};

/** Display order of the mode keys. */
export const CHASSIS_MODE_ORDER: readonly ChassisMode[] = ['osc', 'drm', 'smp', 'tts', 'vd', 'pcf'];

export interface ChassisFootprint {
    stageHeight: number;
    maxWidth: number;
}

/** Stage height + body width for a mode, honouring the compact layout. */
export function getChassisFootprint(mode: ChassisMode, compact = false): ChassisFootprint {
    const spec = CHASSIS_MODES[mode];
    return {
        stageHeight: compact ? spec.compactStageHeight : spec.stageHeight,
        maxWidth: spec.maxWidth,
    };
}

/** The rack track the live chassis shows maps onto a mode. */
export function chassisModeForTrack(track: TrackKey): ChassisMode {
    switch (track) {
        case 'partA':
        case 'partB':
        case 'bass2':
            return 'osc';
        case 'sampler':
            return 'smp';
        default:
            return 'drm';
    }
}

/** Track a mode key selects in the live rack (modes without a rack panel return null). */
export function trackForChassisMode(mode: ChassisMode, current: TrackKey): TrackKey | null {
    if (chassisModeForTrack(current) === mode) return current;
    switch (mode) {
        case 'osc':
            return 'partA';
        case 'drm':
            return 'kick';
        case 'smp':
            return 'sampler';
        default:
            return null;
    }
}

/** `?chassis=white` (or `?chassis`) opts the live layout into the white chassis. */
export function isChassisQuery(search: string): boolean {
    const value = new URLSearchParams(search).get('chassis');
    return value !== null && (value === '' || value === 'white' || value === '1');
}
