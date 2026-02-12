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
 * Configuration options for Open303 engine initialization
 */
export interface Open303Config {
    /**
     * Prefer AudioWorklet over ScriptProcessorNode
     * @default true
     */
    preferWorklet?: boolean;
    
    /**
     * Prefer threaded WASM variant (requires COOP/COEP headers)
     * Falls back to single-threaded if unavailable
     * @default false (uses single-threaded for broader compatibility)
     */
    preferThreaded?: boolean;
    
    /**
     * Force ScriptProcessorNode mode (disable AudioWorklet)
     * Useful for debugging or compatibility
     * @default false
     */
    forceScriptProcessor?: boolean;
    
    /**
     * Force single-threaded WASM (disable threaded variant)
     * Useful when COOP/COEP headers are not available
     * @default false
     */
    forceSingleThreaded?: boolean;
}

/**
 * Default configuration for Open303 engine
 * Prefers broad compatibility over performance
 */
export const DEFAULT_303_CONFIG: Open303Config = {
    preferWorklet: true,
    preferThreaded: false,
    forceScriptProcessor: false,
    forceSingleThreaded: false,
};


export const DEFAULT_303_PARAMS: Open303Params = {
    waveform: 1.0,      // Square wave
    tuning: 0.5,        // 440 Hz (centered)
    cutoff: 0.0,        // Minimum cutoff
    resonance: 0.92,    // 92%
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
