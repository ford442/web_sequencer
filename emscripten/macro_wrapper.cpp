/**
 * macro_wrapper.cpp — the `macro-*` engine family: Mutable Instruments Plaits
 * as a polyphonic voice in hyphon_native.wasm.
 *
 * The DSP is upstream: third_party/eurorack (plaits/dsp + resources) and
 * third_party/stmlib, both pinned submodules, MIT-licensed
 * (THIRD_PARTY_NOTICES.md), compiled from a staged copy that only adds
 * denormal guards (tools/plaits_wasm_patches.mjs — wasm has no flush-to-zero).
 * This file holds what plaits::Voice does on the module (voice.cc, also MIT)
 * re-done for a DAW, plus the polyphony around it. Every departure from
 * voice.cc is marked "[wrapper mod]".
 *
 *   MacroVoice     one Plaits voice: all 24 engines sharing 16 KB of RAM, the
 *                  internal decay envelope, the low-pass gate, OUT + AUX
 *   MacroEngine    up to 8 MacroVoices for one part: allocation + stealing,
 *                  glide, stereo from OUT/AUX, 48 kHz → context-rate resampler
 *
 * Built on the shared voice core (emscripten/core/voice.h, #1344) as a STEREO
 * voice: NativeVoice<MacroEngine, 256, 2>. Generic exports from
 * HYPHON_EXPORT_VOICE:
 *   macro_create / _destroy / _init(handle, sampleRate, maxFrames)
 *   macro_push_event(handle, frame, type, target, value, a0, a1, a2, a3)
 *   macro_render(handle, blockStartFrame, frames)  → float*, planar stereo:
 *                  left at [0, frames), right at [stride, stride + frames),
 *                  stride = the maxFrames given to init (macro_stride)
 *   macro_cancel_notes(handle) / macro_flush(handle)
 *
 * Events:
 *   kNoteOn   target = MIDI note, value = velocity 0–1,
 *             a0 = per-note TIMBRE offset (−1…1), a1 = slide (1 = glide in,
 *             legato when mono), a2 = fine pitch in semitones,
 *             a3 = per-note MORPH offset (−1…1)
 *   kNoteOff  target = MIDI note
 *   kAllNotesOff  releases every gate (MIDI All Notes Off — not a reset)
 *   kParam    target = MacroParam, value as documented on the enum
 *
 * Immediate API (tooling and host tests):
 *   macro_note_on / macro_note_off / macro_set_param
 *   macro_set_param_now(handle, id, v)  a knob move: set now, drop that
 *                                 param's still-scheduled events
 *   macro_all_notes_off(handle)   hard stop: gates close and every voice
 *                                 fades out over 2 ms — the transport Stop
 *   macro_process(handle, frames) render with no event timing
 *   macro_engine_count()          engines this build knows (24)
 *   macro_active_voices(handle)   voices currently rendering
 *   macro_stride(handle)          channel stride of the planar buffer
 *
 * Timing. Plaits renders 12-sample control blocks at 48 kHz and its envelopes
 * are tuned to that block, so the engine keeps that grid: an event takes
 * effect at the first 48 kHz control-block boundary at or after its frame
 * (≤ 0.25 ms late), and the whole part runs behind a constant resampler delay
 * (16 samples at 48 kHz) when the context is not 48 kHz.
 *
 * Parameter IDs are mirrored by src/engines/MacroParams.ts (MacroParam) and
 * the engine order by MACRO_ENGINES there — both are persisted in songs.
 *
 * © 2026 Hyphon contributors – MIT License
 * Plaits DSP © 2016–2021 Emilie Gillet – MIT License
 */

#include <emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <new>

#include "core/voice.h"
#include "core/voice_exports.h"

#include "plaits/dsp/dsp.h"
#include "plaits/dsp/engine/additive_engine.h"
#include "plaits/dsp/engine/bass_drum_engine.h"
#include "plaits/dsp/engine/chord_engine.h"
#include "plaits/dsp/engine/engine.h"
#include "plaits/dsp/engine/fm_engine.h"
#include "plaits/dsp/engine/grain_engine.h"
#include "plaits/dsp/engine/hi_hat_engine.h"
#include "plaits/dsp/engine/modal_engine.h"
#include "plaits/dsp/engine/noise_engine.h"
#include "plaits/dsp/engine/particle_engine.h"
#include "plaits/dsp/engine/snare_drum_engine.h"
#include "plaits/dsp/engine/speech_engine.h"
#include "plaits/dsp/engine/string_engine.h"
#include "plaits/dsp/engine/swarm_engine.h"
#include "plaits/dsp/engine/virtual_analog_engine.h"
#include "plaits/dsp/engine/waveshaping_engine.h"
#include "plaits/dsp/engine/wavetable_engine.h"
#include "plaits/dsp/engine2/chiptune_engine.h"
#include "plaits/dsp/engine2/phase_distortion_engine.h"
#include "plaits/dsp/engine2/six_op_engine.h"
#include "plaits/dsp/engine2/string_machine_engine.h"
#include "plaits/dsp/engine2/virtual_analog_vcf_engine.h"
#include "plaits/dsp/engine2/wave_terrain_engine.h"
#include "plaits/dsp/envelope.h"
#include "plaits/dsp/fx/low_pass_gate.h"
#include "plaits/resources.h"
#include "stmlib/dsp/limiter.h"
#include "stmlib/dsp/units.h"
#include "stmlib/utils/buffer_allocator.h"

// ─────────────────────────────────────────────────────────────────────────────
// Parameter IDs  (keep in sync with MacroParam in src/engines/MacroParams.ts)
// ─────────────────────────────────────────────────────────────────────────────

