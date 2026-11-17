// rubberband_wrapper.cpp — the Rubber Band stretcher as a plain C ABI.
//
// public/rubberband.wasm is instantiated inside AudioWorklets
// (src/audio-worklets/{rubberband,sustain}-processor.ts, and the offline vocal
// host that runs the same RubberBandProcessor). Those callers want what the voice
// module already has: extern "C" functions over an opaque handle, no embind, no
// C++ exceptions, no RTTI, and nothing that allocates on the audio thread.
// The TS side wraps this in src/audio-worklets/rubberband/stretcher.ts.
//
//   uintptr_t rb_create(sampleRate, channels, options, timeRatio, pitchScale)  0 on error
//   void      rb_destroy(h)
//   void      rb_reset(h)
//   void      rb_set_time_ratio(h, ratio) / rb_set_pitch_scale(h, scale)
//   double    rb_get_time_ratio(h)        / rb_get_pitch_scale(h)
//   void      rb_set_formant_option(h, option)
//   int       rb_get_samples_required(h) / rb_get_latency(h) / rb_get_channel_count(h)
//   int       rb_available(h)            -1 once the final block has been retrieved
//   void      rb_process(h, planarInputPtr, frames, final)
//   int       rb_retrieve(h, planarOutputPtr, frames)   frames written
//
// Buffers are PLANAR (LLLL… RRRR…), `frames` samples per channel, as before.
// The channel-pointer arrays live in the handle, set up once by rb_create, so
// process / retrieve do no heap work of their own (the embind wrapper built a
// std::vector per call).
//
// Every entry point tolerates the 0 handle a failed rb_create returns (no-op, or
// a neutral value back), so it cannot turn into a wasm trap in the render loop.

#include <emscripten/emscripten.h>

#include <cstdint>
#include <new>

#include "rubberband/RubberBandStretcher.h"

namespace {

using RubberBand::RubberBandStretcher;

/** Bumped on any breaking change to the rb_* signatures. */
constexpr int kRbAbiVersion = 1;

/** The worklets stretch mono; Rubber Band itself takes any count. */
constexpr int kRbMaxChannels = 8;

struct RbHandle {
    RubberBandStretcher* stretcher = nullptr;
    int channels = 0;
    const float* in[kRbMaxChannels] = {};
    float* out[kRbMaxChannels] = {};

    RbHandle() = default;
    RbHandle(const RbHandle&) = delete;
    RbHandle& operator=(const RbHandle&) = delete;
    ~RbHandle() { delete stretcher; }
};

inline RbHandle* handle(uintptr_t h) { return reinterpret_cast<RbHandle*>(h); }

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int rb_abi_version(void) { return kRbAbiVersion; }

EMSCRIPTEN_KEEPALIVE uintptr_t rb_create(int sampleRate, int channels, int options,
                                         double timeRatio, double pitchScale) {
    if (sampleRate <= 0 || channels < 1 || channels > kRbMaxChannels) return 0;
    RbHandle* h = new (std::nothrow) RbHandle();
    if (!h) return 0;
    h->stretcher = new (std::nothrow) RubberBandStretcher(
        static_cast<size_t>(sampleRate), static_cast<size_t>(channels),
        static_cast<RubberBandStretcher::Options>(options), timeRatio, pitchScale);
    if (!h->stretcher) {
        delete h;
        return 0;
    }
    h->channels = channels;
    return reinterpret_cast<uintptr_t>(h);
}

EMSCRIPTEN_KEEPALIVE void rb_destroy(uintptr_t h) { delete handle(h); }

EMSCRIPTEN_KEEPALIVE void rb_reset(uintptr_t h) {
    if (RbHandle* r = handle(h)) r->stretcher->reset();
}

EMSCRIPTEN_KEEPALIVE void rb_set_time_ratio(uintptr_t h, double ratio) {
    if (RbHandle* r = handle(h)) r->stretcher->setTimeRatio(ratio);
}

EMSCRIPTEN_KEEPALIVE void rb_set_pitch_scale(uintptr_t h, double scale) {
    if (RbHandle* r = handle(h)) r->stretcher->setPitchScale(scale);
}

EMSCRIPTEN_KEEPALIVE double rb_get_time_ratio(uintptr_t h) {
    RbHandle* r = handle(h);
    return r ? r->stretcher->getTimeRatio() : 1.0;
}

EMSCRIPTEN_KEEPALIVE double rb_get_pitch_scale(uintptr_t h) {
    RbHandle* r = handle(h);
    return r ? r->stretcher->getPitchScale() : 1.0;
}

EMSCRIPTEN_KEEPALIVE void rb_set_formant_option(uintptr_t h, int option) {
    if (RbHandle* r = handle(h)) {
        r->stretcher->setFormantOption(static_cast<RubberBandStretcher::Options>(option));
    }
}

EMSCRIPTEN_KEEPALIVE int rb_get_samples_required(uintptr_t h) {
    RbHandle* r = handle(h);
    return r ? static_cast<int>(r->stretcher->getSamplesRequired()) : 0;
}

EMSCRIPTEN_KEEPALIVE int rb_get_latency(uintptr_t h) {
    RbHandle* r = handle(h);
    return r ? static_cast<int>(r->stretcher->getStartDelay()) : 0;
}

EMSCRIPTEN_KEEPALIVE int rb_get_channel_count(uintptr_t h) {
    RbHandle* r = handle(h);
    return r ? r->channels : 0;
}

EMSCRIPTEN_KEEPALIVE int rb_available(uintptr_t h) {
    RbHandle* r = handle(h);
    return r ? r->stretcher->available() : 0;
}

EMSCRIPTEN_KEEPALIVE void rb_process(uintptr_t h, uintptr_t inputPtr, int frames, int final) {
    RbHandle* r = handle(h);
    if (!r || frames < 0) return;
    const float* input = reinterpret_cast<const float*>(inputPtr);
    for (int c = 0; c < r->channels; ++c) r->in[c] = input + c * frames;
    r->stretcher->process(r->in, static_cast<size_t>(frames), final != 0);
}

EMSCRIPTEN_KEEPALIVE int rb_retrieve(uintptr_t h, uintptr_t outputPtr, int frames) {
    RbHandle* r = handle(h);
    if (!r || frames <= 0) return 0;
    float* output = reinterpret_cast<float*>(outputPtr);
    for (int c = 0; c < r->channels; ++c) r->out[c] = output + c * frames;
    return static_cast<int>(r->stretcher->retrieve(r->out, static_cast<size_t>(frames)));
}

}  // extern "C"
