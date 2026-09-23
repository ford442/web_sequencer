import type { TB303ModelId } from '../engines/TB303Models';
export type { TB303ModelId, TB303Model, TB303ModelInfo, Engine303Family } from '../engines/TB303Models';

/**
 * Selectable oscillator waveforms. Every prefix here resolves to a live engine
 * through `parseWaveform` + `ENGINE_CATALOG` (#1294) — nothing in this union
 * falls through to an undocumented `OscillatorNode`.
 *
 * `rust-*` and `cpp-*` were removed: neither had a worklet, both dumped (or in
 * cpp's case, failed to dump) a buffer on the main thread. Saved songs that
 * still contain them are rewritten by `LEGACY_WAVEFORM_ALIASES`.
 *
 * `wam-*` is Hyphon's AssemblyScript wavetable kernel and is labelled
 * "WASM OSC" in the UI — it is NOT Web Audio Modules 2.0 (ADR 0001). The ids
 * keep the `wam-` prefix so existing projects keep loading.
 */
export type Waveform =
  | 'sawtooth' | 'square' | 'triangle' | 'sine'
  | 'pyodide-saw' | 'pyodide-square' | 'pyodide-sine'
  | 'wgsl-saw' | 'wgsl-sqr' | 'wgsl-tri' | 'wgsl-sin'
  | 'wam-saw' | 'wam-sqr' | 'wam-tri' | 'wam-sin'
  | 'wav-saw' | 'wav-sqr'
  | '303-saw' | '303-sqr'
  | 'prophecy-saw' | 'prophecy-sqr' | 'prophecy-tri' | 'prophecy-pulse';

export interface SynthParams {
  waveform: Waveform;
  pitch: number; // Semitones adjustment
  filterCutoff: number; // Hz
  filterResonance: number; // Q factor
  filterMode?: number; // 0-1 (filter mode toggle)
  drive?: number;
  attack: number;
  decay: number;
  sustain: number; // 0-1 (level)
  release: number; // seconds
  length: number; // seconds (gate time)
  volume: number; // 0-1
  pan?: number; // Stereo pan (-1 to 1)
  delayTime: number; // seconds
  delayFeedback: number; // 0-1
  delayMix: number; // 0-1 (wet/dry)
  /** Legacy DSP engine field for '303-saw'/'303-sqr' waveforms. Superseded by
   *  model303 but still written on save so older builds load songs correctly. */
  engine303?: Engine303;
  /** Selected 303 voice/model (see engines/TB303Models.ts). Defaults to 'stock-open303'. */
  model303?: TB303ModelId;
  /** Prophecy: Vowel formant preset 0–4 (A=0, E=1, I=2, O=3, U=4) */
  pitchAttack?: number;
  pitchDecay?: number;
  pitchAmount?: number;
  vowel?: number;
  /** Prophecy: Portamento rate 0–1 (0=instantaneous, 1=max glide) */
  portamento?: number;
  /** Prophecy: Formant frequency shift 0–1 */
  formantShift?: number;
  formantPitchLink?: number;
  coarseTune?: number;
  fineTune?: number;
  /** CPP: fine tune / shape parameter 0–1 */
  /** @deprecated CPP oscillator family removed (#1294); kept so old songs load. */
  cppFine?: number;
}

/** TB-303 DSP engine selection.
 *  - 'open303': custom synthesizer (open303_wrapper.cpp, open303_* API)
 *  - 'jc303':   authentic rosic::Open303 (jc303_wrapper.cpp, jc303_* API)
 */
export type Engine303 = 'open303' | 'jc303';

/**
 * High-level oscillator family / "engine type" for theming and UI grouping.
 * Replaces/augments the flat waveform buttons with a themed selector.
 * Each type maps to a group of waveforms and carries visual theme data.
 */
export type OscillatorType =
  | 'javascript'   // Native Web Audio OscillatorNode (saw/sqr/tri/sin)
  | 'pcm'          // Pre-rendered WAV samples
  | 'open303'      // Custom Open303 TB-303 engine (WASM)
  | 'jc303'        // Authentic JC303 / rosic::Open303 (per-voice)
  | 'prophecy'     // Korg Prophecy formant engine
  | 'pyodide'      // Python/Pyodide software oscillators
  | 'webgpu'       // WGSL/WebGPU GPU oscillators (pre-rendered wavetables)
  | 'wam'          // AssemblyScript WASM wavetable kernel — NOT Web Audio Modules 2.0
;

export interface Bass2Params {
  waveform: '303-saw' | '303-sqr';
  cutoff: number;
  resonance: number;
  filterMode: number;
  drive?: number;
  decay: number;
  accent: number;
  envMod: number;
  volume: number;
  pitch: number;
  pan?: number;
  /** Legacy DSP engine field. Superseded by model303 but still written on save. */
  engine303?: Engine303;
  /** Selected 303 voice/model (see engines/TB303Models.ts). Defaults to 'stock-open303'. */
  model303?: TB303ModelId;
  /**
   * Slide/portamento time (0–1 normalized, where 0.33 ≈ 60 ms TB-303 default).
   * Maps to Open303Params.slideTime for the Devil Fish MOD.
   */
  slideTime?: number;
}