enum MacroParam : int {
    MACRO_ENGINE      = 0,   // engine index 0–23 (MACRO_ENGINES order in MacroParams.ts)
    MACRO_HARMONICS   = 1,   // 0–1
    MACRO_TIMBRE      = 2,   // 0–1
    MACRO_MORPH       = 3,   // 0–1
    MACRO_DECAY       = 4,   // 0–1  LPG + internal envelope decay
    MACRO_LPG_COLOUR  = 5,   // 0–1  0 = VCA, 1 = low-pass gate
    MACRO_VOLUME      = 6,   // 0–2  part output gain
    MACRO_POLYPHONY   = 7,   // 1–8  voices (1 = mono, legato slides)
    MACRO_FM_MOD      = 8,   // −1–1 internal envelope → pitch
    MACRO_TIMBRE_MOD  = 9,   // −1–1 internal envelope → TIMBRE
    MACRO_MORPH_MOD   = 10,  // −1–1 internal envelope → MORPH
    MACRO_SPREAD      = 11,  // 0–1  stereo width: AUX on the side channel
    MACRO_GLIDE       = 12,  // 0–1  portamento time (0 = off, 1 ≈ 1 s)
    MACRO_LPG_MODE    = 13,  // 0 = gate (note length holds the LPG), 1 = ping (module behaviour)
    MACRO_TRANSPOSE   = 14,  // semitones, −48…48
    MACRO_AUX_MIX     = 15,  // 0–1  crossfade OUT → AUX on the mid channel
    MACRO_PARAM_COUNT
};

namespace macro {

constexpr int kNumEngines = 24;
constexpr int kMaxVoices = 8;
constexpr size_t kVoiceRamBytes = 16384;  // plaits.cc: shared_buffer[16384]
// 48 kHz, what Plaits is tuned for (plaits::kSampleRate is a plain const, not constexpr).
constexpr float kInternalRate = 48000.0f;
constexpr int kBlock = static_cast<int>(plaits::kBlockSize);  // 12 samples = 0.25 ms
constexpr float kBlockSeconds = static_cast<float>(kBlock) / kInternalRate;

// A voice is put to sleep once it has been this quiet for this long.
constexpr float kSilence = 1.0e-4f;          // −80 dBFS
constexpr int kQuietBlocksReleased = 32;     // 8 ms after its gate closed
constexpr int kQuietBlocksDecayed = 400;     // 100 ms while gated, once it has sounded
constexpr int kStopFadeBlocks = 8;           // 2 ms fade for a hard stop
constexpr float kVoiceGain = 0.5f;           // −6 dB per voice before the part volume
constexpr float kSlideSeconds = 0.03f;       // glide a slid note gets with GLIDE at 0

inline float clampf(float x, float lo, float hi) { return x < lo ? lo : (x > hi ? hi : x); }

// ─────────────────────────────────────────────────────────────────────────────
// MacroVoice — plaits::Voice for a DAW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What one control block of one voice needs. Upstream this is spread over
 * Patch (knobs) and Modulations (CV jacks); here every input is "patched" by
 * the sequencer, so the per-jack *_patched flags collapse to constants.
 */
struct VoiceControl {
    int engine = 8;
    float note = 60.0f;  // semitones, MIDI scale (69 = A440)
    float harmonics = 0.5f;
    float timbre = 0.5f;
    float morph = 0.5f;
    float decay = 0.5f;
    float lpgColour = 0.5f;
    float fmAmount = 0.0f;
    float timbreAmount = 0.0f;
    float morphAmount = 0.0f;
    float level = 0.8f;   // note velocity, 0–1
    bool gate = false;
    bool risingEdge = false;
    bool ping = false;
};

class MacroVoice {
public:
    void Init(stmlib::BufferAllocator* allocator) {
        engines_.Init();

        // Same order, flags and gains as Voice::Init — the index is the persisted engine id.
        engines_.RegisterInstance(&virtual_analog_vcf_engine_, false, 1.0f, 1.0f);
        engines_.RegisterInstance(&phase_distortion_engine_, false, 0.7f, 0.7f);
        engines_.RegisterInstance(&six_op_engine_, true, 1.0f, 1.0f);
        engines_.RegisterInstance(&six_op_engine_, true, 1.0f, 1.0f);
        engines_.RegisterInstance(&six_op_engine_, true, 1.0f, 1.0f);
        engines_.RegisterInstance(&wave_terrain_engine_, false, 0.7f, 0.7f);
        engines_.RegisterInstance(&string_machine_engine_, false, 0.8f, 0.8f);
        engines_.RegisterInstance(&chiptune_engine_, false, 0.5f, 0.5f);

        engines_.RegisterInstance(&virtual_analog_engine_, false, 0.8f, 0.8f);
        engines_.RegisterInstance(&waveshaping_engine_, false, 0.7f, 0.6f);
        engines_.RegisterInstance(&fm_engine_, false, 0.6f, 0.6f);
        engines_.RegisterInstance(&grain_engine_, false, 0.7f, 0.6f);
        engines_.RegisterInstance(&additive_engine_, false, 0.8f, 0.8f);
        engines_.RegisterInstance(&wavetable_engine_, false, 0.6f, 0.6f);
        engines_.RegisterInstance(&chord_engine_, false, 0.8f, 0.8f);
        engines_.RegisterInstance(&speech_engine_, false, -0.7f, 0.8f);

        engines_.RegisterInstance(&swarm_engine_, false, -3.0f, 1.0f);
        engines_.RegisterInstance(&noise_engine_, false, -1.0f, -1.0f);
        engines_.RegisterInstance(&particle_engine_, false, -2.0f, 1.0f);
        engines_.RegisterInstance(&string_engine_, true, -1.0f, 0.8f);
        engines_.RegisterInstance(&modal_engine_, true, -1.0f, 0.8f);
        engines_.RegisterInstance(&bass_drum_engine_, true, 0.8f, 0.8f);
        engines_.RegisterInstance(&snare_drum_engine_, true, 0.8f, 0.8f);
        engines_.RegisterInstance(&hi_hat_engine_, true, 0.8f, 0.8f);

        for (int i = 0; i < engines_.size(); ++i) {
            // All engines share the same RAM space.
            allocator->Free();
            engines_.get(i)->Init(allocator);
        }

        previous_engine_index_ = -1;
        out_lpg_.Init();
        aux_lpg_.Init();
        out_limiter_.Init();
        aux_limiter_.Init();
        decay_envelope_.Init();
        lpg_envelope_.Init();
    }

