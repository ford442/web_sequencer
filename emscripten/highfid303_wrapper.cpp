/**
 * highfid303_wrapper.cpp
 *
 * Phase-2 (#975) offline high-fidelity TB-303 reference ("highfid-cpu").
 *
 * Topology (closes Phase-0 gaps G1–G4 for the offline oracle):
 *   - Diode-ladder filter (mystran / kunn TB_303 style, Tim Stinchcombe lineage)
 *   - Per-feedback soft nonlinearity (`shape` = cubic clip) ENABLED
 *   - Feedback high-pass (~150 Hz) in the resonance loop
 *   - PolyBLEP band-limited saw / square oscillator
 *   - Coupled accent envelope (short attack → decay) modulating filter + VCA
 *   - Optional oversampling (1|2|4) for offline / freeze / export
 *
 * Also driven in real time by the `live-highfid` voice (Phase L1/L2/L3,
 * src/audio-worklets/liveHighFid303.ts) at oversample 1.
 *
 * Built on the shared voice core (emscripten/core/voice.h, #1344). Generic
 * exports from HYPHON_EXPORT_VOICE:
 *   highfid303_create / _destroy / _init(handle, sampleRate, maxFrames)
 *   highfid303_push_event / _render (sample-accurate) / _cancel_notes
 * Events: hyphon::kNoteOn (target = note, value = MIDI velocity), kNoteOff,
 * kAllNotesOff, kParam (target = HighFidParam).
 *
 * Immediate API (EMSCRIPTEN_KEEPALIVE):
 *   highfid303_note_on / note_off / all_notes_off
 *   highfid303_set_param / set_oversample / get_oversample
 *   highfid303_process(handle, outputPtr, numFrames)   — into a caller buffer
 *
 * Parameter IDs 0–13 match Open303Param (src/engines/Open303Params.ts).
 * Ids 14–17 are the editable diode-ladder coefficients (Phase L3) — see
 * src/audio-worklets/liveHighFidCoefficients.ts. Their defaults are the
 * canonical preset and reproduce the pre-L3 output bit for bit, which is what
 * the spectrogram / RMS gates measure.
 *
 * Built with compile_cpp (NOT compile_cpp_fast): -ffast-math would let the
 * compiler reassociate the canonical-preset maths and break bit-exactness.
 */

#include <emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "core/voice.h"
#include "core/voice_exports.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static constexpr float TWO_PI_F = 6.28318530717958647692f;
static constexpr float SQRT2_F  = 1.4142135623730951f;
static constexpr float ACCENT_VELOCITY_THRESHOLD = 100.0f;
static constexpr float FEEDBACK_HP_HZ = 150.0f;

enum HighFidParam : int {
    HF_WAVEFORM      = 0,
    HF_TUNING        = 1,
    HF_CUTOFF        = 2,
    HF_RESONANCE     = 3,
    HF_ENV_MOD       = 4,
    HF_DECAY         = 5,
    HF_ACCENT        = 6,
    HF_VOLUME        = 7,
    HF_FILTER_MODE   = 8,
    HF_NORMAL_DECAY  = 9,
    HF_ACCENT_DECAY  = 10,
    HF_SLIDE_TIME    = 11,
    HF_SOFT_ATTACK   = 12,
    HF_SQUARE_DRIVER = 13,
    // Phase L3 — editable diode-ladder coefficients (HIGHFID_COEFFICIENT_PARAM_IDS).
    HF_TRANSISTOR_MISMATCH = 14,
    HF_DECAY_CURVE         = 15,
    HF_ACCENT_COUPLING     = 16,
    HF_FILTER_TRACKING     = 17,
};

// Canonical preset (CANONICAL_HIGHFID_COEFFICIENTS). accentCoupling 0.45 is the
// constant the accent path hard-coded before L3.
static constexpr float CANON_ACCENT_COUPLING = 0.45f;
// Per-stage pole spread for full transistor mismatch (stage b0 *= 1 + m·s).
static constexpr float MISMATCH_SPREAD[4] = { 0.08f, -0.05f, 0.06f, -0.09f };
// Filter-tracking reference pitch (C4): no cutoff shift at this note.
static constexpr float TRACKING_REF_HZ = 261.6256f;

static inline float midiToFreq(int midiNote)
{
    return 440.0f * std::pow(2.0f, (midiNote - 69) / 12.0f);
}

