/**
 * prophecy_wrapper.cpp
 *
 * Korg Prophecy formant synthesis engine compiled into hyphon_native.wasm.
 *
 * Embeds the DSP from ford442/korg_prophecy_emu inline (no submodule required).
 * All modifications to the upstream DSP code are documented with "// [wrapper mod]"
 * comments so they can be diffed against the source repo.
 *
 * Exposes a multi-instance C API (EMSCRIPTEN_KEEPALIVE direct exports):
 *   prophecy_create()                              → uintptr_t handle
 *   prophecy_destroy(handle)
 *   prophecy_init(handle, sampleRate, bufferSize)  → 1 on success
 *   prophecy_note_on(handle, midiNote, velocity)
 *   prophecy_note_off(handle, midiNote)
 *   prophecy_all_notes_off(handle)
 *   prophecy_set_param(handle, paramId, value)
 *   prophecy_process(handle, numFrames)            → uintptr_t → internal float* buffer
 *
 * Parameter IDs are defined by ProphecyParam enum below and correspond to
 * the constants in src/engines/ProphecyParams.ts.
 *
 * © 2025 Hyphon contributors – MIT License
 * Prophecy DSP code © ford442/korg_prophecy_emu – GPL-3.0
 */

#include <emscripten.h>
#include <emscripten/bind.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <unordered_map>

using namespace emscripten;

// ─────────────────────────────────────────────────────────────────────────────
// Parameter IDs  (keep in sync with ProphecyParams.ts)
// ─────────────────────────────────────────────────────────────────────────────

enum ProphecyParam : int {
    PROPHECY_WAVEFORM      = 0,  // 0=Saw, 1=Square, 2=Triangle, 3=Pulse
    PROPHECY_VOWEL         = 1,  // 0=A, 1=E, 2=I, 3=O, 4=U
    PROPHECY_VOLUME        = 2,  // 0-1
    PROPHECY_ATTACK        = 3,  // 0-1 → mapped to 0.001s – 2.0s
    PROPHECY_DECAY         = 4,  // 0-1 → mapped to 0.01s  – 2.0s
    PROPHECY_SUSTAIN       = 5,  // 0-1 (sustain amplitude level)
    PROPHECY_RELEASE       = 6,  // 0-1 → mapped to 0.01s  – 3.0s
    PROPHECY_PORTAMENTO    = 7,  // 0-1 (portamento rate coefficient)
    PROPHECY_FORMANT_SHIFT = 8,  // 0-1 (shifts all formant frequencies up, 0 = neutral)
    PROPHECY_RESONANCE     = 9,  // 0-1 (scales formant filter bandwidth; smaller = narrower / more resonant)
};

// ─────────────────────────────────────────────────────────────────────────────
// DSP utilities (from ford442/korg_prophecy_emu include/DSPUtils.h)
// ─────────────────────────────────────────────────────────────────────────────