    /** Forget the engine state: the next block reloads and resets the engine. */
    void Silence() {
        previous_engine_index_ = -1;
        decay_envelope_.Init();
        lpg_envelope_.Init();
        out_lpg_.Init();
        aux_lpg_.Init();
    }

    void Render(const VoiceControl& c, float* out, float* aux, size_t size) {
        // [wrapper mod] No 1 ms trigger delay (Voice::Render's trigger_delay_):
        // it compensated CV lagging GATE on modular sequencers; here the gate
        // and the pitch arrive in the same event.
        if (c.risingEdge) {
            // [wrapper mod] The LPG is pinged only in ping mode; in gate mode
            // the level input follows the gate, as with LEVEL patched upstream.
            if (c.ping) lpg_envelope_.Trigger();
            decay_envelope_.Trigger();
        }

        // [wrapper mod] The engine index is set directly — no knob/CV
        // hysteresis quantizer.
        const int engine_index = c.engine;
        plaits::Engine* e = engines_.get(engine_index);

        if (engine_index != previous_engine_index_) {
            // [wrapper mod] No user-data flash: banks 2–4 always load the
            // factory 6-op patches.
            const uint8_t* data = (engine_index >= 2 && engine_index <= 4)
                ? plaits::fm_patches_table[engine_index - 2]
                : nullptr;
            e->LoadUserData(data);
            e->Reset();
            out_limiter_.Init();
            previous_engine_index_ = engine_index;
        }

        plaits::EngineParameters p;
        // [wrapper mod] TRIGGER is always patched: the sequencer gate.
        p.trigger = (c.risingEdge ? plaits::TRIGGER_RISING_EDGE : plaits::TRIGGER_LOW) |
                    (c.gate ? plaits::TRIGGER_HIGH : plaits::TRIGGER_LOW);

        const float short_decay = (200.0f * plaits::kBlockSize) / plaits::kSampleRate *
                                  stmlib::SemitonesToRatio(-96.0f * c.decay);
        decay_envelope_.Process(short_decay * 2.0f);

        // [wrapper mod] Velocity is the accent in both LPG modes (upstream
        // uses a fixed 0.8 unless LEVEL is patched).
        const float level = clampf(c.level, 0.0f, 1.0f);
        const float compressed_level = clampf(1.3f * level / (0.3f + level), 0.0f, 1.0f);
        p.accent = compressed_level;

        p.harmonics = clampf(c.harmonics, 0.0f, 1.0f);

        float internal_envelope_amplitude = 1.0f;
        float internal_envelope_amplitude_timbre = 1.0f;
        if (engine_index == 15) {
            internal_envelope_amplitude = clampf(2.0f - p.harmonics * 6.0f, 0.0f, 1.0f);
            speech_engine_.set_prosody_amount(c.fmAmount);
            speech_engine_.set_speed(c.morphAmount);
        } else if (engine_index == 7) {
            // TIMBRE is never CV-patched here, so the chiptune engine's own
            // envelope generator takes over TIMBRE's internal envelope.
            internal_envelope_amplitude_timbre = 0.0f;
            chiptune_engine_.set_envelope_shape(c.timbreAmount);
        }

        const float env = decay_envelope_.value();
        p.note = ApplyModulations(c.note, c.fmAmount,
                                  internal_envelope_amplitude * env * env * 48.0f, -119.0f, 120.0f);
        p.timbre = ApplyModulations(c.timbre, c.timbreAmount,
                                    internal_envelope_amplitude_timbre * env, 0.0f, 1.0f);
        p.morph = ApplyModulations(c.morph, c.morphAmount,
                                   internal_envelope_amplitude * env, 0.0f, 1.0f);

        const plaits::PostProcessingSettings& pp_s = e->post_processing_settings;
        bool already_enveloped = pp_s.already_enveloped;
        e->Render(p, out, aux, size, &already_enveloped);

        // [wrapper mod] With TRIGGER always patched, the LPG is bypassed only
        // for engines that envelope themselves.
        const bool lpg_bypass = already_enveloped;
        if (!lpg_bypass) {
            const float hf = c.lpgColour;
            const float decay_tail = (20.0f * plaits::kBlockSize) / plaits::kSampleRate *
                                         stmlib::SemitonesToRatio(-72.0f * c.decay + 12.0f * hf) -
                                     short_decay;
            if (c.ping) {
                const float attack = plaits::NoteToFrequency(p.note) * float(plaits::kBlockSize) * 2.0f;
                lpg_envelope_.ProcessPing(attack, short_decay, decay_tail, hf);
            } else {
                lpg_envelope_.ProcessLP(c.gate ? compressed_level : 0.0f, short_decay, decay_tail, hf);
            }
        } else {
            lpg_envelope_.Init();
        }

        PostProcess(pp_s.out_gain, lpg_bypass, out_lpg_, out_limiter_, out, size);
        PostProcess(pp_s.aux_gain, lpg_bypass, aux_lpg_, aux_limiter_, aux, size);
    }

private:
    /** Voice::ApplyModulations with the internal envelope as the only source. */
    static float ApplyModulations(float base_value, float modulation_amount, float envelope,
                                  float minimum_value, float maximum_value) {
        modulation_amount *= std::max(std::fabs(modulation_amount) - 0.05f, 0.05f);
        modulation_amount *= 1.05f;
        return clampf(base_value + modulation_amount * envelope, minimum_value, maximum_value);
    }

