/**
 * jc303_wrapper.cpp
 *
 * Authentic Roland TB-303 / Open303 (rosic) engine compiled into hyphon_native.wasm
 * alongside the custom open303 implementation in open303_wrapper.cpp.
 *
 * Phase 1 of the integration plan: The authentic rosic::Open303 now powers the
 * jc303_* single-instance legacy API (used by open303-processor.ts). Zero
 * TypeScript changes required.
 *
 * The custom tone remains fully available via the open303_* multi-instance API
 * for future per-voice engine selection (Phase 5).
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
#include <cstdlib>
#include <cstring>
#include <memory>
#include <unordered_map>

#include "rosic_Open303.h"

using namespace rosic;
using namespace emscripten;

// ─────────────────────────────────────────────────────────────────────────────
// Parameter IDs (keep in sync with Open303Params.ts)
// ─────────────────────────────────────────────────────────────────────────────

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
// Jc303Instance
// ─────────────────────────────────────────────────────────────────────────────

struct Jc303Instance {
    Open303* synth   = nullptr;
    float*   outBuf  = nullptr;
    int      bufSize = 128;
    float    sampleRate = 44100.0f;

    Jc303Instance() = default;

    ~Jc303Instance()
    {
        delete synth;
        std::free(outBuf);
    }

    void init(float sr, int bs)
    {
        sampleRate = sr;
        bufSize = (bs > 0) ? bs : 128;

        delete synth;
        synth = new Open303();
        synth->setSampleRate(sampleRate);

        std::free(outBuf);
        outBuf = static_cast<float*>(std::malloc(static_cast<size_t>(bufSize) * sizeof(float)));
        if (outBuf) {
            std::memset(outBuf, 0, static_cast<size_t>(bufSize) * sizeof(float));
        }

        // Devil Fish / extended defaults (from plan)
        synth->setNormalAttack(0.3);
        synth->setAccentAttack(3.0);
        synth->setAccentDecay(200.0);
        synth->setAmpDecay(1230.0);
        synth->setAmpSustain(0.0);
        synth->setSlideTime(60.0);
        synth->setTanhShaperDrive(0.0);
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
                synth->setVolume(linToLin(value, 0.0, 1.0, -60.0, 0.0));
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

    void process(float* output, int numFrames)
    {
        if (!synth || !output) return;
        for (int i = 0; i < numFrames; ++i) {
            output[i] = static_cast<float>(synth->getSample());
        }
    }

    float* processInternal(int numFrames)
    {
        if (!outBuf) return nullptr;
        const int frames = std::min(numFrames, bufSize);
        process(outBuf, frames);
        return outBuf;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Multi-instance registry
// ─────────────────────────────────────────────────────────────────────────────

static std::unordered_map<uintptr_t, std::unique_ptr<Jc303Instance>> g_jcInstances;
static uintptr_t g_jcNextHandle = 1;

static Jc303Instance* lookupJc(uintptr_t h)
{
    auto it = g_jcInstances.find(h);
    return (it != g_jcInstances.end()) ? it->second.get() : nullptr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-instance C API
// ─────────────────────────────────────────────────────────────────────────────

extern "C" {

EMSCRIPTEN_KEEPALIVE uintptr_t jc303_create()
{
    auto inst = std::make_unique<Jc303Instance>();
    uintptr_t h = g_jcNextHandle++;
    g_jcInstances[h] = std::move(inst);
    return h;
}

EMSCRIPTEN_KEEPALIVE void jc303_destroy(uintptr_t handle)
{
    g_jcInstances.erase(handle);
}

EMSCRIPTEN_KEEPALIVE int jc303_init_handle(uintptr_t handle, float sr, int bs)
{
    Jc303Instance* inst = lookupJc(handle);
    if (!inst) return 0;
    inst->init(sr, bs);
    return (inst->synth && inst->outBuf) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE void jc303_note_on(uintptr_t h, int note, float vel)
{
    if (auto* inst = lookupJc(h)) inst->noteOn(note, vel);
}

EMSCRIPTEN_KEEPALIVE void jc303_note_off(uintptr_t h, int note)
{
    if (auto* inst = lookupJc(h)) inst->noteOff(note);
}

EMSCRIPTEN_KEEPALIVE void jc303_all_notes_off(uintptr_t h)
{
    if (auto* inst = lookupJc(h)) inst->allNotesOff();
}

EMSCRIPTEN_KEEPALIVE void jc303_set_param(uintptr_t h, int pid, float v)
{
    if (auto* inst = lookupJc(h)) inst->setParam(pid, v);
}

EMSCRIPTEN_KEEPALIVE uintptr_t jc303_process_handle(uintptr_t handle, int numFrames)
{
    Jc303Instance* inst = lookupJc(handle);
    if (!inst) return 0;
    float* buf = inst->processInternal(numFrames);
    return reinterpret_cast<uintptr_t>(buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-instance legacy API
//
// Only reachable from the standalone jc303-single.wasm code path in
// open303-processor.ts (the fallback taken when open303_* is absent).
// hyphon_native.wasm always exposes open303_*, so release builds compile this
// block out — set HYPHON_LEGACY_JC303=1 (the default for the debug profile) to
// keep it. See emscripten/build.sh and docs/wasm/BUILD_NOTES.md.
// ─────────────────────────────────────────────────────────────────────────────
#ifndef HYPHON_LEGACY_JC303
#define HYPHON_LEGACY_JC303 0
#endif

#if HYPHON_LEGACY_JC303

static Jc303Instance* g_jcDefault = nullptr;
static int g_jcDefaultBufSz = 128;

EMSCRIPTEN_KEEPALIVE int jc303_init(float sr, int bs)
{
    if (!g_jcDefault) g_jcDefault = new Jc303Instance();
    if (bs <= 0) bs = 128;
    g_jcDefaultBufSz = bs;
    g_jcDefault->init(sr, bs);
    return 1;
}

EMSCRIPTEN_KEEPALIVE void jc303_noteOn(int note, float vel)      { if (g_jcDefault) g_jcDefault->noteOn(note, vel); }
EMSCRIPTEN_KEEPALIVE void jc303_noteOff(int note)                { if (g_jcDefault) g_jcDefault->noteOff(note); }
EMSCRIPTEN_KEEPALIVE void jc303_allNotesOff()                    { if (g_jcDefault) g_jcDefault->allNotesOff(); }

EMSCRIPTEN_KEEPALIVE void jc303_setWaveform(float v)  { if (g_jcDefault) g_jcDefault->setParam(JC303_WAVEFORM, v); }
EMSCRIPTEN_KEEPALIVE void jc303_setCutoff(float v)    { if (g_jcDefault) g_jcDefault->setParam(JC303_CUTOFF, v); }
EMSCRIPTEN_KEEPALIVE void jc303_setResonance(float v) { if (g_jcDefault) g_jcDefault->setParam(JC303_RESONANCE, v); }
EMSCRIPTEN_KEEPALIVE void jc303_setEnvMod(float v)    { if (g_jcDefault) g_jcDefault->setParam(JC303_ENV_MOD, v); }
EMSCRIPTEN_KEEPALIVE void jc303_setDecay(float v)     { if (g_jcDefault) g_jcDefault->setParam(JC303_DECAY, v); }
EMSCRIPTEN_KEEPALIVE void jc303_setAccent(float v)    { if (g_jcDefault) g_jcDefault->setParam(JC303_ACCENT, v); }
EMSCRIPTEN_KEEPALIVE void jc303_setVolume(float v)    { if (g_jcDefault) g_jcDefault->setParam(JC303_VOLUME, v); }
EMSCRIPTEN_KEEPALIVE void jc303_setFilterMode(float v){ if (g_jcDefault) g_jcDefault->setParam(JC303_FILTER_MODE, v); }

EMSCRIPTEN_KEEPALIVE uintptr_t jc303_process(int numFrames)
{
    if (!g_jcDefault) return 0;
    float* buf = g_jcDefault->processInternal(std::min(numFrames, g_jcDefaultBufSz));
    return reinterpret_cast<uintptr_t>(buf);
}

#endif // HYPHON_LEGACY_JC303

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

#if HYPHON_LEGACY_JC303
    emscripten::function("jc303_init",             &jc303_init);
    emscripten::function("jc303_noteOn",           &jc303_noteOn);
    emscripten::function("jc303_noteOff",          &jc303_noteOff);
    emscripten::function("jc303_allNotesOff",      &jc303_allNotesOff);
    emscripten::function("jc303_setWaveform",      &jc303_setWaveform);
    emscripten::function("jc303_setCutoff",        &jc303_setCutoff);
    emscripten::function("jc303_setResonance",     &jc303_setResonance);
    emscripten::function("jc303_setEnvMod",        &jc303_setEnvMod);
    emscripten::function("jc303_setDecay",         &jc303_setDecay);
    emscripten::function("jc303_setAccent",        &jc303_setAccent);
    emscripten::function("jc303_setVolume",        &jc303_setVolume);
    emscripten::function("jc303_setFilterMode",    &jc303_setFilterMode);
    emscripten::function("jc303_process",          &jc303_process);
#endif
}
