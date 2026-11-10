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
    // TTS / VD host the sampler rack plus the voice deck beneath it (#1582):
    // the rack keeps ~SMP height, the deck adds the phrase field, GEN and the
    // Voice Designer heatmap (taller and wider under VD).
    tts: { code: 'TTS', label: 'Voice / TTS', stageHeight: 640, compactStageHeight: 540, maxWidth: 1060 },
    vd: { code: 'VD', label: 'Voice Designer', stageHeight: 720, compactStageHeight: 600, maxWidth: 1180 },
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
        case 'tts':
        case 'vd':
            return 'sampler';
        default:
            return null;
    }
}

/** Modes that host the sampler track: plain rack, rack + TTS deck, rack + full Voice Designer. */
export type SamplerChassisMode = Extract<ChassisMode, 'smp' | 'tts' | 'vd'>;

export const SAMPLER_CHASSIS_MODES: readonly SamplerChassisMode[] = ['smp', 'tts', 'vd'];

/**
 * Selecting the sampler track expands the chassis straight to the TTS deck
 * (phrase field, GEN, Voice Designer heatmap); SMP collapses back to the rack.
 */
export const DEFAULT_SAMPLER_CHASSIS_MODE: SamplerChassisMode = 'tts';

export function isSamplerChassisMode(mode: ChassisMode): mode is SamplerChassisMode {
    return (SAMPLER_CHASSIS_MODES as readonly ChassisMode[]).includes(mode);
}

/** Whether a mode shows the voice deck (TTS phrase + GEN + Voice Designer) under the rack. */
export function chassisModeHasVoiceDeck(mode: ChassisMode): boolean {
    return mode === 'tts' || mode === 'vd';
}

/**
 * The mode the live chassis shows: the track decides, except that the sampler
 * track shows whichever sampler view (SMP / TTS / VD) was last chosen.
 */
export function resolveChassisMode(track: TrackKey, samplerMode: SamplerChassisMode): ChassisMode {
    return track === 'sampler' ? samplerMode : chassisModeForTrack(track);
}

/** `?chassis=white` (or `?chassis`) opts the live layout into the white chassis. */
export function isChassisQuery(search: string): boolean {
    const value = new URLSearchParams(search).get('chassis');
    return value !== null && (value === '' || value === 'white' || value === '1');
}