    /**
     * ChannelPostProcessor::Process in float. [wrapper mod] No int16 DAC
     * stage: no −32767 scale / polarity flip, and Clip16 becomes a ±1 clamp.
     */
    void PostProcess(float gain, bool bypass_lpg, plaits::LowPassGate& lpg, stmlib::Limiter& limiter,
                     float* in_out, size_t size) {
        // [wrapper mod] An engine fading out under its own envelope (chiptune)
        // hands over subnormal samples; wasm has no FTZ to do this for us.
        for (size_t i = 0; i < size; ++i) in_out[i] = hyphon::flushDenormal(in_out[i]);
        if (gain < 0.0f) limiter.Process(-gain, in_out, size);
        const float post_gain = gain < 0.0f ? 1.0f : gain;
        if (!bypass_lpg) {
            lpg.Process(post_gain * lpg_envelope_.gain(), lpg_envelope_.frequency(),
                        lpg_envelope_.hf_bleed(), in_out, size);
        } else {
            for (size_t i = 0; i < size; ++i) in_out[i] *= post_gain;
        }
        for (size_t i = 0; i < size; ++i) in_out[i] = clampf(in_out[i], -1.0f, 1.0f);
    }

    plaits::VirtualAnalogEngine virtual_analog_engine_;
    plaits::WaveshapingEngine waveshaping_engine_;
    plaits::FMEngine fm_engine_;
    plaits::GrainEngine grain_engine_;
    plaits::AdditiveEngine additive_engine_;
    plaits::WavetableEngine wavetable_engine_;
    plaits::ChordEngine chord_engine_;
    plaits::SpeechEngine speech_engine_;

    plaits::SwarmEngine swarm_engine_;
    plaits::NoiseEngine noise_engine_;
    plaits::ParticleEngine particle_engine_;
    plaits::StringEngine string_engine_;
    plaits::ModalEngine modal_engine_;
    plaits::BassDrumEngine bass_drum_engine_;
    plaits::SnareDrumEngine snare_drum_engine_;
    plaits::HiHatEngine hi_hat_engine_;

    plaits::VirtualAnalogVCFEngine virtual_analog_vcf_engine_;
    plaits::PhaseDistortionEngine phase_distortion_engine_;
    plaits::SixOpEngine six_op_engine_;
    plaits::WaveTerrainEngine wave_terrain_engine_;
    plaits::StringMachineEngine string_machine_engine_;
    plaits::ChiptuneEngine chiptune_engine_;

    plaits::EngineRegistry<kNumEngines> engines_;
    int previous_engine_index_ = -1;

    plaits::DecayEnvelope decay_envelope_;
    plaits::LPGEnvelope lpg_envelope_;
    plaits::LowPassGate out_lpg_;
    plaits::LowPassGate aux_lpg_;
    stmlib::Limiter out_limiter_;
    stmlib::Limiter aux_limiter_;
};

// ─────────────────────────────────────────────────────────────────────────────
// Resampler — 48 kHz control-rate audio → the context rate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed polyphase windowed-sinc interpolator, stereo. kTaps taps per phase,
 * kPhases phases with linear interpolation between neighbours (the
 * fractional position moves continuously, so any output rate works).
 * Cut-off sits at 0.92 × the lower of the two Nyquists, Blackman-Harris
 * window (−92 dB sidelobes). Delay: kTaps / 2 input samples (0.33 ms).
 * The table is built at init — the only allocation.
 */
class Resampler {
public:
    static constexpr int kTaps = 32;
    static constexpr int kPhases = 256;

    Resampler() = default;
    Resampler(const Resampler&) = delete;
    Resampler& operator=(const Resampler&) = delete;
    ~Resampler() { std::free(table_); }

    bool init(float inRate, float outRate) {
        step_ = static_cast<double>(inRate) / static_cast<double>(outRate);
        pos_ = 0.0;
        std::memset(histL_, 0, sizeof(histL_));
        std::memset(histR_, 0, sizeof(histR_));
        write_ = 0;
        if (!table_) {
            table_ = static_cast<float*>(std::malloc(sizeof(float) * (kPhases + 1) * kTaps));
            if (!table_) return false;
        }
        const double cutoff = 0.92 * std::min(1.0, static_cast<double>(outRate) / inRate);
        const double half = kTaps / 2;
        const double pi = 3.14159265358979323846;
        for (int p = 0; p <= kPhases; ++p) {
            const double frac = static_cast<double>(p) / kPhases;
            double sum = 0.0;
            float* row = table_ + p * kTaps;
            for (int j = 0; j < kTaps; ++j) {
                // Tap j weighs the sample (half - 1 - j + frac) input samples away.
                const double t = half - 1.0 - j + frac;
                const double x = cutoff * t;
                const double sinc = std::fabs(x) < 1e-12 ? 1.0 : std::sin(pi * x) / (pi * x);
                const double w = blackmanHarris((t + half) / (2.0 * half));
                const double h = cutoff * sinc * w;
                row[j] = static_cast<float>(h);
                sum += h;
            }
            // Unity DC gain on every phase: no ripple as the fraction moves.
            for (int j = 0; j < kTaps; ++j) row[j] = static_cast<float>(row[j] / sum);
        }
        return true;
    }

