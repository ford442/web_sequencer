export const RUBBERBAND_OPTIONS = {
    OptionProcessOffline: 0x00000000,
    OptionProcessRealTime: 0x00000001,
    OptionStretchElastic: 0x00000000,
    OptionStretchPrecise: 0x00000010,
    OptionTransientsCrisp: 0x00000000,
    OptionTransientsMixed: 0x00000100,
    OptionTransientsSmooth: 0x00000200,
    OptionDetectorCompound: 0x00000000,
    OptionDetectorPercussive: 0x00000400,
    OptionDetectorSoft: 0x00000800,
    OptionPhaseLaminar: 0x00000000,
    OptionPhaseIndependent: 0x00002000,
    OptionThreadingBackground: 0x00000000,
    OptionThreadingNever: 0x00010000,
    OptionThreadingAlways: 0x00020000,
    OptionWindowStandard: 0x00000000,
    OptionWindowShort: 0x00100000,
    OptionWindowLong: 0x00200000,
    OptionSmoothingOff: 0x00000000,
    OptionSmoothingOn: 0x00800000,
    OptionFormantShifted: 0x00000000,
    OptionFormantPreserved: 0x01000000,
    OptionPitchHighSpeed: 0x00000000,
    OptionPitchHighQuality: 0x02000000,
    OptionPitchHighConsistency: 0x04000000,
    OptionChannelsApart: 0x00000000,
    OptionChannelsTogether: 0x10000000,
    OptionEngineFaster: 0x00000000,
    OptionEngineFiner: 0x20000000,
};

export type StretchProfile = 'vocal' | 'harmonic' | 'fast';

/**
 * Rubber Band option bitmask for each stretch profile. Shared by the
 * RubberBandProcessor and sustain-processor worklets.
 *
 * The engine is deliberately R2 (OptionEngineFaster): real-time R3
 * (OptionEngineFiner) costs roughly 3-5x the CPU per voice, and the harmonizer
 * can run 4 voices plus choir. These masks match what has shipped so far. The
 * worklets used to hand-write `1 | 32 | 1048576`, where `32` is not a flag and
 * `1048576` is OptionWindowShort, so formants were never actually preserved
 * (#1297).
 */
export function getStretchProfileOptions(profile: StretchProfile): number {
    switch (profile) {
        case 'harmonic':
            return RUBBERBAND_OPTIONS.OptionProcessRealTime |
                   RUBBERBAND_OPTIONS.OptionTransientsMixed |
                   RUBBERBAND_OPTIONS.OptionPitchHighQuality;
        case 'fast':
            return RUBBERBAND_OPTIONS.OptionProcessRealTime |
                   RUBBERBAND_OPTIONS.OptionEngineFaster;
        case 'vocal':
        default:
            return RUBBERBAND_OPTIONS.OptionProcessRealTime |
                   RUBBERBAND_OPTIONS.OptionTransientsMixed |
                   RUBBERBAND_OPTIONS.OptionWindowShort |
                   RUBBERBAND_OPTIONS.OptionFormantPreserved;
    }
}