namespace ProphecyDSP {

static constexpr double PI     = 3.14159265358979323846;
static constexpr float  TWO_PI = static_cast<float>(2.0 * PI);
// [wrapper mod] DEFAULT_SAMPLE_RATE changed from compile-time constexpr to a
// runtime-settable default. Per-instance SR is passed through each voice.
static constexpr float DEFAULT_SAMPLE_RATE = 44100.0f;
static constexpr int   MAX_VOICES  = 4;

// Authentic Prophecy vowel formant data (Korg Prophecy Parameter Guide)
struct FormantSet {
    float frequencies[4];   // F1-F4 centre frequencies (Hz)
    float bandwidths[4];    // Bandwidth (Hz)
    const char* phoneme;
};

static constexpr FormantSet FORMANT_A = {
    {730.0f, 1090.0f, 2440.0f, 3400.0f},
    {100.0f,  110.0f,  140.0f,  180.0f},
    "A"
};
static constexpr FormantSet FORMANT_E = {
    {270.0f, 2290.0f, 3010.0f, 3600.0f},
    { 80.0f,  120.0f,  160.0f,  200.0f},
    "E"
};
static constexpr FormantSet FORMANT_I = {
    {390.0f, 1990.0f, 2550.0f, 3500.0f},
    { 90.0f,  110.0f,  150.0f,  190.0f},
    "I"
};
static constexpr FormantSet FORMANT_O = {
    {570.0f,  840.0f, 2410.0f, 3300.0f},
    { 95.0f,  100.0f,  140.0f,  170.0f},
    "O"
};
static constexpr FormantSet FORMANT_U = {
    {300.0f,  870.0f, 2240.0f, 3200.0f},
    { 70.0f,   95.0f,  130.0f,  160.0f},
    "U"
};

// MIDI to Hz  (A4 = 440 Hz)
static inline float midiNoteToFrequency(int note)
{
    return 440.0f * powf(2.0f, (note - 69) / 12.0f);
}

// PolyBLEP anti-aliasing correction (from DSPUtils.h)
static inline float polyBLEP(float t, float dt)
{
    if (t < dt) {
        t /= dt;
        return t + t - t * t - 1.0f;
    } else if (t > 1.0f - dt) {
        t = (t - 1.0f) / dt;
        return t * t + t + t + 1.0f;
    }
    return 0.0f;
}

// ─────────────────────────────────────────────────────────────────────────────
// BiquadFilter  (from ford442/korg_prophecy_emu include/BiquadFilter.h)
// [wrapper mod] removed dependency on DSPUtils.h header; uses TWO_PI above.
// ─────────────────────────────────────────────────────────────────────────────

class BiquadFilter {
public:
    BiquadFilter() = default;

    void setSampleRate(float sampleRate) { sr = sampleRate; }

    // Resonant bandpass filter for formant modelling
    void setBandPass(float frequency, float bandwidth)
    {
        float omega = TWO_PI * frequency / sr;
        float sinO  = sinf(omega);
        float alpha = sinO * sinhf(logf(2.0f) / 2.0f * bandwidth * omega / sinO);

        float b0 =  alpha;
        float b2 = -alpha;
        float a0 =  1.0f + alpha;
        float a1 = -2.0f * cosf(omega);
        float a2 =  1.0f - alpha;

        this->b0 =  b0 / a0;
        this->b1 =  0.0f;
        this->b2 =  b2 / a0;
        this->a1 =  a1 / a0;
        this->a2 =  a2 / a0;
    }

    inline float process(float input)
    {
        float output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = input;
        y2 = y1; y1 = output;
        return output;
    }

    void reset() { x1 = x2 = y1 = y2 = 0.0f; }

private:
    float sr = DEFAULT_SAMPLE_RATE;
    float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
    float a1 = 0.0f, a2 = 0.0f;
    float x1 = 0.0f, x2 = 0.0f;
    float y1 = 0.0f, y2 = 0.0f;
};

// ─────────────────────────────────────────────────────────────────────────────
// FormantBank  (from ford442/korg_prophecy_emu src/FormantBank.h)
// [wrapper mod] added setSampleRate(), setFormantShift() and setResonanceScale()
// ─────────────────────────────────────────────────────────────────────────────

class FormantBank {
public:
    FormantBank()
    {
        for (auto& f : filters) f.setSampleRate(DEFAULT_SAMPLE_RATE);
        setVowel('a');
    }

    void setSampleRate(float sr)
    {
        for (auto& f : filters) f.setSampleRate(sr);
        rebuildFilters();
    }

    // Set vowel and recompute coefficients
    void setVowel(char vowel)
    {
        currentVowel = vowel;
        rebuildFilters();
    }

    // Shift multiplier for all formant centre frequencies (1.0 = no shift)
    void setFormantShift(float mult)
    {
        formantShiftMult = mult;
        rebuildFilters();
    }