    /** True when the next output needs another input sample first. */
    bool needsInput() const { return pos_ >= 1.0; }

    void push(float l, float r) {
        histL_[write_] = histL_[write_ + kTaps] = l;
        histR_[write_] = histR_[write_ + kTaps] = r;
        write_ = (write_ + 1) & (kTaps - 1);
        pos_ -= 1.0;
    }

    void pull(float& l, float& r) {
        const double phase = pos_ * kPhases;
        int p0 = static_cast<int>(phase);
        if (p0 >= kPhases) p0 = kPhases - 1;
        const float a = static_cast<float>(phase - p0);
        const float* h0 = table_ + p0 * kTaps;
        const float* h1 = h0 + kTaps;
        // Oldest sample first: tap 0 is the oldest of the kTaps in history.
        const float* xl = histL_ + write_;
        const float* xr = histR_ + write_;
        float accL = 0.0f, accR = 0.0f;
        for (int j = 0; j < kTaps; ++j) {
            const float h = h0[j] + a * (h1[j] - h0[j]);
            accL += h * xl[j];
            accR += h * xr[j];
        }
        l = accL;
        r = accR;
        pos_ += step_;
    }

private:
    static double blackmanHarris(double x) {  // x in [0, 1]
        const double pi2 = 2.0 * 3.14159265358979323846;
        return 0.35875 - 0.48829 * std::cos(pi2 * x) + 0.14128 * std::cos(2 * pi2 * x) -
               0.01168 * std::cos(3 * pi2 * x);
    }

    static_assert((kTaps & (kTaps - 1)) == 0, "the history ring masks by kTaps");

    float* table_ = nullptr;
    double step_ = 1.0;
    double pos_ = 0.0;
    float histL_[2 * kTaps] = {};
    float histR_[2 * kTaps] = {};
    int write_ = 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// MacroEngine — one part (SYNTH A or B): up to 8 voices, on the voice core
// ─────────────────────────────────────────────────────────────────────────────

/** Allocation state of one voice. */
struct VoiceSlot {
    int note = -1;
    bool gate = false;
    bool rise = false;              // rising edge goes out with the next block
    bool releaseAfterRise = false;  // a noteOff arrived before the rise sounded
    bool releasedUnrendered = false;  // gate closed, no block rendered since
    bool active = false;            // rendered at all
    bool sounded = false;           // has been above kSilence since its noteOn
    float velocity = 0.8f;
    float timbreOffset = 0.0f;
    float morphOffset = 0.0f;
    float pitch = 60.0f;            // current, gliding toward pitchTarget
    float pitchTarget = 60.0f;
    float glideCoeff = 1.0f;        // per control block; 1 = jump
    uint32_t age = 0;               // allocation order (older = smaller)
    int quietBlocks = 0;
    int fadeBlocks = 0;             // > 0: hard stop in progress
};

struct MacroEngine {
    MacroEngine() = default;
    MacroEngine(const MacroEngine&) = delete;
    MacroEngine& operator=(const MacroEngine&) = delete;
    ~MacroEngine() {
        if (voices_) {
            for (int i = 0; i < kMaxVoices; ++i) voices_[i].~MacroVoice();
            std::free(voices_);
        }
        std::free(ram_);
    }

    // ── Setup (the only allocations) ────────────────────────────────────────

    bool init(float sampleRate, int maxFrames) {
        outRate_ = sampleRate > 0.0f ? sampleRate : kInternalRate;
        stride_ = maxFrames;
        if (!voices_) {
            // aligned_alloc wants a size that is a multiple of the alignment.
            const size_t voiceBytes = (sizeof(MacroVoice) * kMaxVoices + 15) & ~static_cast<size_t>(15);
            void* mem = std::aligned_alloc(16, voiceBytes);
            void* ram = std::aligned_alloc(16, kVoiceRamBytes * kMaxVoices);
            if (!mem || !ram) {
                std::free(mem);
                std::free(ram);
                return false;
            }
            std::memset(ram, 0, kVoiceRamBytes * kMaxVoices);
            voices_ = static_cast<MacroVoice*>(mem);
            ram_ = static_cast<char*>(ram);
            for (int i = 0; i < kMaxVoices; ++i) ::new (static_cast<void*>(voices_ + i)) MacroVoice();
        }
        for (int i = 0; i < kMaxVoices; ++i) {
            stmlib::BufferAllocator allocator(ram_ + i * kVoiceRamBytes, kVoiceRamBytes);
            voices_[i].Init(&allocator);
            slots_[i] = VoiceSlot();
        }
        bypass_ = std::fabs(outRate_ - kInternalRate) < 0.5f;
        if (!resampler_.init(kInternalRate, outRate_)) return false;
        // Plaits' pitch table assumes the module's real 47872.34 Hz clock;
        // at a true 48 kHz that is 4.6 cents sharp, so pull it back.
        tuneCompensation_ = 12.0f * std::log2(plaits::kCorrectedSampleRate / kInternalRate);
        volume_.setTime(0.01f, kInternalRate);
        volume_.reset(volumeTarget_);
        fifoPos_ = kBlock;
        clock_ = 0;
        lastPitch_ = -1.0f;
        return true;
    }

    // ── Events ──────────────────────────────────────────────────────────────

    void apply(const hyphon::Event& e) {
        switch (e.type) {
            case hyphon::kNoteOn:
                noteOn(e.target, e.value, e.args[0], e.args[1] > 0.5f, e.args[2], e.args[3]);
                break;
            case hyphon::kNoteOff: noteOff(e.target); break;
            case hyphon::kAllNotesOff: releaseAll(); break;
            case hyphon::kParam: setParam(e.target, e.value); break;
            default: break;
        }
    }

