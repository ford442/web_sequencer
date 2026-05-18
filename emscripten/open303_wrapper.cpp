/**
 * open303_wrapper.cpp
 *
 * TB-303 style synthesizer engine compiled into hyphon_native.wasm.
 *
 * Exposes two complementary APIs:
 *
 *   1. Multi-instance C API (EMSCRIPTEN_KEEPALIVE direct exports):
 *        open303_create()          → uintptr_t handle
 *        open303_destroy(handle)
 *        open303_init(handle, sampleRate, bufferSize) → 1 on success
 *        open303_note_on(handle, midiNote, velocity)
 *        open303_note_off(handle, midiNote)
 *        open303_all_notes_off(handle)
 *        open303_set_param(handle, paramId, value)
 *        open303_process(handle, outputPtr, numFrames)
 *
 *   2. Single-instance backward-compat API (mirrors the jc303_* names
 *      used by the existing open303-processor.ts AudioWorklet):
 *        jc303_init(sampleRate, bufferSize) → 1 on success
 *        jc303_noteOn(midiNote, velocity)
 *        jc303_noteOff(midiNote)
 *        jc303_allNotesOff()
 *        jc303_setWaveform / setCutoff / setResonance / setEnvMod /
 *        jc303_setDecay / setAccent / setVolume / setFilterMode (float value)
 *        jc303_process(numFrames) → uintptr_t pointer to output buffer
 *
 * Both APIs are also exposed via emscripten::bind so they are accessible
 * from the hyphon_native.js module wrapper on the main thread.
 *
 * Parameter IDs for open303_set_param() are defined by the Open303Param enum
 * below and match the constants in src/engines/Open303Params.ts.
 *
 * © 2025 Hyphon contributors – MIT License
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

using namespace emscripten;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

static constexpr float TWO_PI_F = 6.28318530717958647692f;

// ─────────────────────────────────────────────────────────────────────────────
// Parameter IDs  (keep in sync with Open303Params.ts)
// ─────────────────────────────────────────────────────────────────────────────

enum Open303Param : int {
    OPEN303_WAVEFORM      = 0,  // 0.0 = saw, 1.0 = square
    OPEN303_TUNING        = 1,  // 0-1 (0.5 = A4 = 440 Hz)
    OPEN303_CUTOFF        = 2,  // 0-1
    OPEN303_RESONANCE     = 3,  // 0-1
    OPEN303_ENV_MOD       = 4,  // 0-1  (filter envelope depth)
    OPEN303_DECAY         = 5,  // 0-1
    OPEN303_ACCENT        = 6,  // 0-1
    OPEN303_VOLUME        = 7,  // 0-1
    OPEN303_FILTER_MODE   = 8,  // reserved  (future LP/BP/HP blend)
    OPEN303_NORMAL_DECAY  = 9,  // Devil Fish: normal decay time
    OPEN303_ACCENT_DECAY  = 10, // Devil Fish: accent decay time
    OPEN303_SLIDE_TIME    = 11, // portamento time
    OPEN303_SOFT_ATTACK   = 12, // soft attack modulation depth
    OPEN303_SQUARE_DRIVER = 13, // square-wave overdrive
};

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

static inline float midiToFreq(int midiNote)
{
    return 440.0f * std::pow(2.0f, (midiNote - 69) / 12.0f);
}

/** Pade-approximant tanh (accurate to < 0.5 % for |x| ≤ 3). */
static inline float fastTanh(float x)
{
    const float x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}

/** Velocity threshold above which a noteOn triggers the accent path. */
static constexpr float ACCENT_VELOCITY_THRESHOLD = 100.0f;



struct MoogFilter {
    float s[4] = {};  // integrator states

