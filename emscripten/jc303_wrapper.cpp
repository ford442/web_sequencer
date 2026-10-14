/**
 * jc303_wrapper.cpp
 *
 * Authentic Roland TB-303 / Open303 (rosic) engine compiled into hyphon_native.wasm
 * alongside the custom open303 implementation in open303_wrapper.cpp.
 *
 * Built on the shared voice core (emscripten/core/voice.h, #1344). Generic
 * exports from HYPHON_EXPORT_VOICE:
 *   jc303_create / _destroy / _init(handle, sampleRate, maxFrames)
 *   jc303_push_event(handle, frame, type, target, value, …)
 *   jc303_render(handle, blockStartFrame, numFrames)  → float*, sample-accurate
 *   jc303_cancel_notes(handle)
 * Events: hyphon::kNoteOn (target = note, value = MIDI velocity), kNoteOff,
 * kAllNotesOff, kParam (target = Jc303Param).
 *
 * Immediate API (what open303-processor.ts calls today):
 *   jc303_init_handle(handle, sampleRate, bufferSize)   = jc303_init
 *   jc303_note_on / _note_off / _all_notes_off / _set_param
 *   jc303_process_handle(handle, numFrames)            → float*
 *
 * The single-instance jc303_init(sampleRate, bufferSize) / jc303_noteOn / …
 * surface that debug builds used to carry is gone: the generic jc303_init
 * took its name, and it was never reachable in hyphon_native — the worklet
 * only uses it against the standalone jc303-single.wasm.
 *
 * Uses the jc303_wasm submodule directly as the source of rosic_Open303.h + .cpp files.
 *
 * © 2025 Hyphon contributors
 */

#include <emscripten.h>
#include <emscripten/bind.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <memory>

#include "rosic_Open303.h"

#include "core/voice.h"
#include "core/voice_exports.h"

using namespace rosic;
using namespace emscripten;

// ─────────────────────────────────────────────────────────────────────────────
// Parameter IDs (keep in sync with Open303Params.ts)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Output level calibration
// ─────────────────────────────────────────────────────────────────────────────
//
// LEVEL (JC303_VOLUME, 0-1) must behave as a *linear* amplitude control, matching
// open303_wrapper.cpp / highfid303_wrapper.cpp (`gain = volume`) and the non-303
// oscillators (VoiceManager ramps its GainNode straight to params.volume). It
// previously went through `setVolume(linToLin(v, 0, 1, -60, 0))`, i.e. rosic's
// master level in *decibels* — an exponential law that left jc303 14-18 dB below
// every other oscillator at the default LEVELs (0.40-0.50) while overshooting to
// +7.9 dBFS (hard clipping) at LEVEL=1.0. The two laws happened to cross near
// LEVEL≈0.80, which is where the canonical baselines were rendered, so the
// mismatch never showed up in docs/audio-engine/303-baseline/.
//
// rosic's own master level is therefore pinned to 0 dB (unity) and LEVEL is
// applied as a linear gain on the way out, scaled by the constant below.
//
// JC303_OUTPUT_NORMALIZE brings the rosic engine's hot unity output onto the
// shared 303 reference level: peak 0.822 at LEVEL=1.0 under the canonical
// pattern (cutoff 0.35 / res 0.70 / envMod 0.55 / decay 0.50 / accent 0.70, saw),
// which is what the open303 model family produces. Measured rosic peak at 0 dB
// under that pattern is 2.489, so 0.822 / 2.489 = 0.330.
//
// Calibrating a new 303 engine: render the canonical pattern at LEVEL=1.0 and
// pick a constant that lands peak on TB303_REFERENCE_PEAK. The offline test
// emscripten/tests/tb303_level_alignment_test.cpp asserts every engine stays
// within tolerance of it.
static constexpr float TB303_REFERENCE_PEAK      = 0.822f;
static constexpr float JC303_UNITY_PEAK          = 2.489f;
static constexpr float JC303_OUTPUT_NORMALIZE    = TB303_REFERENCE_PEAK / JC303_UNITY_PEAK;

enum Jc303Param : int {
    JC303_WAVEFORM      = 0,
    JC303_TUNING        = 1,
    JC303_CUTOFF        = 2,
    JC303_RESONANCE     = 3,
    JC303_ENV_MOD       = 4,
    JC303_DECAY         = 5,
    JC303_ACCENT        = 6,
    JC303_VOLUME        = 7,
    JC303_FILTER_MODE   = 8,
    JC303_NORMAL_DECAY  = 9,
    JC303_ACCENT_DECAY  = 10,
    JC303_SLIDE_TIME    = 11,
    JC303_SOFT_ATTACK   = 12,
    JC303_SQUARE_DRIVER = 13,
};

// ─────────────────────────────────────────────────────────────────────────────
// Jc303Engine
// ─────────────────────────────────────────────────────────────────────────────

struct Jc303Engine {
    // rosic::Open303 carries its mip-mapped wavetables inline (hundreds of KB),
    // so it lives on the heap — allocated in init(), never on the audio path.
    std::unique_ptr<Open303> synth;
    float    sampleRate = 44100.0f;
    // LEVEL as a linear 0-1 amplitude, applied in render(). Mirrors the
    // `volume` member in open303_wrapper.cpp / highfid303_wrapper.cpp.
    float    volume  = 0.75f;

    bool init(float sr, int /*maxFrames*/)
    {
        sampleRate = sr;

        synth.reset(new Open303());
        synth->setSampleRate(sampleRate);

        // Devil Fish / extended defaults (from plan)
        synth->setNormalAttack(0.3);
        synth->setAccentAttack(3.0);
        synth->setAccentDecay(200.0);
        synth->setAmpDecay(1230.0);
        synth->setAmpSustain(0.0);
        synth->setSlideTime(60.0);
        synth->setTanhShaperDrive(0.0);

        // Pin rosic's dB master level to unity; LEVEL is applied linearly in
        // render() so the law matches the other 303 engines and oscillators.
        synth->setVolume(0.0);
        return true;
    }

