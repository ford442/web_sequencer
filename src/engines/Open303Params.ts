export interface Open303Params {
    waveform: number;       // 0 = saw, 1 = square
    tuning: number;         // 0-1 (maps to 400-480 Hz for A4)
    cutoff: number;         // 0-1 (filter cutoff)
    resonance: number;      // 0-1 (filter resonance)
    filterMode: number;     // 0-1 (filter mode toggle)
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

/**
 * Configuration options for Open303 engine initialization.
 *
 * Without options the build is chosen automatically per audio context
 * (src/engines/hyphonNativeVariant.ts): the pthread hyphon_native.wasm when the
 * page is crossOriginIsolated and not WebKit, otherwise the single-threaded
 * hyphon_native.st.wasm. The JS FallbackBassSynth is only used when the chosen
 * module fails to load. See docs/wasm/BUILD_NOTES.md#threading-profiles.
 */
export interface Open303Config {
    /**
     * Load the single-threaded hyphon_native.st.wasm even when the pthread build
     * could run. The first voice on an AudioContext binds the choice for every
     * voice (303 and Prophecy) on it, because they share one instance.
     * @default false
     */
    forceSingleThreaded?: boolean;
}


export const DEFAULT_303_PARAMS: Open303Params = {
    waveform: 1.0,      // Square wave
    tuning: 0.5,        // 440 Hz (centered)
    cutoff: 0.5,        // Mid-range cutoff (0 was near-silent on jc303)
    resonance: 0.55,    // Moderate resonance (0.92 caused harsh self-oscillation on open303)
    filterMode: 0,
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