static inline float fastTanh(float x)
{
    const float x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}

static inline float clampf(float x, float lo, float hi)
{
    return std::max(lo, std::min(hi, x));
}

/** Cubic soft clip used as diode soft-nonlinearity (TeeBeeFilter::shape). */
static inline float diodeShape(float x)
{
    x = clampf(x, -SQRT2_F, SQRT2_F);
    return x - (x * x * x) * (1.0f / 6.0f);
}

static inline float polyBlep(float t, float dt)
{
    if (dt <= 0.0f) return 0.0f;
    if (t < dt) {
        t /= dt;
        return t + t - t * t - 1.0f;
    }
    if (t > 1.0f - dt) {
        t = (t - 1.0f) / dt;
        return t * t + t + t + 1.0f;
    }
    return 0.0f;
}

// ─────────────────────────────────────────────────────────────────────────────
// One-pole high-pass (feedback path) — bilinear, matches ~TeeBee feedback HP
// ─────────────────────────────────────────────────────────────────────────────

struct OnePoleHP {
    float b0 = 1.0f, b1 = 0.0f, a1 = 0.0f;
    float x1 = 0.0f, y1 = 0.0f;

    void setCutoff(float hz, float sampleRate)
    {
        hz = clampf(hz, 1.0f, sampleRate * 0.45f);
        const float wc = TWO_PI_F * hz / sampleRate;
        const float c = (1.0f - std::tan(wc * 0.5f)) / (1.0f + std::tan(wc * 0.5f));
        // High-pass: y = c*(y_prev + x - x_prev)  ≈ first-order HP
        a1 = c;
        b0 = (1.0f + c) * 0.5f;
        b1 = -(1.0f + c) * 0.5f;
    }

    float process(float x)
    {
        const float y = b0 * x + b1 * x1 + a1 * y1;
        x1 = x;
        y1 = y;
        return y;
    }

    void reset() { x1 = y1 = 0.0f; }
};

// ─────────────────────────────────────────────────────────────────────────────
// Diode-ladder filter (mystran / kunn TB_303 discretisation)
// ─────────────────────────────────────────────────────────────────────────────

struct DiodeLadderFilter {
    float y1 = 0.0f, y2 = 0.0f, y3 = 0.0f, y4 = 0.0f;
    float b0 = 0.5f;
    // Per-stage coefficients. With mismatch 0 each is b0 * 1.0f == b0 exactly.
    float b0s[4] = { 0.5f, 0.5f, 0.5f, 0.5f };
    float mismatch = 0.0f;
    float k  = 0.0f;
    float g  = 1.0f;
    float sampleRate = 44100.0f;
    OnePoleHP feedbackHp;
    // Pre-filter osc band-limit (mimics mip-mapped wavetable HF removal)
    float oscLpY = 0.0f;
    float oscLpCoeff = 0.5f;

    void setSampleRate(float sr)
    {
        sampleRate = sr;
        feedbackHp.setCutoff(FEEDBACK_HP_HZ, sr);
    }

    void reset()
    {
        y1 = y2 = y3 = y4 = 0.0f;
        oscLpY = 0.0f;
        feedbackHp.reset();
    }

    void setCutoffResonance(float cutoffHz, float resonance01)
    {
        cutoffHz = clampf(cutoffHz, 40.0f, sampleRate * 0.45f);
        const float r = clampf(resonance01, 0.0f, 1.0f);
        const float resonanceSkewed = (1.0f - std::exp(-3.0f * r)) / (1.0f - std::exp(-3.0f));

        const float wc = TWO_PI_F * cutoffHz / sampleRate;
        const float fx = wc * 0.7071067811865476f / TWO_PI_F;

        b0 = (0.00045522346f + 6.1922189f * fx) /
             (1.0f + 12.358354f * fx + 4.4156345f * (fx * fx));
        for (int s = 0; s < 4; ++s) {
            b0s[s] = b0 * (1.0f + mismatch * MISMATCH_SPREAD[s]);
        }

        float kScale = fx * (fx * (fx * (fx * (fx * (fx + 7198.6997f)
                        - 5837.7917f) - 476.47308f) + 614.95611f) + 213.87126f) + 16.998792f;
        g = kScale * 0.058823529411764705f;
        g = (g - 1.0f) * resonanceSkewed + 1.0f;
        g = g * (1.0f + resonanceSkewed);
        k = kScale * resonanceSkewed;

        // Osc pre-LP ~ 2.5× cutoff (wavetable-ish band-limit)
        const float lpHz = clampf(cutoffHz * 2.5f, 200.0f, sampleRate * 0.4f);
        const float lpWc = TWO_PI_F * lpHz / sampleRate;
        oscLpCoeff = lpWc / (1.0f + lpWc);
    }

