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
#include <string>
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

// ─────────────────────────────────────────────────────────────────────────────
// 303 model registry ("303 Voices")
//
// A model is a named sound character. Models in the ENGINE_OPEN303 family are
// coefficient profiles applied to the Open303Instance DSP below; models in the
// ENGINE_JC303 family run on the rosic::Open303 engine (jc303_wrapper.cpp) and
// are selected by the AudioWorklet via the jc303_* multi-instance API.
//
// This table is mirrored by TB303_MODELS in src/engines/TB303Models.ts —
// keep ids in sync. Model ids are persisted in saved songs; never rename.
//
// Adding a new open303-family voice = adding one row here (plus the TS mirror
// entry) and rebuilding with `pnpm run build:emcc`.
// ─────────────────────────────────────────────────────────────────────────────

enum TB303EngineKind : int {
    ENGINE_OPEN303 = 0,
    ENGINE_JC303   = 1,
};

struct Open303ModelProfile {
    const char* id;           // stable identifier (persisted in songs)
    const char* label;        // human-readable name
    int         engine;       // TB303EngineKind

    // Coefficient profile (ENGINE_OPEN303 family; ignored for ENGINE_JC303):
    float cutoffBaseHz;      // filter frequency at fcNorm = 0        (stock 20)
    float cutoffRangeMul;    // exponential range multiplier          (stock 400 → 8 kHz at 1)
    float resFeedback;       // resonance→feedback gain, ≈4 self-osc  (stock 3.9)
    float accentFilterBoost; // accent cutoff boost depth             (stock 0.4)
    float accentGainBoost;   // accent VCA boost depth                (stock 0.3)
    float decayMinS;         // envelope decay at decay = 0           (stock 0.05)
    float decayRangeS;       // envelope decay span                   (stock 1.95)
    float slideMinS;         // portamento time at slideTime = 0      (stock 0.01)
    float slideRangeS;       // portamento time span                  (stock 0.49)
    float squareDriveMul;    // square overdrive depth                (stock 3.0)
    float sawDrive;          // saw waveshaping drive, 0 = pristine   (stock 0.0)
};

static const Open303ModelProfile k303Models[] = {
    // id                label               engine          cutBase range  resFb accFlt accGain decMin decRng sldMin sldRng sqDrv sawDrv
    { "stock-open303",   "Stock Open303",    ENGINE_OPEN303, 20.0f, 400.0f, 3.9f, 0.40f, 0.30f,  0.05f, 1.95f, 0.01f, 0.49f, 3.0f, 0.0f },
    { "jc303",           "Authentic JC303",  ENGINE_JC303,   20.0f, 400.0f, 3.9f, 0.40f, 0.30f,  0.05f, 1.95f, 0.01f, 0.49f, 3.0f, 0.0f },
    // In-house: warmer filter base, rounder accent, slower slides.
    { "1ink303-v1",      "1ink303 v1",       ENGINE_OPEN303, 26.0f, 340.0f, 4.0f, 0.35f, 0.38f,  0.04f, 1.60f, 0.02f, 0.60f, 2.4f, 0.35f },
    // Scratchpad: hotter resonance feedback, snappier envelope, harder accent.
    { "experimental-01", "Experimental 01",  ENGINE_OPEN303, 20.0f, 420.0f, 4.15f, 0.55f, 0.45f, 0.03f, 1.20f, 0.008f, 0.40f, 4.5f, 0.0f },
    // Inspired-by ReBirth RB-338 1.5 (NOT a clone): "squishier" filter — lower,
    // darker cutoff base with hotter resonance feedback for a self-oscillation-
    // prone squish; gooey longer slides; a touch of saw grit. Big accent lift.
    { "rebirth-338-1.5", "ReBirth RB-338 1.5", ENGINE_OPEN303, 22.0f, 380.0f, 4.10f, 0.50f, 0.32f, 0.04f, 1.60f, 0.02f, 0.60f, 3.0f, 0.20f },
    // Inspired-by ReBirth 2.0 (NOT a clone): cleaner/tighter filter than 1.5,
    // punchier accent (VCA + filter), snappier envelope, slightly more drive.
    { "rebirth-2.0",     "ReBirth 2.0",      ENGINE_OPEN303, 20.0f, 410.0f, 3.95f, 0.60f, 0.42f, 0.035f, 1.40f, 0.012f, 0.50f, 3.4f, 0.12f },
    // Inspired-by MAM MB33 mkII (NOT a clone): boxier, more "digital" filter
    // feel — narrower cutoff sweep, distinct accent punch, square/saw grit for
    // the hardware-emulation character.
    { "mb33-mkii",       "MB33 mkII",        ENGINE_OPEN303, 24.0f, 360.0f, 3.85f, 0.52f, 0.38f, 0.045f, 1.70f, 0.014f, 0.45f, 3.8f, 0.25f },
    // Inspired-by Quasimidi Raveolution 309 (NOT a clone): brighter/harsher
    // self-oscillation, aggressive resonance curve, snappy envelope, heavy drive
    // for dance-floor character.
    { "raveolution",     "Raveolution 309",  ENGINE_OPEN303, 18.0f, 440.0f, 4.25f, 0.58f, 0.48f, 0.028f, 1.15f, 0.006f, 0.35f, 4.2f, 0.08f },
};