    void setParam(int paramId, float value)
    {
        if (!synth) return;

        switch (paramId) {
            case JC303_WAVEFORM:
                synth->setWaveform(value); // 0 = saw, 1 = square
                break;
            case JC303_TUNING:
                synth->setTuning(linToLin(value, 0.0, 1.0, 400.0, 480.0));
                break;
            case JC303_CUTOFF:
                synth->setCutoff(linToExp(value, 0.0, 1.0, 20.0, 8000.0));
                break;
            case JC303_RESONANCE:
                synth->setResonance(value * 100.0);
                break;
            case JC303_ENV_MOD:
                synth->setEnvMod(value * 100.0);
                break;
            case JC303_DECAY:
                synth->setDecay(linToLin(value, 0.0, 1.0, 200.0, 2000.0));
                break;
            case JC303_ACCENT:
                synth->setAccent(value * 100.0);
                break;
            case JC303_VOLUME:
                // Linear amplitude control — applied in render(), not through
                // rosic's dB master level (which stays pinned at unity in init()).
                volume = std::max(0.0f, std::min(1.0f, value));
                break;
            case JC303_FILTER_MODE:
                synth->setFeedbackHighpass(linToExp(value, 0.0, 1.0, 20.0, 500.0));
                break;
            // Extended params can be added here
            default:
                break;
        }
    }

    void noteOn(int midiNote, float velocity)
    {
        if (synth) synth->noteOn(midiNote, static_cast<int>(velocity), 0.0);
    }

    void noteOff(int midiNote)
    {
        if (synth) synth->noteOn(midiNote, 0, 0.0);
    }

    void allNotesOff()
    {
        if (synth) synth->allNotesOff();
    }

    void apply(const hyphon::Event& e)
    {
        switch (e.type) {
            case hyphon::kNoteOn:      noteOn(e.target, e.value);   break;
            case hyphon::kNoteOff:     noteOff(e.target);           break;
            case hyphon::kAllNotesOff: allNotesOff();               break;
            case hyphon::kParam:       setParam(e.target, e.value); break;
            default: break;
        }
    }

    void render(float* output, int numFrames)
    {
        if (!synth) return;
        const float gain = volume * JC303_OUTPUT_NORMALIZE;
        for (int i = 0; i < numFrames; ++i) {
            output[i] = static_cast<float>(synth->getSample()) * gain;
        }
    }
};

using Jc303NativeVoice = hyphon::NativeVoice<Jc303Engine, 256>;

// One per 303 voice (bass1 / bass2 / lead303) in an audio session, plus slack.
HYPHON_EXPORT_VOICE(jc303, Jc303NativeVoice, 16)

// ─────────────────────────────────────────────────────────────────────────────
// Immediate C API
// ─────────────────────────────────────────────────────────────────────────────

extern "C" {

/** The worklet's name for jc303_init. */
EMSCRIPTEN_KEEPALIVE int jc303_init_handle(uintptr_t handle, float sr, int bs)
{
    return jc303_init(handle, sr, bs);
}

EMSCRIPTEN_KEEPALIVE void jc303_note_on(uintptr_t h, int note, float vel)
{
    if (auto* v = jc303_voice(h)) v->engine.noteOn(note, vel);
}

EMSCRIPTEN_KEEPALIVE void jc303_note_off(uintptr_t h, int note)
{
    if (auto* v = jc303_voice(h)) v->engine.noteOff(note);
}

EMSCRIPTEN_KEEPALIVE void jc303_all_notes_off(uintptr_t h)
{
    if (auto* v = jc303_voice(h)) v->engine.allNotesOff();
}

EMSCRIPTEN_KEEPALIVE void jc303_set_param(uintptr_t h, int pid, float val)
{
    if (auto* v = jc303_voice(h)) v->engine.setParam(pid, val);
}

/**
 * Whole-block render with no event timing → the voice's buffer. A block larger
 * than init reserved grows the buffer (counted in stats.overruns); before the
 * port it rendered only the reserved frames and the worklet read the rest from
 * past the end of the buffer.
 */
EMSCRIPTEN_KEEPALIVE uintptr_t jc303_process_handle(uintptr_t handle, int numFrames)
{
    Jc303NativeVoice* v = jc303_voice(handle);
    if (!v || v->buffer.capacity() == 0) return 0;  // not initialised
    if (numFrames <= 0) return reinterpret_cast<uintptr_t>(v->buffer.data());
    if (numFrames > v->buffer.capacity()) {
        ++v->stats.overruns;
        if (!v->buffer.reserve(numFrames)) return 0;
    }
    float* out = v->buffer.acquire(numFrames);
    v->engine.render(out, numFrames);
    return reinterpret_cast<uintptr_t>(out);
}

} // extern "C"

// ─────────────────────────────────────────────────────────────────────────────
// Embind
// ─────────────────────────────────────────────────────────────────────────────

EMSCRIPTEN_BINDINGS(jc303_module) {
    emscripten::function("jc303_create",           &jc303_create);
    emscripten::function("jc303_destroy",          &jc303_destroy);
    emscripten::function("jc303_init_handle",      &jc303_init_handle);
    emscripten::function("jc303_note_on",          &jc303_note_on);
    emscripten::function("jc303_note_off",         &jc303_note_off);
    emscripten::function("jc303_all_notes_off",    &jc303_all_notes_off);
    emscripten::function("jc303_set_param",        &jc303_set_param);
    emscripten::function("jc303_process_handle",   &jc303_process_handle);
}