    // Scale factor applied to bandwidth (1.0 = nominal; > 1 = wider / less resonant)
    void setResonanceScale(float scale)
    {
        bandwidthScale = (scale > 0.01f) ? scale : 0.01f;
        rebuildFilters();
    }

    inline float process(float input)
    {
        float sum = filters[0].process(input) * 1.0f   // F1
                  + filters[1].process(input) * 0.9f   // F2
                  + filters[2].process(input) * 0.6f   // F3
                  + filters[3].process(input) * 0.4f;  // F4
        return sum * 0.5f;
    }

    void reset() { for (auto& f : filters) f.reset(); }

    char getCurrentVowel() const { return currentVowel; }

private:
    std::array<BiquadFilter, 4> filters;
    char  currentVowel     = 'a';
    float formantShiftMult = 1.0f;
    float bandwidthScale   = 1.0f;

    void rebuildFilters()
    {
        const FormantSet* set = &FORMANT_A;
        switch (currentVowel) {
            case 'a': case 'A': set = &FORMANT_A; break;
            case 'e': case 'E': set = &FORMANT_E; break;
            case 'i': case 'I': set = &FORMANT_I; break;
            case 'o': case 'O': set = &FORMANT_O; break;
            case 'u': case 'U': set = &FORMANT_U; break;
            default:             set = &FORMANT_A; break;
        }

        for (int i = 0; i < 4; ++i) {
            filters[i].setBandPass(
                set->frequencies[i] * formantShiftMult,
                set->bandwidths[i]  * bandwidthScale
            );
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADSR  (from ford442/korg_prophecy_emu src/Voice.h)
// [wrapper mod] rates are computed with a runtime sample rate argument
// ─────────────────────────────────────────────────────────────────────────────

struct ADSR {
    float attack  = 0.01f;
    float decay   = 0.3f;
    float sustain = 0.7f;
    float release = 0.5f;

    float attackRate  = 0.0f;
    float decayRate   = 0.0f;
    float releaseRate = 0.0f;
    float level       = 0.0f;

    enum State { Idle, Attack, Decay, Sustain, Release } state = Idle;

    // [wrapper mod] takes explicit sampleRate instead of using the constant
    void calculateRates(float sr)
    {
        attackRate  = (attack  > 0.0f) ? (1.0f / (attack  * sr)) : 1.0f;
        decayRate   = (decay   > 0.0f) ? ((1.0f - sustain) / (decay   * sr)) : 1.0f;
        releaseRate = (release > 0.0f) ? (sustain           / (release * sr)) : 1.0f;
    }

    inline float process()
    {
        switch (state) {
            case Attack:
                level += attackRate;
                if (level >= 1.0f) { level = 1.0f; state = Decay; }
                break;
            case Decay:
                level -= decayRate;
                if (level <= sustain) { level = sustain; state = Sustain; }
                break;
            case Sustain:
                break;
            case Release:
                level -= releaseRate;
                if (level <= 0.0f) { level = 0.0f; state = Idle; }
                break;
            case Idle:
                level = 0.0f;
                break;
        }
        return level;
    }

    void noteOn()  { state = Attack; }
    void noteOff() { if (state != Idle) state = Release; }
    void reset()   { state = Idle; level = 0.0f; }
};

// ─────────────────────────────────────────────────────────────────────────────
// Voice  (from ford442/korg_prophecy_emu src/Voice.h)
// [wrapper mod]
//   - setSampleRate() added to propagate SR to FormantBank and ADSR
//   - setNote() now stores midiNote for reliable noteOff matching
//   - noteOff(int note) added for note-number-based release
//   - portamentoRate exposed via setPortamentoRate()
// ─────────────────────────────────────────────────────────────────────────────

class Voice {
public:
    enum Waveform { Saw, Square, Triangle, Pulse };

    Voice()
    {
        formantBank.setVowel('a');
        adsr.calculateRates(DEFAULT_SAMPLE_RATE);
    }

    void setSampleRate(float sr)
    {
        sampleRate = sr;
        formantBank.setSampleRate(sr);
        adsr.calculateRates(sr);
    }

    void setNote(float note, float velocity)
    {
        midiNote        = static_cast<int>(note);
        targetFrequency = midiNoteToFrequency(midiNote);
        this->velocity  = velocity;

        if (!active) currentFrequency = targetFrequency;

        active = true;
        adsr.noteOn();
    }

    // Release the voice if it is playing the given MIDI note
    void noteOff(int note)
    {
        if (midiNote == note && active) adsr.noteOff();
    }

    // Legacy noteOff (frequency-based) — kept for completeness
    void noteOff() { adsr.noteOff(); }

    void setWaveform(Waveform wf) { waveform = wf; }
    void setVowel(char vowel)     { formantBank.setVowel(vowel); }

    void setFormantShift(float mult)   { formantBank.setFormantShift(mult); }
    void setResonanceScale(float scale){ formantBank.setResonanceScale(scale); }

    void setPortamentoRate(float rate) { portamentoRate = std::max(0.0f, std::min(1.0f, rate)); }

    void setADSRParams(float atk, float dec, float sus, float rel)
    {
        adsr.attack  = atk;
        adsr.decay   = dec;
        adsr.sustain = sus;
        adsr.release = rel;
        adsr.calculateRates(sampleRate);
    }

    inline float process()
    {
        if (!active && adsr.state == ADSR::Idle) return 0.0f;

        // Portamento
        if (currentFrequency != targetFrequency) {
            float diff = targetFrequency - currentFrequency;
            currentFrequency += diff * portamentoRate;
            if (fabsf(diff) < 0.01f) currentFrequency = targetFrequency;
        }

        float phaseInc = currentFrequency / sampleRate;
        phase += phaseInc;
        if (phase >= 1.0f) phase -= 1.0f;

        float osc = generateWaveform(phase, phaseInc);

        float filtered = formantBank.process(osc);

        float amp = adsr.process() * velocity * 0.5f;

        if (adsr.state == ADSR::Idle && active) {
            active   = false;
            midiNote = -1;
        }

        return filtered * amp;
    }

    bool isActive()   const { return active || adsr.state != ADSR::Idle; }
    int  getMidiNote() const { return midiNote; }

    void reset()
    {
        active           = false;
        midiNote         = -1;
        phase            = 0.0f;
        currentFrequency = 440.0f;
        targetFrequency  = 440.0f;
        adsr.reset();
        formantBank.reset();
    }

    float getCurrentFrequency() const { return currentFrequency; }

private:
    FormantBank formantBank;
    ADSR        adsr;

    float sampleRate       = DEFAULT_SAMPLE_RATE;
    float phase            = 0.0f;
    float currentFrequency = 440.0f;
    float targetFrequency  = 440.0f;
    float velocity         = 0.0f;
    float portamentoRate   = 0.05f;

    std::atomic<bool> active{false};
    int               midiNote = -1;
    Waveform          waveform = Saw;

    inline float generateWaveform(float ph, float dt)
    {
        switch (waveform) {
            case Saw: {
                float saw = 2.0f * ph - 1.0f;
                saw -= polyBLEP(ph, dt);
                return saw;
            }
            case Square: {
                float sq = (ph < 0.5f) ? 1.0f : -1.0f;
                sq += polyBLEP(ph, dt);
                sq -= polyBLEP(fmodf(ph + 0.5f, 1.0f), dt);
                return sq;
            }
            case Triangle:
                return 4.0f * fabsf(ph - 0.5f) - 1.0f;
            case Pulse:
                return (ph < 0.25f) ? 1.0f : -1.0f;
            default:
                return 0.0f;
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// ProphecyDSP  (from ford442/korg_prophecy_emu src/ProphecyDSP.h + ProphecyDSP.cpp)
// [wrapper mod]
//   - setSampleRate() added to propagate SR to all voices
//   - setWaveform/setVowel/setPortamento/setFormantShift/setResonanceScale added
//   - noteOff uses note-number matching for correctness
//   - setADSRParams added
//   - process() mixes stereo → mono (L = R so just return L)
// ─────────────────────────────────────────────────────────────────────────────

class ProphecyDSPEngine {
public:
    ProphecyDSPEngine() { setWaveform(Voice::Saw); }

    void setSampleRate(float sr)
    {
        sampleRate = sr;
        for (auto& v : voices) v.setSampleRate(sr);
    }

    // ── Audio render ─────────────────────────────────────────────────────────

    void process(float* output, int frames)
    {
        if (!output) return;
        std::fill(output, output + frames, 0.0f);

        for (auto& voice : voices) {
            if (voice.isActive()) {
                for (int i = 0; i < frames; ++i)
                    output[i] += voice.process();
            }
        }

        // Prophecy-style soft-clip output stage
        for (int i = 0; i < frames; ++i) {
            float x = output[i] * volume;
            if      (x >  0.7f) x =  0.7f + (x - 0.7f) / (1.0f + (x - 0.7f) * (x - 0.7f));
            else if (x < -0.7f) x = -0.7f + (x + 0.7f) / (1.0f + (x + 0.7f) * (x + 0.7f));
            output[i] = x;
        }
    }

    // ── MIDI ─────────────────────────────────────────────────────────────────

    void noteOn(int note, float velocity)
    {
        int idx = findFreeVoice();
        voices[idx].setNote(static_cast<float>(note), velocity / 127.0f);
        lastVoice = idx;
    }

    void noteOff(int note)
    {
        // [wrapper mod] Use MIDI note number for reliable matching
        for (auto& v : voices)
            if (v.isActive()) v.noteOff(note);
    }

    void allNotesOff()
    {
        for (auto& v : voices) { v.noteOff(); v.reset(); }
    }

    // ── Parameter setters ────────────────────────────────────────────────────

    void setWaveform(Voice::Waveform wf)
    {
        currentWaveform = wf;
        for (auto& v : voices) v.setWaveform(wf);
    }

    void setVowel(char vowel)
    {
        currentVowel = vowel;
        for (auto& v : voices) v.setVowel(vowel);
    }

    void setPortamento(float time)
    {
        portamentoTime = time;
        // time=0 → instantaneous (portamentoRate=1.0); time=1 → very slow glide (rate≈0.001)
        float rate = (time > 0.0f) ? (1.0f / (1.0f + time * 100.0f)) : 1.0f;
        for (auto& v : voices) v.setPortamentoRate(rate);
    }

    void setFormantShift(float shift)
    {
        // shift ∈ [0,1]: 0 = no shift, 1 = +3 semitones (1.19× multiplier)
        float mult = 1.0f + shift * 0.19f;
        for (auto& v : voices) v.setFormantShift(mult);
    }

    void setResonanceScale(float res)
    {
        // res ∈ [0,1]: 0 = very narrow (high resonance), 1 = nominal bandwidth
        float scale = 0.1f + (1.0f - res) * 0.9f;
        for (auto& v : voices) v.setResonanceScale(scale);
    }

    void setADSRParams(float atk, float dec, float sus, float rel)
    {
        for (auto& v : voices) v.setADSRParams(atk, dec, sus, rel);
    }

    void setVolume(float v) { volume = std::max(0.0f, std::min(2.0f, v)); }

private:
    std::array<Voice, MAX_VOICES> voices;

    Voice::Waveform currentWaveform = Voice::Saw;
    char            currentVowel    = 'a';
    float           portamentoTime  = 0.0f;
    float           sampleRate      = DEFAULT_SAMPLE_RATE;
    float           volume          = 0.8f;
    int             lastVoice       = 0;

    int findFreeVoice()
    {
        for (int i = 0; i < MAX_VOICES; ++i)
            if (!voices[i].isActive()) return i;
        lastVoice = (lastVoice + 1) % MAX_VOICES;
        voices[lastVoice].reset();
        return lastVoice;
    }
};

} // namespace ProphecyDSP

// ─────────────────────────────────────────────────────────────────────────────
// ProphecyInstance  – wraps the engine with a malloc'd output buffer
// ─────────────────────────────────────────────────────────────────────────────

struct ProphecyInstance {
    ProphecyDSP::ProphecyDSPEngine engine;
    float* outBuf    = nullptr;
    int    bufSize   = 128;
    float  sampleRate = 44100.0f;

    // ── ADSR parameters (stored for re-application after rebuild) ────────────
    float attackTime  = 0.01f;
    float decayTime   = 0.3f;
    float sustainLevel= 0.7f;
    float releaseTime = 0.5f;

    ProphecyInstance() = default;

    ~ProphecyInstance()
    {
        std::free(outBuf);
        outBuf = nullptr;
    }

    int init(float sr, int bs)
    {
        sampleRate = (sr > 0.0f) ? sr : 44100.0f;
        bufSize    = (bs > 0)    ? bs : 128;

        std::free(outBuf);
        outBuf = static_cast<float*>(
            std::malloc(static_cast<std::size_t>(bufSize) * sizeof(float))
        );
        if (!outBuf) { bufSize = 0; return 0; }
        std::memset(outBuf, 0, static_cast<std::size_t>(bufSize) * sizeof(float));

        engine.setSampleRate(sampleRate);
        engine.setADSRParams(attackTime, decayTime, sustainLevel, releaseTime);
        return 1;
    }

    void setParam(int paramId, float value)
    {
        switch (paramId) {
            case PROPHECY_WAVEFORM: {
                int wfi = static_cast<int>(value + 0.5f);
                ProphecyDSP::Voice::Waveform wf = ProphecyDSP::Voice::Saw;
                switch (wfi) {
                    case 1: wf = ProphecyDSP::Voice::Square;   break;
                    case 2: wf = ProphecyDSP::Voice::Triangle; break;
                    case 3: wf = ProphecyDSP::Voice::Pulse;    break;
                    default: break;
                }
                engine.setWaveform(wf);
                break;
            }
            case PROPHECY_VOWEL: {
                const char vowels[] = { 'a', 'e', 'i', 'o', 'u' };
                // Map [0, 1] uniformly across 5 vowels (0=A … 4=U)
                int vi = std::clamp(static_cast<int>(value * 5.0f), 0, 4);
                engine.setVowel(vowels[vi]);
                break;
            }
            case PROPHECY_VOLUME:
                engine.setVolume(value);
                break;
            case PROPHECY_ATTACK:
                attackTime = 0.001f + value * 1.999f;   // 1ms – 2s
                engine.setADSRParams(attackTime, decayTime, sustainLevel, releaseTime);
                break;
            case PROPHECY_DECAY:
                decayTime  = 0.01f  + value * 1.99f;    // 10ms – 2s
                engine.setADSRParams(attackTime, decayTime, sustainLevel, releaseTime);
                break;
            case PROPHECY_SUSTAIN:
                sustainLevel = std::max(0.0f, std::min(1.0f, value));
                engine.setADSRParams(attackTime, decayTime, sustainLevel, releaseTime);
                break;
            case PROPHECY_RELEASE:
                releaseTime = 0.01f + value * 2.99f;    // 10ms – 3s
                engine.setADSRParams(attackTime, decayTime, sustainLevel, releaseTime);
                break;
            case PROPHECY_PORTAMENTO:
                engine.setPortamento(value);
                break;
            case PROPHECY_FORMANT_SHIFT:
                engine.setFormantShift(value);
                break;
            case PROPHECY_RESONANCE:
                engine.setResonanceScale(value);
                break;
            default:
                break;
        }
    }

    void noteOn(int midiNote, float velocity)
    {
        engine.noteOn(midiNote, velocity);
    }

    void noteOff(int midiNote)
    {
        engine.noteOff(midiNote);
    }

    void allNotesOff()
    {
        engine.allNotesOff();
    }

    /** Render into the internal buffer and return a raw pointer to it. */
    float* processInternal(int numFrames)
    {
        if (!outBuf) return nullptr;
        const int frames = std::min(numFrames, bufSize);
        engine.process(outBuf, frames);
        return outBuf;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Multi-instance registry
// ─────────────────────────────────────────────────────────────────────────────

static std::unordered_map<uintptr_t, std::unique_ptr<ProphecyInstance>> g_instances;
static uintptr_t g_nextHandle = 1;

static ProphecyInstance* lookupInstance(uintptr_t handle)
{
    auto it = g_instances.find(handle);
    return (it != g_instances.end()) ? it->second.get() : nullptr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-instance C API
// ─────────────────────────────────────────────────────────────────────────────

extern "C" {

EMSCRIPTEN_KEEPALIVE
uintptr_t prophecy_create()
{
    auto inst = std::make_unique<ProphecyInstance>();
    uintptr_t h = g_nextHandle++;
    g_instances[h] = std::move(inst);
    return h;
}

EMSCRIPTEN_KEEPALIVE
void prophecy_destroy(uintptr_t handle)
{
    g_instances.erase(handle);
}

EMSCRIPTEN_KEEPALIVE
int prophecy_init(uintptr_t handle, float sampleRate, int bufferSize)
{
    ProphecyInstance* inst = lookupInstance(handle);
    if (!inst) return 0;
    return inst->init(sampleRate, bufferSize);
}

EMSCRIPTEN_KEEPALIVE
void prophecy_note_on(uintptr_t handle, int midiNote, float velocity)
{
    if (auto* inst = lookupInstance(handle)) inst->noteOn(midiNote, velocity);
}

EMSCRIPTEN_KEEPALIVE
void prophecy_note_off(uintptr_t handle, int midiNote)
{
    if (auto* inst = lookupInstance(handle)) inst->noteOff(midiNote);
}

EMSCRIPTEN_KEEPALIVE
void prophecy_all_notes_off(uintptr_t handle)
{
    if (auto* inst = lookupInstance(handle)) inst->allNotesOff();
}

EMSCRIPTEN_KEEPALIVE
void prophecy_set_param(uintptr_t handle, int paramId, float value)
{
    if (auto* inst = lookupInstance(handle)) inst->setParam(paramId, value);
}

/**
 * Render @p numFrames of audio into the instance's internal buffer.
 * Returns a pointer to that buffer (do NOT free it — it is owned by the instance).
 * Returns 0 on error.
 */
EMSCRIPTEN_KEEPALIVE
uintptr_t prophecy_process(uintptr_t handle, int numFrames)
{
    ProphecyInstance* inst = lookupInstance(handle);
    if (!inst) return 0;
    float* buf = inst->processInternal(numFrames);
    return reinterpret_cast<uintptr_t>(buf);
}

} // extern "C"

// ─────────────────────────────────────────────────────────────────────────────
// Embind bindings  (makes the same functions callable from the JS module
// wrapper / main-thread AudioDSP bridge)
// ─────────────────────────────────────────────────────────────────────────────

EMSCRIPTEN_BINDINGS(prophecy_module) {
    function("prophecy_create",        &prophecy_create);
    function("prophecy_destroy",       &prophecy_destroy);
    function("prophecy_init",          &prophecy_init);
    function("prophecy_note_on",       &prophecy_note_on);
    function("prophecy_note_off",      &prophecy_note_off);
    function("prophecy_all_notes_off", &prophecy_all_notes_off);
    function("prophecy_set_param",     &prophecy_set_param);
    function("prophecy_process",       &prophecy_process);
}