    void setParam(int id, float v) {
        if (!std::isfinite(v)) return;
        switch (id) {
            case MACRO_ENGINE:
                engine_ = static_cast<int>(clampf(std::round(v), 0.0f, kNumEngines - 1.0f));
                break;
            case MACRO_HARMONICS: harmonics_ = clampf(v, 0.0f, 1.0f); break;
            case MACRO_TIMBRE: timbre_ = clampf(v, 0.0f, 1.0f); break;
            case MACRO_MORPH: morph_ = clampf(v, 0.0f, 1.0f); break;
            case MACRO_DECAY: decay_ = clampf(v, 0.0f, 1.0f); break;
            case MACRO_LPG_COLOUR: lpgColour_ = clampf(v, 0.0f, 1.0f); break;
            case MACRO_VOLUME:
                volumeTarget_ = clampf(v, 0.0f, 2.0f);
                volume_.set(volumeTarget_);
                break;
            case MACRO_POLYPHONY: setPolyphony(static_cast<int>(std::round(v))); break;
            case MACRO_FM_MOD: fmAmount_ = clampf(v, -1.0f, 1.0f); break;
            case MACRO_TIMBRE_MOD: timbreAmount_ = clampf(v, -1.0f, 1.0f); break;
            case MACRO_MORPH_MOD: morphAmount_ = clampf(v, -1.0f, 1.0f); break;
            case MACRO_SPREAD: spread_ = clampf(v, 0.0f, 1.0f); break;
            case MACRO_GLIDE: glide_ = clampf(v, 0.0f, 1.0f); break;
            case MACRO_LPG_MODE: ping_ = v >= 0.5f; break;
            case MACRO_TRANSPOSE: transpose_ = clampf(v, -48.0f, 48.0f); break;
            case MACRO_AUX_MIX: auxMix_ = clampf(v, 0.0f, 1.0f); break;
            default: break;
        }
    }

    void noteOn(int note, float velocity, float timbreOffset, bool slide, float fine, float morphOffset) {
        if (note < 0 || note > 127) return;
        if (velocity > 1.0f) velocity /= 127.0f;  // tolerate MIDI-scale callers
        const float target = static_cast<float>(note) + (std::isfinite(fine) ? clampf(fine, -24.0f, 24.0f) : 0.0f);
        const int index = allocate(note);
        VoiceSlot& s = slots_[index];

        const float glideSeconds = glideTime(slide);
        // A slid note on the frame the previous one ends (the sequencer's
        // noteOff and noteOn share it, noteOff first) is still legato: the gate
        // closed, but no audio has been rendered with it closed.
        const bool held = s.gate || s.releasedUnrendered;
        const bool legato = polyphony_ == 1 && slide && held && s.active && s.fadeBlocks == 0;
        const bool glides = glideSeconds > 0.0f && lastPitch_ >= 0.0f;

        s.note = note;
        s.velocity = clampf(std::isfinite(velocity) ? velocity : 0.8f, 0.0f, 1.0f);
        s.timbreOffset = std::isfinite(timbreOffset) ? clampf(timbreOffset, -1.0f, 1.0f) : 0.0f;
        s.morphOffset = std::isfinite(morphOffset) ? clampf(morphOffset, -1.0f, 1.0f) : 0.0f;
        s.pitchTarget = target;
        if (glides) {
            // A voice that was asleep starts from the part's last pitch; a
            // sounding one glides from wherever it is.
            if (!s.active || s.fadeBlocks > 0) s.pitch = lastPitch_;
            s.glideCoeff = 1.0f - std::exp(-kBlockSeconds / glideSeconds);
        } else {
            s.pitch = target;
            s.glideCoeff = 1.0f;
        }
        lastPitch_ = target;

        if (legato) {
            // Mono slide: same gate, new pitch — no retrigger.
            s.gate = true;
            s.releasedUnrendered = false;
            s.age = ++ageCounter_;
            return;
        }
        if (s.fadeBlocks > 0) {
            // Re-using a voice mid-stop: start it clean.
            voices_[index].Silence();
            s.fadeBlocks = 0;
        }
        s.gate = true;
        s.rise = true;
        s.releaseAfterRise = false;
        s.releasedUnrendered = false;
        s.active = true;
        s.sounded = false;
        s.quietBlocks = 0;
        s.age = ++ageCounter_;
    }

    void noteOff(int note) {
        for (int i = 0; i < kMaxVoices; ++i) {
            VoiceSlot& s = slots_[i];
            if (!s.gate || s.note != note) continue;
            if (s.rise) {
                s.releaseAfterRise = true;  // let the trigger sound for one block first
            } else {
                s.gate = false;
                s.releasedUnrendered = true;
            }
        }
    }

    /** MIDI All Notes Off: every gate closes; tails ring out. */
    void releaseAll() {
        for (int i = 0; i < kMaxVoices; ++i) {
            VoiceSlot& s = slots_[i];
            if (!s.gate) continue;
            if (s.rise) {
                s.releaseAfterRise = true;
            } else {
                s.gate = false;
                s.releasedUnrendered = true;
            }
        }
    }

    /** Transport stop: gates close and every voice fades out over 2 ms. */
    void stop() {
        for (int i = 0; i < kMaxVoices; ++i) {
            VoiceSlot& s = slots_[i];
            s.gate = false;
            s.rise = false;
            s.releaseAfterRise = false;
            s.releasedUnrendered = false;
            if (s.active && s.fadeBlocks == 0) s.fadeBlocks = kStopFadeBlocks;
        }
        lastPitch_ = -1.0f;
    }