    /**
     * Process one sample.
     * @param input      dry sample (±1.0 range)
     * @param fcNorm     normalised cutoff frequency [0..1]
     *                   maps exponentially to ~20 Hz … ~8 kHz
     * @param res        resonance [0..1] (1.0 approaches self-oscillation)
     * @param sampleRate sample rate in Hz
     */
    float process(float input, float fcNorm, float res, float sampleRate)
    {
        // Exponential frequency mapping: 20 Hz at 0, 8000 Hz at 1
        float freqHz = 20.0f * std::pow(400.0f, fcNorm);
        freqHz = std::min(freqHz, sampleRate * 0.49f);

        const float g  = TWO_PI_F * freqHz / sampleRate;
        const float gp = g / (1.0f + g);       // one-pole coefficient
        const float k  = res * 3.9f;            // feedback gain (0..≈4)

        // Feedback from the last stage
        const float fb   = k * s[3];
        const float inFb = fastTanh(input - fb);

        // 4 cascaded trapezoidal one-pole stages
        float v0 = (inFb - s[0]) * gp;  float y0 = v0 + s[0];  s[0] = y0 + v0;
        float v1 = (y0  - s[1]) * gp;  float y1 = v1 + s[1];  s[1] = y1 + v1;
        float v2 = (y1  - s[2]) * gp;  float y2 = v2 + s[2];  s[2] = y2 + v2;
        float v3 = (y2  - s[3]) * gp;  float y3 = v3 + s[3];  s[3] = y3 + v3;

        return y3;
    }

    void reset() { for (auto& x : s) x = 0.0f; }
};

// ─────────────────────────────────────────────────────────────────────────────
// Open303Instance  – single TB-303 voice
// ─────────────────────────────────────────────────────────────────────────────

struct Open303Instance {
    // ── Sample rate ──────────────────────────────────────────────────────────
    float sampleRate  = 44100.0f;

    // ── Parameters ───────────────────────────────────────────────────────────
    float waveform    = 0.0f;    // 0 = saw, 1 = square
    float tuning      = 0.5f;
    float cutoff      = 0.0f;
    float resonance   = 0.92f;
    float envMod      = 0.0f;
    float decay       = 0.3f;
    float accent      = 0.78f;
    float volume      = 0.75f;
    float filterMode  = 0.0f;
    float normalDecay = 0.3f;
    float accentDecay = 0.03f;
    float slideTime   = 0.33f;
    float softAttack  = 0.26f;
    float squareDrv   = 0.25f;

    // ── Oscillator state ─────────────────────────────────────────────────────
    float phase       = 0.0f;
    float currentFreq = 440.0f;
    float targetFreq  = 440.0f;
    float slideCoeff  = 1.0f;   // per-sample frequency multiplier for portamento

    // ── Envelope state ───────────────────────────────────────────────────────
    float envLevel    = 0.0f;
    float envDecayRate= 0.999f;
    bool  gateOpen    = false;
    bool  accented    = false;

    // ── Filter ───────────────────────────────────────────────────────────────
    MoogFilter filter;

    // ── Output buffer (owned, allocated once in init) ────────────────────────
    float* outBuf  = nullptr;
    int    bufSize = 128;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    Open303Instance() = default;

    ~Open303Instance()
    {
        std::free(outBuf);
        outBuf = nullptr;
    }

    void init(float sr, int bs)
    {
        sampleRate = sr;
        bufSize    = (bs > 0) ? bs : 128;
        std::free(outBuf);
        outBuf = static_cast<float*>(std::malloc(static_cast<std::size_t>(bufSize) * sizeof(float)));
        if (outBuf) {
            std::memset(outBuf, 0, static_cast<std::size_t>(bufSize) * sizeof(float));
        } else {
            // Allocation failed: mark bufSize as 0 so processInternal returns nullptr
            bufSize = 0;
        }
        filter.reset();
        updateDecayRate();
    }

    // ── Parameters ───────────────────────────────────────────────────────────

