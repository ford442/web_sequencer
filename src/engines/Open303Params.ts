export interface Open303Params {
    waveform: number;       // 0 = saw, 1 = square
    tuning: number;         // 0-1 (maps to 400-480 Hz for A4)
    cutoff: number;         // 0-1 (filter cutoff)
    resonance: number;      // 0-1 (filter resonance)
    envMod: number;         // 0-1 (envelope modulation depth)
    decay: number;          // 0-1 (decay time)
    accent: number;         // 0-1 (accent amount)
    volume: number;         // 0-1 (output volume)
    // Devil Fish MOD parameters
    modEnabled: boolean;
    normalDecay: number;    // 0-1 (MOD: normal decay time)
    accentDecay: number;    // 0-1 (MOD: accent decay time)
    feedbackFilter: number; // 0-1 (MOD: feedback filter)
    softAttack: number;     // 0-1 (MOD: soft attack)
    slideTime: number;      // 0-1 (MOD: slide/portamento time)
    squareDriver: number;   // 0-1 (MOD: square wave driver)
}

export const DEFAULT_303_PARAMS: Open303Params = {
    waveform: 1.0,      // Square wave
    tuning: 0.5,        // 440 Hz (centered)
    cutoff: 0.0,        // Minimum cutoff
    resonance: 0.92,    // 92%
    envMod: 0.0,        // No modulation
    decay: 0.29,        // 29%
    accent: 0.78,       // 78%
    volume: 0.75,       // 75%
    modEnabled: false,
    normalDecay: 0.3,
    accentDecay: 0.03,
    feedbackFilter: 0.63,
    softAttack: 0.26,
    slideTime: 0.33,
    squareDriver: 0.25
};