static constexpr int k303ModelCount = static_cast<int>(sizeof(k303Models) / sizeof(k303Models[0]));

static const Open303ModelProfile* find303Model(int index)
{
    return (index >= 0 && index < k303ModelCount) ? &k303Models[index] : nullptr;
}

/** Registry index of the model with stable id @p id, or -1 if unknown/null. */
static int find303ModelIndexById(const char* id)
{
    if (!id) return -1;
    for (int i = 0; i < k303ModelCount; ++i) {
        if (std::strcmp(k303Models[i].id, id) == 0) return i;
    }
    return -1;
}



struct MoogFilter {
    float s[4] = {};  // integrator states

    /**
     * Process one sample.
     * @param input      dry sample (±1.0 range)
     * @param freqHz     cutoff frequency in Hz (already curve-mapped by the
     *                   caller from the active model profile)
     * @param k          resonance feedback gain (0..≈4, ≈4 self-oscillates)
     * @param sampleRate sample rate in Hz
     */
    float process(float input, float freqHz, float k, float sampleRate)
    {
        freqHz = std::min(freqHz, sampleRate * 0.49f);

        const float g  = TWO_PI_F * freqHz / sampleRate;
        const float gp = g / (1.0f + g);       // one-pole coefficient

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

    // ── Active model profile (index into k303Models; 0 = stock-open303) ──────
    int modelIndex = 0;
    Open303ModelProfile profile = k303Models[0];

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
        // Map [0..1] → decay time range from the active model profile
        // (stock: 50 ms .. 2 s)
        float timeS = profile.decayMinS + decay * profile.decayRangeS;
        // Accent shortens the decay further
        if (accented) timeS *= (0.05f + accentDecay * 0.95f);
        envDecayRate = std::exp(-1.0f / (sampleRate * timeS));
    }

    /** Apply a model coefficient profile ("303 voice"). Returns 1 on success.
     *  Only ENGINE_OPEN303-family models apply here; ENGINE_JC303 models are
     *  routed to the rosic engine by the AudioWorklet. */
    int setModel(int index)
    {
        const Open303ModelProfile* m = find303Model(index);
        if (!m || m->engine != ENGINE_OPEN303) return 0;
        modelIndex = index;
        profile    = *m;
        updateDecayRate();
        return 1;
    }

    // ── Note control ─────────────────────────────────────────────────────────