    int activeVoices() const {
        int n = 0;
        for (int i = 0; i < kMaxVoices; ++i) n += slots_[i].active ? 1 : 0;
        return n;
    }

    int stride() const { return stride_; }

    /** Rising edges rendered so far (tests: a legato slide adds none). */
    uint32_t triggers() const { return triggers_; }

    // ── Render (planar stereo at the context rate) ──────────────────────────

    void render(float* out, int frames) {
        float* left = out;
        float* right = out + stride_;
        if (bypass_) {
            for (int i = 0; i < frames; ++i) {
                if (fifoPos_ == kBlock) refill();
                left[i] = fifoL_[fifoPos_];
                right[i] = fifoR_[fifoPos_];
                ++fifoPos_;
            }
            return;
        }
        for (int i = 0; i < frames; ++i) {
            while (resampler_.needsInput()) {
                if (fifoPos_ == kBlock) refill();
                resampler_.push(fifoL_[fifoPos_], fifoR_[fifoPos_]);
                ++fifoPos_;
            }
            resampler_.pull(left[i], right[i]);
        }
    }

private:
    float glideTime(bool slide) const {
        // 0 → off, 0.5 ≈ 45 ms, 1 = 1 s (exponential, like a portamento pot).
        const float t = glide_ > 0.0f ? 0.002f * std::pow(500.0f, glide_) : 0.0f;
        return slide ? std::max(t, kSlideSeconds) : t;
    }

    void setPolyphony(int n) {
        n = std::max(1, std::min(kMaxVoices, n));
        if (n == polyphony_) return;
        polyphony_ = n;
        for (int i = n; i < kMaxVoices; ++i) {
            VoiceSlot& s = slots_[i];
            s.gate = false;
            s.rise = false;
            if (s.active && s.fadeBlocks == 0) s.fadeBlocks = kStopFadeBlocks;
        }
    }

    /**
     * The voice for a new note: the one already playing that note, else an
     * idle voice (the one asleep longest), else the oldest released voice,
     * else the oldest held one (stolen).
     */
    int allocate(int note) {
        const int n = polyphony_;
        if (n == 1) return 0;
        for (int i = 0; i < n; ++i) {
            const VoiceSlot& s = slots_[i];
            if (s.note == note && s.active && s.fadeBlocks == 0) return i;
        }
        int best = -1;
        for (int i = 0; i < n; ++i) {
            if (!slots_[i].active && (best < 0 || slots_[i].age < slots_[best].age)) best = i;
        }
        if (best >= 0) return best;
        for (int i = 0; i < n; ++i) {
            if (!slots_[i].gate && (best < 0 || slots_[i].age < slots_[best].age)) best = i;
        }
        if (best >= 0) return best;
        for (int i = 0; i < n; ++i) {
            if (best < 0 || slots_[i].age < slots_[best].age) best = i;
        }
        return best;
    }

    /** One 48 kHz control block of every sounding voice into the FIFO. */
    void refill() {
        std::memset(fifoL_, 0, sizeof(fifoL_));
        std::memset(fifoR_, 0, sizeof(fifoR_));

        VoiceControl c;
        c.engine = engine_;
        c.harmonics = harmonics_;
        c.decay = decay_;
        c.lpgColour = lpgColour_;
        c.fmAmount = fmAmount_;
        c.timbreAmount = timbreAmount_;
        c.morphAmount = morphAmount_;
        c.ping = ping_;

        const float midWeight = 1.0f - auxMix_;
        for (int i = 0; i < kMaxVoices; ++i) {
            VoiceSlot& s = slots_[i];
            if (!s.active) continue;

            if (s.pitch != s.pitchTarget) {
                s.pitch += (s.pitchTarget - s.pitch) * s.glideCoeff;
                if (std::fabs(s.pitchTarget - s.pitch) < 1.0e-4f) s.pitch = s.pitchTarget;
            }
            c.note = s.pitch + transpose_ + tuneCompensation_;
            c.timbre = clampf(timbre_ + s.timbreOffset, 0.0f, 1.0f);
            c.morph = clampf(morph_ + s.morphOffset, 0.0f, 1.0f);
            c.level = s.velocity;
            c.gate = s.gate;
            c.risingEdge = s.rise;

            voices_[i].Render(c, out_, aux_, kBlock);

            if (s.rise) ++triggers_;
            s.rise = false;
            s.releasedUnrendered = false;
            if (s.releaseAfterRise) {
                s.gate = false;
                s.releaseAfterRise = false;
            }

            float gain = kVoiceGain;
            if (ping_) gain *= 0.25f + 0.75f * s.velocity;  // the LPG ping ignores velocity
            float fadeStep = 0.0f;
            if (s.fadeBlocks > 0) {
                fadeStep = gain / (kStopFadeBlocks * kBlock);
                gain *= static_cast<float>(s.fadeBlocks) / kStopFadeBlocks;
            }

            float peak = 0.0f;
            for (int k = 0; k < kBlock; ++k) {
                const float o = out_[k];
                const float a = aux_[k];
                peak = std::max(peak, std::max(std::fabs(o), std::fabs(a)));
                const float mid = o * midWeight + a * auxMix_;
                const float side = spread_ * (a * midWeight + o * auxMix_);
                const float g = gain - fadeStep * k;
                fifoL_[k] += g * (mid + side);
                fifoR_[k] += g * (mid - side);
            }

            if (s.fadeBlocks > 0) {
                if (--s.fadeBlocks == 0) sleep(i);
                continue;
            }
            if (peak > kSilence) {
                s.quietBlocks = 0;
                s.sounded = true;
            } else if (++s.quietBlocks >= (s.gate ? kQuietBlocksDecayed : kQuietBlocksReleased) &&
                       (!s.gate || s.sounded)) {
                // Released and silent, or a self-enveloped sound that has died
                // while its gate is still held (a long drum note).
                s.active = false;
            }
        }

        for (int k = 0; k < kBlock; ++k) {
            const float v = volume_.next();
            fifoL_[k] = hyphon::flushDenormal(fifoL_[k] * v);
            fifoR_[k] = hyphon::flushDenormal(fifoR_[k] * v);
        }
        fifoPos_ = 0;
        ++clock_;
    }

