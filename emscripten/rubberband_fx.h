// emscripten/rubberband_fx.h
//
// Native singing-voice FX chain, linked into public/rubberband.wasm next to the
// stretcher (see emscripten/build_rubberband.sh). The AudioWorklet
// (src/audio-worklets/rubberband-processor.ts) only schedules: it writes the
// per-block controls into the float block returned by rb_fx_params(), copies
// audio to the heap, calls rb_fx_render_grains / rb_fx_process, and copies out.
//
// The TypeScript modules in src/audio-worklets/rubberband/ are the test oracle
// and the fallback when these exports are missing — they are not the spec for
// the one place they were wrong: the spectral path splits and compresses ONCE.
//
// ABI: the RbFxParam order is mirrored by RB_FX_PARAM in
// src/audio-worklets/rubberband/nativeVocalFx.ts. A unit test parses this enum
// and fails on drift; bump RB_FX_ABI_VERSION whenever the layout changes.

#pragma once

#include <cstdint>

#define RB_FX_ABI_VERSION 2

enum RbFxParam {
    // --- phoneme context for the current block ------------------------------
    RB_FX_HAS_PHONEME_CONTEXT = 0, // 1 when playing with phoneme data + ratios
    RB_FX_PHONEME_VOLUME,          // tuple[1] (tone filter gain / brightness)
    RB_FX_IS_VOWEL,                // tuple[7]
    RB_FX_PHONEME_GRAIN_JITTER,    // tuple[5], -1 = no override
    RB_FX_PHONEME_GRAIN_SIZE_MS,   // tuple[6], -1 = no override

    // --- post-retrieve chain -------------------------------------------------
    RB_FX_PHONEME_FILTER_MOD,
    RB_FX_VOLUME_FILTER_MOD,       // 0 unless playing with phoneme data
    RB_FX_SYLLABLE_VOLUME,         // tuple[1] as seen by the syllable filter
    RB_FX_GATE_DEPTH,
    RB_FX_GATE_RATE,
    RB_FX_SPECTRAL_COMP,
    RB_FX_GRAIN_PAN_SPREAD,
    RB_FX_VOCAL_CHORUS,
    RB_FX_SUB_HARMONICS,
    RB_FX_DUCKING_SCALAR,
    RB_FX_DRUM_IS_SNARE,
    RB_FX_BITCRUSH,
    RB_FX_DOWNSAMPLE,

    // --- freeze granulator ---------------------------------------------------
    RB_FX_ENVELOPE_VALUE,
    RB_FX_GRAIN_JITTER,
    RB_FX_GRAIN_ENV_DEPTH,
    RB_FX_WINDOW_SHAPE,
    RB_FX_GRAIN_LFO_DEPTH,
    RB_FX_GRAIN_POS_LFO_DEPTH,
    RB_FX_VELOCITY,                // note velocity 0..1; softer notes jitter more

    RB_FX_PARAM_COUNT
};

enum RbFxWindowKind {
    RB_FX_WINDOW_CUSTOM_SHAPE = 1,    // 'setCustomWindowShape' (takes precedence)
    RB_FX_WINDOW_CUSTOM_ENVELOPE = 2, // 'setCustomGrainEnvelope'
};

#ifdef __cplusplus
extern "C" {
#endif

struct RbFx;

int rb_fx_abi_version(void);
int rb_fx_param_count(void);

RbFx* rb_fx_create(double sampleRate, int maxFrames);
void rb_fx_destroy(RbFx* fx);

/**
 * RB_FX_PARAM_COUNT doubles, written by the worklet before each call. Doubles,
 * not floats: the grain size is floor()ed from products of these, and a
 * float32-rounded envelope value moves it by a sample against the JS doubles.
 */
double* rb_fx_params(RbFx* fx);
/** Planar scratch (maxFrames) the worklet copies audio into; ch 0 = L, 1 = R. */
float* rb_fx_channel(RbFx* fx, int ch);

void rb_fx_seed(RbFx* fx, uint32_t seed);
/** Clears the syllable filter hold state (the worklet's noteOn). */
void rb_fx_note_on(RbFx* fx);

/** (Re)allocates the owned sample buffer; the caller fills the returned span. */
float* rb_fx_sample_alloc(RbFx* fx, int frames);
/** (Re)allocates a custom grain window; len 0 clears it and returns null. */
float* rb_fx_window_alloc(RbFx* fx, int kind, int len);

/** Advances the freeze / grain LFOs by `frames`; returns sin(freeze phase). */
double rb_fx_advance_lfo(RbFx* fx, double freezeLfoRate, double grainLfoRate, int frames);

/**
 * Frozen block: writes `frames` granulated samples into `out` (the stretcher's
 * input span). Returns the frame count to feed the stretcher, 0 when no grain
 * could start (feed 0), or -1 when frames <= 0 (do not call process at all).
 */
int rb_fx_render_grains(RbFx* fx, float* out, int frames, int currentSample, int startSample, int endSample);
void rb_fx_exit_freeze(RbFx* fx);

/** Post-retrieve chain, in place: reads mono ioL, writes stereo ioL / ioR. */
void rb_fx_process(RbFx* fx, float* ioL, float* ioR, int frames);

#ifdef __cplusplus
}
#endif