    void noteOn(int midiNote, float velocity)
    {
        float freq = midiToFreq(midiNote);
        targetFreq = freq;

        if (gateOpen && slideTime > 0.0f && currentFreq > 0.0f) {
            // Portamento: compute per-sample exponential glide coefficient
            const float slideSeconds = profile.slideMinS + slideTime * profile.slideRangeS;
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
                // Optional model waveshaping (sawDrive = 0 keeps the stock
                // path bit-identical — no tanh applied at all)
                if (profile.sawDrive > 0.0f) {
                    osc = fastTanh(osc * (1.0f + profile.sawDrive));
                }
            } else {
                // Square with soft overdrive controlled by squareDrv
                const float sq    = (phase < 0.5f) ? 1.0f : -1.0f;
                const float drive = 1.0f + squareDrv * profile.squareDriveMul;
                osc = fastTanh(sq * drive);
            }

            // --- Envelope: always decays (303 behaviour) ---
            envLevel *= envDecayRate;
            if (envLevel < 1.0e-6f) envLevel = 0.0f;

            // --- Filter cutoff with envelope modulation ---
            const float accentBoost = accented ? (accent * profile.accentFilterBoost * envLevel) : 0.0f;
            const float totalCutoff = std::min(1.0f, cutoff + envMod * envLevel + accentBoost);

            // --- Filter (cutoff curve + feedback gain from the model profile) ---
            const float freqHz = profile.cutoffBaseHz * std::pow(profile.cutoffRangeMul, totalCutoff);
            const float k      = resonance * profile.resFeedback;
            const float filtered = filter.process(osc, freqHz, k, sampleRate);

            // --- Output gain ---
            float gain = volume;
            if (accented) gain *= (1.0f + accent * profile.accentGainBoost);
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

// ── 303 model registry API ("303 Voices") ───────────────────────────────────

/** Number of models in the registry (all engine families). */
EMSCRIPTEN_KEEPALIVE
int open303_get_model_count()
{
    return k303ModelCount;
}

/** Stable id of the model at @p index (null-terminated static string), or 0. */
EMSCRIPTEN_KEEPALIVE
const char* open303_get_model_id(int index)
{
    const Open303ModelProfile* m = find303Model(index);
    return m ? m->id : nullptr;
}

/** Human-readable label of the model at @p index, or 0. */
EMSCRIPTEN_KEEPALIVE
const char* open303_get_model_label(int index)
{
    const Open303ModelProfile* m = find303Model(index);
    return m ? m->label : nullptr;
}

/** Engine family of the model at @p index (TB303EngineKind), or -1. */
EMSCRIPTEN_KEEPALIVE
int open303_get_model_engine(int index)
{
    const Open303ModelProfile* m = find303Model(index);
    return m ? m->engine : -1;
}

/** Apply the model profile at @p index to an open303 instance. Returns 1 on
 *  success, 0 for an unknown index, a jc303-family model, or a bad handle. */
EMSCRIPTEN_KEEPALIVE
int open303_set_model(uintptr_t handle, int index)
{
    Open303Instance* inst = lookupInstance(handle);
    return inst ? inst->setModel(index) : 0;
}

/** Currently applied model index for an open303 instance (default 0 = stock). */
EMSCRIPTEN_KEEPALIVE
int open303_get_model(uintptr_t handle)
{
    Open303Instance* inst = lookupInstance(handle);
    return inst ? inst->modelIndex : -1;
}

/** Registry index of the model with stable string id @p id, or -1. Lets
 *  callers resolve a persisted model id without scanning the id table. */
EMSCRIPTEN_KEEPALIVE
int open303_find_model_index(const char* id)
{
    return find303ModelIndexById(id);
}

/** Apply a model to an open303 instance by its stable string id (the
 *  future-proof `set303Model(instanceId, modelName)` surface). Returns 1 on
 *  success, 0 for an unknown id, a jc303-family model, or a bad handle. */
EMSCRIPTEN_KEEPALIVE
int open303_set_model_by_id(uintptr_t handle, const char* id)
{
    Open303Instance* inst = lookupInstance(handle);
    if (!inst) return 0;
    return inst->setModel(find303ModelIndexById(id));
}

} // extern "C"

/** JSON list of all registered 303 models for dynamic UI population:
 *  [{"id":"stock-open303","label":"Stock Open303","engine":"open303"}, …] */
static std::string getAvailable303Models()
{
    std::string json = "[";
    for (int i = 0; i < k303ModelCount; ++i) {
        const Open303ModelProfile& m = k303Models[i];
        if (i > 0) json += ",";
        json += "{\"id\":\"";
        json += m.id;
        json += "\",\"label\":\"";
        json += m.label;
        json += "\",\"engine\":\"";
        json += (m.engine == ENGINE_JC303) ? "jc303" : "open303";
        json += "\"}";
    }
    json += "]";
    return json;
}

// Embind cannot bind raw pointers to primitives (const char*). These
// std::string wrappers are the main-thread module surface; the extern "C"
// EMSCRIPTEN_KEEPALIVE exports above remain the worklet/ccall path.
static int open303_find_model_index_str(const std::string& id)
{
    return open303_find_model_index(id.c_str());
}

static int open303_set_model_by_id_str(uintptr_t handle, const std::string& id)
{
    return open303_set_model_by_id(handle, id.c_str());
}

// ─────────────────────────────────────────────────────────────────────────────
// Embind bindings  (makes the same functions callable from the JS module
// wrapper / main-thread AudioDSP bridge)
// ─────────────────────────────────────────────────────────────────────────────

EMSCRIPTEN_BINDINGS(open303_module) {
    function("open303_create",        &open303_create);
    function("open303_destroy",       &open303_destroy);
    function("open303_init",          &open303_init);
    function("open303_note_on",       &open303_note_on);
    function("open303_note_off",      &open303_note_off);
    function("open303_all_notes_off", &open303_all_notes_off);
    function("open303_set_param",     &open303_set_param);
    function("open303_process",       &open303_process);

    function("open303_get_model_count",   &open303_get_model_count);
    function("open303_get_model_engine",  &open303_get_model_engine);
    function("open303_set_model",         &open303_set_model);
    function("open303_get_model",         &open303_get_model);
    function("open303_find_model_index",  &open303_find_model_index_str);
    function("open303_set_model_by_id",   &open303_set_model_by_id_str);
    function("getAvailable303Models",     &getAvailable303Models);
}