    void setParam(int paramId, float value)
    {
        switch (paramId) {
            case OPEN303_WAVEFORM:      waveform    = value; break;
            case OPEN303_TUNING:        tuning      = value; break;
            case OPEN303_CUTOFF:        cutoff      = value; break;
            case OPEN303_RESONANCE:     resonance   = value; break;
            case OPEN303_ENV_MOD:       envMod      = value; break;
            case OPEN303_DECAY:         decay       = value; updateDecayRate(); break;
            case OPEN303_ACCENT:        accent      = value; break;
            case OPEN303_VOLUME:        volume      = value; break;
            case OPEN303_FILTER_MODE:   filterMode  = value; break;
            case OPEN303_NORMAL_DECAY:  normalDecay = value; break;
            case OPEN303_ACCENT_DECAY:  accentDecay = value; break;
            case OPEN303_SLIDE_TIME:    slideTime   = value; break;
            case OPEN303_SOFT_ATTACK:   softAttack  = value; break;
            case OPEN303_SQUARE_DRIVER: squareDrv   = value; break;
            default: break;
        }
    }

    // ── Envelope ─────────────────────────────────────────────────────────────

    void updateDecayRate()
    {
        // Map [0..1] → [50 ms .. 2 s] decay time
        float timeS = 0.05f + decay * 1.95f;
        // Accent shortens the decay further
        if (accented) timeS *= (0.05f + accentDecay * 0.95f);
        envDecayRate = std::exp(-1.0f / (sampleRate * timeS));
    }

    // ── Note control ─────────────────────────────────────────────────────────

    void noteOn(int midiNote, float velocity)
    {
        float freq = midiToFreq(midiNote);
        targetFreq = freq;

        if (gateOpen && slideTime > 0.0f && currentFreq > 0.0f) {
            // Portamento: compute per-sample exponential glide coefficient
            const float slideSeconds = 0.01f + slideTime * 0.49f;
            const float ratio = targetFreq / currentFreq;
            if (ratio > 0.0f && ratio != 1.0f) {
                slideCoeff = std::pow(ratio, 1.0f / (slideSeconds * sampleRate));
            } else {
                slideCoeff  = 1.0f;
                currentFreq = targetFreq;
            }
        } else {
            currentFreq = freq;
            slideCoeff  = 1.0f;
        }

        accented  = (velocity > ACCENT_VELOCITY_THRESHOLD);
        gateOpen  = true;
        envLevel  = 1.0f;
        updateDecayRate();
    }

    void noteOff(int /*midiNote*/)
    {
        gateOpen = false;
        // 303 behaviour: envelope continues decaying after note-off
    }

    void allNotesOff()
    {
        gateOpen    = false;
        envLevel    = 0.0f;
        currentFreq = targetFreq;
        slideCoeff  = 1.0f;
        filter.reset();
    }

    // ── Audio render ─────────────────────────────────────────────────────────

    void process(float* output, int numFrames)
    {
        if (!output) return;

        for (int i = 0; i < numFrames; ++i) {
            // --- Portamento (exponential slide) ---
            if (slideCoeff != 1.0f) {
                currentFreq *= slideCoeff;
                const bool reached = (slideCoeff > 1.0f)
                    ? (currentFreq >= targetFreq)
                    : (currentFreq <= targetFreq);
                if (reached) {
                    currentFreq = targetFreq;
                    slideCoeff  = 1.0f;
                }
            }

            // --- Oscillator ---
            const float phaseInc = currentFreq / sampleRate;
            phase += phaseInc;
            if (phase >= 1.0f) phase -= 1.0f;

            float osc;
            if (waveform < 0.5f) {
                osc = 2.0f * phase - 1.0f;   // sawtooth
            } else {
                // Square with soft overdrive controlled by squareDrv
                const float sq    = (phase < 0.5f) ? 1.0f : -1.0f;
                const float drive = 1.0f + squareDrv * 3.0f;
                osc = fastTanh(sq * drive);
            }

            // --- Envelope: always decays (303 behaviour) ---
            envLevel *= envDecayRate;
            if (envLevel < 1.0e-6f) envLevel = 0.0f;

            // --- Filter cutoff with envelope modulation ---
            const float accentBoost = accented ? (accent * 0.4f * envLevel) : 0.0f;
            const float totalCutoff = std::min(1.0f, cutoff + envMod * envLevel + accentBoost);

            // --- Filter ---
            const float filtered = filter.process(osc, totalCutoff, resonance, sampleRate);

            // --- Output gain ---
            float gain = volume;
            if (accented) gain *= (1.0f + accent * 0.3f);
            output[i] = filtered * gain;
        }
    }