    float process(float in)
    {
        // Pre-filter the oscillator to suppress the HF that naive/PolyBLEP
        // saws carry into the mid band (G4) — jc303 wavetables do this via mips.
        oscLpY += oscLpCoeff * (in - oscLpY);
        in = oscLpY;

        const float fb = feedbackHp.process(k * diodeShape(y4));
        const float y0 = in - fb;

        y1 += 2.0f * b0s[0] * (y0 - y1 + y2);
        y2 +=       b0s[1] * (y1 - 2.0f * y2 + y3);
        y3 +=       b0s[2] * (y2 - 2.0f * y3 + y4);
        y4 +=       b0s[3] * (y3 - 2.0f * y4);

        y1 = clampf(y1, -8.0f, 8.0f);
        y2 = clampf(y2, -8.0f, 8.0f);
        y3 = clampf(y3, -8.0f, 8.0f);
        y4 = clampf(y4, -8.0f, 8.0f);

        float out = 2.0f * g * y4;
        if (!std::isfinite(out)) {
            reset();
            return 0.0f;
        }
        return out;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// HighFid303Engine — full offline voice
// ─────────────────────────────────────────────────────────────────────────────

struct HighFid303Engine {
    float sampleRate = 44100.0f;
    int   oversampleFactor = 1;

    float waveform   = 0.0f;
    float tuning     = 0.5f;
    float cutoff     = 0.35f;
    float resonance  = 0.70f;
    float envMod     = 0.55f;
    float decay      = 0.50f;
    float accent     = 0.70f;
    float volume     = 0.80f;
    float accentDecay = 0.03f;
    float slideTime  = 0.33f;
    float squareDrv  = 0.25f;

    // Phase L3 coefficients — defaults are the canonical preset.
    float decayCurve     = 0.0f;
    float accentCoupling = CANON_ACCENT_COUPLING;
    float filterTracking = 0.0f;

    float phase        = 0.0f;
    float currentFreq  = 440.0f;
    float targetFreq   = 440.0f;
    float slideCoeff   = 1.0f;

    // Main filter envelope (always decaying when triggered)
    float envLevel     = 0.0f;
    float envDecayRate = 0.999f;

    // Accent envelope: short attack then decay (closes G3 timing)
    float accentEnv    = 0.0f;
    float accentAttackRate = 0.0f;
    float accentDecayRate  = 0.0f;
    bool  accentAttacking  = false;
    bool  accented         = false;
    bool  gateOpen         = false;

    DiodeLadderFilter filter;

    float effectiveSampleRate() const
    {
        return sampleRate * static_cast<float>(oversampleFactor > 0 ? oversampleFactor : 1);
    }

    bool init(float sr, int /*maxFrames*/)
    {
        sampleRate = sr;
        filter.setSampleRate(effectiveSampleRate());
        filter.reset();
        updateRates();
        updateFilterCoeffs();
        return true;
    }

    void setOversample(int factor)
    {
        if (factor != 2 && factor != 4) factor = 1;
        oversampleFactor = factor;
        filter.setSampleRate(effectiveSampleRate());
        updateRates();
        updateFilterCoeffs();
    }

    void setParam(int paramId, float value)
    {
        switch (paramId) {
            case HF_WAVEFORM:      waveform    = value; break;
            case HF_TUNING:        tuning      = value; break;
            case HF_CUTOFF:        cutoff      = value; updateFilterCoeffs(); break;
            case HF_RESONANCE:     resonance   = value; updateFilterCoeffs(); break;
            case HF_ENV_MOD:       envMod      = value; break;
            case HF_DECAY:         decay       = value; updateRates(); break;
            case HF_ACCENT:        accent      = value; break;
            case HF_VOLUME:        volume      = value; break;
            case HF_ACCENT_DECAY:  accentDecay = value; updateRates(); break;
            case HF_SLIDE_TIME:    slideTime   = value; break;
            case HF_SQUARE_DRIVER: squareDrv   = value; break;
            case HF_TRANSISTOR_MISMATCH:
                filter.mismatch = clampf(value, 0.0f, 1.0f); updateFilterCoeffs(); break;
            case HF_DECAY_CURVE:     decayCurve     = clampf(value, 0.0f, 1.0f); break;
            case HF_ACCENT_COUPLING: accentCoupling = clampf(value, 0.0f, 1.0f); break;
            case HF_FILTER_TRACKING:
                filterTracking = clampf(value, 0.0f, 1.0f); updateFilterCoeffs(); break;
            default: break;
        }
    }

    void updateRates()
    {
        const float sr = effectiveSampleRate();
        // Main env: 50 ms .. ~2 s
        float timeS = 0.05f + decay * 1.95f;
        if (accented) timeS *= (0.05f + accentDecay * 0.95f);
        envDecayRate = std::exp(-1.0f / (sr * timeS));

        // Accent attack ~3 ms, decay ~40–120 ms
        accentAttackRate = 1.0f - std::exp(-1.0f / (sr * 0.003f));
        const float accDecS = 0.04f + accent * 0.08f;
        accentDecayRate = std::exp(-1.0f / (sr * accDecS));
    }

    void updateFilterCoeffs()
    {
        // TeeBee-like floor (~200 Hz) and darker top than stock open303 —
        // targets soft-oracle spectral body (G2 / mid-band).
        // Canonical preset takes the unshaped / untracked branches, so the
        // arithmetic is exactly the pre-L3 expression.
        const float envShaped = (decayCurve > 0.0f)
            ? std::pow(envLevel, 1.0f + 3.0f * decayCurve)
            : envLevel;
        const float envBoost = envMod * envShaped + (accented ? accent * accentCoupling * accentEnv : 0.0f);
        const float total = clampf(cutoff + envBoost, 0.0f, 1.0f);
        float hz = 200.0f * std::pow(4500.0f / 200.0f, total);
        if (filterTracking > 0.0f && currentFreq > 0.0f) {
            hz *= std::pow(currentFreq / TRACKING_REF_HZ, filterTracking);
        }
        filter.setCutoffResonance(hz, resonance);
    }

    void noteOn(int midiNote, float velocity)
    {
        const float freq = midiToFreq(midiNote);
        targetFreq = freq;

        if (gateOpen && slideTime > 0.0f && currentFreq > 0.0f) {
            const float slideSeconds = 0.01f + slideTime * 0.49f;
            const float ratio = targetFreq / currentFreq;
            if (ratio > 0.0f && ratio != 1.0f) {
                slideCoeff = std::pow(ratio, 1.0f / (slideSeconds * effectiveSampleRate()));
            } else {
                slideCoeff = 1.0f;
                currentFreq = targetFreq;
            }
        } else {
            currentFreq = freq;
            slideCoeff = 1.0f;
        }

        accented = (velocity > ACCENT_VELOCITY_THRESHOLD);
        gateOpen = true;
        envLevel = 1.0f;
        if (accented) {
            accentEnv = 0.0f;
            accentAttacking = true;
        } else {
            accentEnv = 0.0f;
            accentAttacking = false;
        }
        updateRates();
        updateFilterCoeffs();
    }

    void noteOff(int /*midiNote*/)
    {
        gateOpen = false;
    }

    void allNotesOff()
    {
        gateOpen = false;
        envLevel = 0.0f;
        accentEnv = 0.0f;
        accentAttacking = false;
        currentFreq = targetFreq;
        slideCoeff = 1.0f;
        filter.reset();
    }

    float renderOsc(float srEff)
    {
        const float phaseInc = currentFreq / srEff;
        phase += phaseInc;
        if (phase >= 1.0f) phase -= 1.0f;

        float osc;
        if (waveform < 0.5f) {
            // PolyBLEP saw
            osc = 2.0f * phase - 1.0f;
            osc -= polyBlep(phase, phaseInc);
        } else {
            // PolyBLEP square
            float sq = (phase < 0.5f) ? 1.0f : -1.0f;
            sq += polyBlep(phase, phaseInc);
            float t2 = phase + 0.5f;
            if (t2 >= 1.0f) t2 -= 1.0f;
            sq -= polyBlep(t2, phaseInc);
            const float drive = 1.0f + squareDrv * 2.5f;
            osc = fastTanh(sq * drive);
        }
        return osc;
    }

    float renderSampleAt(float srEff)
    {
        if (slideCoeff != 1.0f) {
            currentFreq *= slideCoeff;
            const bool reached = (slideCoeff > 1.0f)
                ? (currentFreq >= targetFreq)
                : (currentFreq <= targetFreq);
            if (reached) {
                currentFreq = targetFreq;
                slideCoeff = 1.0f;
            }
        }

        // Envelopes
        envLevel *= envDecayRate;
        if (envLevel < 1.0e-6f) envLevel = 0.0f;

        if (accented) {
            if (accentAttacking) {
                accentEnv += (1.0f - accentEnv) * accentAttackRate;
                if (accentEnv > 0.995f) {
                    accentEnv = 1.0f;
                    accentAttacking = false;
                }
            } else {
                accentEnv *= accentDecayRate;
                if (accentEnv < 1.0e-6f) accentEnv = 0.0f;
            }
        }

        updateFilterCoeffs();

        const float osc = renderOsc(srEff);
        float filtered = filter.process(osc);

        float gain = volume;
        if (accented) {
            gain *= (1.0f + accent * 0.35f * accentEnv);
        }
        float out = filtered * gain * 0.55f; // level toward jc303-ish RMS
        if (!std::isfinite(out)) {
            filter.reset();
            return 0.0f;
        }
        return clampf(out, -1.5f, 1.5f);
    }

    void process(float* output, int numFrames)
    {
        if (!output) return;
        const int n = (oversampleFactor == 2 || oversampleFactor == 4) ? oversampleFactor : 1;
        const float srEff = sampleRate * static_cast<float>(n);

        if (n == 1) {
            for (int i = 0; i < numFrames; ++i) {
                output[i] = renderSampleAt(srEff);
            }
            return;
        }

        const float invN = 1.0f / static_cast<float>(n);
        for (int i = 0; i < numFrames; ++i) {
            float acc = 0.0f;
            for (int s = 0; s < n; ++s) {
                acc += renderSampleAt(srEff);
            }
            output[i] = acc * invN;
        }
    }

    void render(float* out, int numFrames) { process(out, numFrames); }

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
};

// ─────────────────────────────────────────────────────────────────────────────
using HighFid303NativeVoice = hyphon::NativeVoice<HighFid303Engine, 256>;

// The live high-fid voice per 303 voice, plus offline renders and slack.
HYPHON_EXPORT_VOICE(highfid303, HighFid303NativeVoice, 16)

extern "C" {

EMSCRIPTEN_KEEPALIVE
void highfid303_note_on(uintptr_t handle, int midiNote, float velocity)
{
    if (auto* v = highfid303_voice(handle)) v->engine.noteOn(midiNote, velocity);
}

EMSCRIPTEN_KEEPALIVE
void highfid303_note_off(uintptr_t handle, int midiNote)
{
    if (auto* v = highfid303_voice(handle)) v->engine.noteOff(midiNote);
}

EMSCRIPTEN_KEEPALIVE
void highfid303_all_notes_off(uintptr_t handle)
{
    if (auto* v = highfid303_voice(handle)) v->engine.allNotesOff();
}

EMSCRIPTEN_KEEPALIVE
void highfid303_set_param(uintptr_t handle, int paramId, float value)
{
    if (auto* v = highfid303_voice(handle)) v->engine.setParam(paramId, value);
}

EMSCRIPTEN_KEEPALIVE
void highfid303_set_oversample(uintptr_t handle, int factor)
{
    if (auto* v = highfid303_voice(handle)) v->engine.setOversample(factor);
}

EMSCRIPTEN_KEEPALIVE
int highfid303_get_oversample(uintptr_t handle)
{
    auto* v = highfid303_voice(handle);
    return v ? v->engine.oversampleFactor : 1;
}

EMSCRIPTEN_KEEPALIVE
void highfid303_process(uintptr_t handle, uintptr_t outputPtr, int numFrames)
{
    auto* v = highfid303_voice(handle);
    if (!v) return;
    v->engine.render(reinterpret_cast<float*>(outputPtr), numFrames);
}

/** Stable engine id string for registry / UI. */
EMSCRIPTEN_KEEPALIVE
const char* highfid303_engine_id()
{
    return "highfid-cpu";
}

} // extern "C"