    void sleep(int i) {
        VoiceSlot& s = slots_[i];
        s.active = false;
        s.gate = false;
        s.fadeBlocks = 0;
        voices_[i].Silence();
    }

    MacroVoice* voices_ = nullptr;
    char* ram_ = nullptr;
    VoiceSlot slots_[kMaxVoices];
    uint32_t ageCounter_ = 0;
    uint32_t triggers_ = 0;

    float outRate_ = kInternalRate;
    int stride_ = 0;
    bool bypass_ = true;
    Resampler resampler_;
    float fifoL_[kBlock] = {};
    float fifoR_[kBlock] = {};
    int fifoPos_ = kBlock;
    uint64_t clock_ = 0;
    float out_[plaits::kMaxBlockSize] = {};
    float aux_[plaits::kMaxBlockSize] = {};
    float tuneCompensation_ = 0.0f;
    float lastPitch_ = -1.0f;

    // Part parameters (MacroParam), at the defaults MacroParams.ts applies on ready.
    int engine_ = 8;  // virtual analog
    float harmonics_ = 0.5f;
    float timbre_ = 0.5f;
    float morph_ = 0.5f;
    float decay_ = 0.5f;
    float lpgColour_ = 0.5f;
    float volumeTarget_ = 0.8f;
    hyphon::Smoothed volume_;
    int polyphony_ = kMaxVoices;
    float fmAmount_ = 0.0f;
    float timbreAmount_ = 0.0f;
    float morphAmount_ = 0.0f;
    float spread_ = 0.3f;
    float glide_ = 0.0f;
    bool ping_ = false;
    float transpose_ = 0.0f;
    float auxMix_ = 0.0f;
};

}  // namespace macro

using MacroNativeVoice = hyphon::NativeVoice<macro::MacroEngine, 256, 2>;

// Part A + part B per audio session; the slack covers offline renders and tests.
HYPHON_EXPORT_VOICE(macro, MacroNativeVoice, 8)

// ─────────────────────────────────────────────────────────────────────────────
// Immediate C API
// ─────────────────────────────────────────────────────────────────────────────

extern "C" {

EMSCRIPTEN_KEEPALIVE
void macro_note_on(uintptr_t handle, int midiNote, float velocity)
{
    if (auto* v = macro_voice(handle)) v->engine.noteOn(midiNote, velocity, 0.0f, false, 0.0f, 0.0f);
}

EMSCRIPTEN_KEEPALIVE
void macro_note_off(uintptr_t handle, int midiNote)
{
    if (auto* v = macro_voice(handle)) v->engine.noteOff(midiNote);
}

/** Transport stop: drop what is scheduled is the caller's job (macro_cancel_notes). */
EMSCRIPTEN_KEEPALIVE
void macro_all_notes_off(uintptr_t handle)
{
    if (auto* v = macro_voice(handle)) v->engine.stop();
}

EMSCRIPTEN_KEEPALIVE
void macro_set_param(uintptr_t handle, int paramId, float value)
{
    if (auto* v = macro_voice(handle)) v->engine.setParam(paramId, value);
}

/**
 * A knob move: set @p paramId now and drop every event still scheduled for
 * it. Notes push their patch ahead of time (the sequencer's lookahead), so
 * without the drop a value queued before the knob moved would land after it
 * and undo the move. Consumer side — call from the thread that renders.
 */
EMSCRIPTEN_KEEPALIVE
void macro_set_param_now(uintptr_t handle, int paramId, float value)
{
    MacroNativeVoice* v = macro_voice(handle);
    if (!v) return;
    v->schedule.absorb(v->ring);
    v->schedule.removeIf([paramId](const hyphon::Event& e) {
        return e.type == hyphon::kParam && static_cast<int>(e.target) == paramId;
    });
    v->engine.setParam(paramId, value);
}

/**
 * Render @p numFrames with no event timing into the voice's planar stereo
 * buffer and return it (owned by the voice — do NOT free it). 0 on error,
 * including a block larger than init reserved: the right channel sits one
 * stride in, so the buffer cannot grow under it.
 */
EMSCRIPTEN_KEEPALIVE
uintptr_t macro_process(uintptr_t handle, int numFrames)
{
    MacroNativeVoice* v = macro_voice(handle);
    if (!v || v->buffer.capacity() == 0) return 0;  // not initialised
    if (numFrames <= 0) return reinterpret_cast<uintptr_t>(v->buffer.data());
    if (numFrames > v->maxFrames) {
        ++v->stats.overruns;
        return 0;
    }
    float* out = v->buffer.acquire(numFrames);
    v->engine.render(out, numFrames);
    return reinterpret_cast<uintptr_t>(out);
}

EMSCRIPTEN_KEEPALIVE
int macro_engine_count()
{
    return macro::kNumEngines;
}

EMSCRIPTEN_KEEPALIVE
int macro_active_voices(uintptr_t handle)
{
    MacroNativeVoice* v = macro_voice(handle);
    return v ? v->engine.activeVoices() : 0;
}

EMSCRIPTEN_KEEPALIVE
int macro_stride(uintptr_t handle)
{
    MacroNativeVoice* v = macro_voice(handle);
    return v ? v->maxFrames : 0;
}

} // extern "C"