    /** Process into the internal buffer and return a raw pointer. */
    float* processInternal(int numFrames)
    {
        if (!outBuf) return nullptr;
        const int frames = std::min(numFrames, bufSize);
        process(outBuf, frames);
        return outBuf;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Instance registry
// ─────────────────────────────────────────────────────────────────────────────

static std::unordered_map<uintptr_t, std::unique_ptr<Open303Instance>> g_instances;
static uintptr_t g_nextHandle = 1;

static Open303Instance* lookupInstance(uintptr_t handle)
{
    auto it = g_instances.find(handle);
    return (it != g_instances.end()) ? it->second.get() : nullptr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-instance C API
//
// Functions are marked EMSCRIPTEN_KEEPALIVE so they survive link-time
// dead-code elimination even when --bind is active. They are also registered
// via embind below for use from the hyphon_native.js main-thread wrapper.
// ─────────────────────────────────────────────────────────────────────────────

extern "C" {

EMSCRIPTEN_KEEPALIVE
uintptr_t open303_create()
{
    auto inst   = std::make_unique<Open303Instance>();
    uintptr_t h = g_nextHandle++;
    g_instances[h] = std::move(inst);
    return h;
}

EMSCRIPTEN_KEEPALIVE
void open303_destroy(uintptr_t handle)
{
    g_instances.erase(handle);
}

EMSCRIPTEN_KEEPALIVE
int open303_init(uintptr_t handle, float sampleRate, int bufferSize)
{
    Open303Instance* inst = lookupInstance(handle);
    if (!inst) return 0;
    inst->init(sampleRate, bufferSize);
    // Report failure if the output buffer could not be allocated
    return (inst->outBuf != nullptr) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void open303_note_on(uintptr_t handle, int midiNote, float velocity)
{
    Open303Instance* inst = lookupInstance(handle);
    if (inst) inst->noteOn(midiNote, velocity);
}

EMSCRIPTEN_KEEPALIVE
void open303_note_off(uintptr_t handle, int midiNote)
{
    Open303Instance* inst = lookupInstance(handle);
    if (inst) inst->noteOff(midiNote);
}

EMSCRIPTEN_KEEPALIVE
void open303_all_notes_off(uintptr_t handle)
{
    Open303Instance* inst = lookupInstance(handle);
    if (inst) inst->allNotesOff();
}

EMSCRIPTEN_KEEPALIVE
void open303_set_param(uintptr_t handle, int paramId, float value)
{
    Open303Instance* inst = lookupInstance(handle);
    if (inst) inst->setParam(paramId, value);
}

/**
 * Render @p numFrames of audio into the caller-supplied buffer at @p outputPtr.
 * The caller is responsible for allocating and freeing the output buffer.
 */
EMSCRIPTEN_KEEPALIVE
void open303_process(uintptr_t handle, uintptr_t outputPtr, int numFrames)
{
    Open303Instance* inst = lookupInstance(handle);
    if (!inst) return;
    float* out = reinterpret_cast<float*>(outputPtr);
    inst->process(out, numFrames);
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-instance backward-compat API  (jc303_* names)
//
// These mirror the exports expected by the existing open303-processor.ts so
// that hyphon_native.wasm can be used as a drop-in replacement for the
// standalone jc303-single.wasm when the worklet detects these exports.
// ─────────────────────────────────────────────────────────────────────────────

static Open303Instance* g_defaultInst   = nullptr;
static int              g_defaultBufSz  = 128;

EMSCRIPTEN_KEEPALIVE
int jc303_init(float sampleRate, int bufferSize)
{
    if (!g_defaultInst) g_defaultInst = new Open303Instance();
    if (bufferSize <= 0) bufferSize = 128;
    g_defaultBufSz = bufferSize;
    g_defaultInst->init(sampleRate, bufferSize);
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void jc303_noteOn(int midiNote, float velocity)
{
    if (g_defaultInst) g_defaultInst->noteOn(midiNote, velocity);
}

EMSCRIPTEN_KEEPALIVE
void jc303_noteOff(int midiNote)
{
    if (g_defaultInst) g_defaultInst->noteOff(midiNote);
}

EMSCRIPTEN_KEEPALIVE
void jc303_allNotesOff()
{
    if (g_defaultInst) g_defaultInst->allNotesOff();
}

EMSCRIPTEN_KEEPALIVE
void jc303_setWaveform(float v)    { if (g_defaultInst) g_defaultInst->setParam(OPEN303_WAVEFORM,      v); }

EMSCRIPTEN_KEEPALIVE
void jc303_setCutoff(float v)      { if (g_defaultInst) g_defaultInst->setParam(OPEN303_CUTOFF,        v); }

EMSCRIPTEN_KEEPALIVE
void jc303_setResonance(float v)   { if (g_defaultInst) g_defaultInst->setParam(OPEN303_RESONANCE,     v); }

EMSCRIPTEN_KEEPALIVE
void jc303_setEnvMod(float v)      { if (g_defaultInst) g_defaultInst->setParam(OPEN303_ENV_MOD,       v); }

EMSCRIPTEN_KEEPALIVE
void jc303_setDecay(float v)       { if (g_defaultInst) g_defaultInst->setParam(OPEN303_DECAY,         v); }

EMSCRIPTEN_KEEPALIVE
void jc303_setAccent(float v)      { if (g_defaultInst) g_defaultInst->setParam(OPEN303_ACCENT,        v); }

EMSCRIPTEN_KEEPALIVE
void jc303_setVolume(float v)      { if (g_defaultInst) g_defaultInst->setParam(OPEN303_VOLUME,        v); }

EMSCRIPTEN_KEEPALIVE
void jc303_setFilterMode(float v)  { if (g_defaultInst) g_defaultInst->setParam(OPEN303_FILTER_MODE,   v); }

/**
 * Render one block into the internal buffer.
 * @return pointer to float output buffer (owned by the instance, do NOT free).
 *         Returns 0 on failure.
 */
EMSCRIPTEN_KEEPALIVE
uintptr_t jc303_process(int numFrames)
{
    if (!g_defaultInst || numFrames <= 0) return 0;
    float* out = g_defaultInst->processInternal(std::min(numFrames, g_defaultBufSz));
    return reinterpret_cast<uintptr_t>(out);
}

} // extern "C"

// ─────────────────────────────────────────────────────────────────────────────
// Embind bindings  (makes the same functions callable from the JS module
// wrapper / main-thread AudioDSP bridge)
// ─────────────────────────────────────────────────────────────────────────────

EMSCRIPTEN_BINDINGS(open303_module) {
    // Multi-instance API
    function("open303_create",        &open303_create);
    function("open303_destroy",       &open303_destroy);
    function("open303_init",          &open303_init);
    function("open303_note_on",       &open303_note_on);
    function("open303_note_off",      &open303_note_off);
    function("open303_all_notes_off", &open303_all_notes_off);
    function("open303_set_param",     &open303_set_param);
    function("open303_process",       &open303_process);

    // Single-instance backward-compat API
    function("jc303_init",            &jc303_init);
    function("jc303_noteOn",          &jc303_noteOn);
    function("jc303_noteOff",         &jc303_noteOff);
    function("jc303_allNotesOff",     &jc303_allNotesOff);
    function("jc303_setWaveform",     &jc303_setWaveform);
    function("jc303_setCutoff",       &jc303_setCutoff);
    function("jc303_setResonance",    &jc303_setResonance);
    function("jc303_setEnvMod",       &jc303_setEnvMod);
    function("jc303_setDecay",        &jc303_setDecay);
    function("jc303_setAccent",       &jc303_setAccent);
    function("jc303_setVolume",       &jc303_setVolume);
    function("jc303_setFilterMode",   &jc303_setFilterMode);
    function("jc303_process",         &jc303_process);
}
