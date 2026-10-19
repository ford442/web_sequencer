/**
 * drumkit_wrapper.cpp
 *
 * Analog-modelled 808/909 drum kit compiled into hyphon_native.wasm.
 *
 * One handle owns kick + snare + closed/open hats so the live worklet can
 * instantiate the voice module once (no extra SharedArrayBuffer per pad).
 *
 * Built on the shared voice core (emscripten/core/voice.h, #1344): the
 * generic exports come from HYPHON_EXPORT_VOICE —
 *   drumkit_create / _destroy / _init(handle, sampleRate, maxFrames)
 *   drumkit_push_event(handle, frame, type, target, value, a, b, c, d)
 *   drumkit_render(handle, blockStartFrame, numFrames)  → float*, sample-accurate,
 *       planar stereo: left at the pointer, right maxFrames (init) floats on
 *   drumkit_cancel_notes(handle)
 * Events: hyphon::kTrigger (target = voice, value = velocity, args = a..d),
 * kDrumkitChokeOpenHat, kDrumkitSetKit (target = kit),
 * kDrumkitSetPan (target = voice, value = pan -1..1). A pan is latched by the
 * voice's next trigger, so the worklet pushes it just before the trigger on the
 * same frame; a hit that is still ringing keeps the pan it started with.
 *
 * Immediate API (tests and tools/render_hyphon_native_parity.mjs; applies at
 * the next block):
 *   drumkit_set_kit(handle, kit)                        // 0 = 808, 1 = 909
 *   drumkit_trigger(handle, voice, velocity, a, b, c, d)
 *   drumkit_choke_open_hat(handle)
 *   drumkit_process(handle, numFrames)                  → uintptr_t → float*
 *
 * Voice IDs: 0 kick, 1 snare, 2 closed hat, 3 open hat.
 * Keep kit multipliers in sync with src/engines/DrumKitCharacter.ts.
 *
 * © 2026 Hyphon contributors – MIT License
 */

#include <emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "core/voice.h"
#include "core/voice_exports.h"

enum DrumkitVoice : int {
    DRUMKIT_KICK = 0,
    DRUMKIT_SNARE = 1,
    DRUMKIT_CLOSED_HAT = 2,
    DRUMKIT_OPEN_HAT = 3,
};

enum DrumkitKit : int {
    DRUMKIT_KIT_808 = 0,
    DRUMKIT_KIT_909 = 1,
};

struct KitCharacter {
    float kickFreqStart;
    float kickFreqEnd;
    float kickPitchCurve;
    float snareNoiseFreq;
    float snareNoiseQ;
    float hatResonance;
    int hatOscCount;
};

static constexpr KitCharacter kKit808{
    1.0f, 0.08f, 0.6f, 1500.0f, 1.0f, 2.0f, 4,
};
static constexpr KitCharacter kKit909{
    1.2f, 0.01f, 0.3f, 3000.0f, 2.0f, 4.0f, 6,
};

static constexpr float kTwoPi = 6.283185307179586f;
static constexpr float kPi = 3.141592653589793f;
static constexpr float kHatRatios[6] = {
    1.00f, 1.34f, 1.54f, 1.83f, 2.33f, 2.67f,
};

struct Biquad {
    float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
    float a1 = 0.0f, a2 = 0.0f;
    float z1 = 0.0f, z2 = 0.0f;

    void reset() {
        z1 = 0.0f;
        z2 = 0.0f;
    }

    float process(float x) {
        const float y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        return y;
    }

    void setBandpass(float sampleRate, float freq, float q) {
        freq = std::clamp(freq, 20.0f, sampleRate * 0.45f);
        q = std::max(0.1f, q);
        const float w0 = kTwoPi * freq / sampleRate;
        const float alpha = std::sin(w0) / (2.0f * q);
        const float cosw = std::cos(w0);
        const float a0 = 1.0f + alpha;
        b0 = alpha / a0;
        b1 = 0.0f;
        b2 = -alpha / a0;
        a1 = (-2.0f * cosw) / a0;
        a2 = (1.0f - alpha) / a0;
    }

    void setHighpass(float sampleRate, float freq, float q) {
        freq = std::clamp(freq, 20.0f, sampleRate * 0.45f);
        q = std::max(0.1f, q);
        const float w0 = kTwoPi * freq / sampleRate;
        const float alpha = std::sin(w0) / (2.0f * q);
        const float cosw = std::cos(w0);
        const float a0 = 1.0f + alpha;
        b0 = ((1.0f + cosw) * 0.5f) / a0;
        b1 = (-(1.0f + cosw)) / a0;
        b2 = ((1.0f + cosw) * 0.5f) / a0;
        a1 = (-2.0f * cosw) / a0;
        a2 = (1.0f - alpha) / a0;
    }
};

struct KickVoice {
    bool active = false;
    float t = 0.0f;
    float phase = 0.0f;
    float startFreq = 150.0f;
    float endFreq = 12.0f;
    float sweepTime = 0.3f;
    float decay = 0.5f;
    float volume = 1.0f;
    float clickLevel = 0.0f;

    void trigger(float pitch, float decaySec, float tone, float vol, const KitCharacter& c) {
        startFreq = std::max(1.0f, pitch * c.kickFreqStart * 3.0f);
        endFreq = std::max(0.01f, pitch * c.kickFreqEnd);
        sweepTime = std::max(0.001f, decaySec * c.kickPitchCurve);
        decay = std::max(0.01f, decaySec);
        volume = vol;
        clickLevel = tone * 0.3f;
        t = 0.0f;
        phase = 0.0f;
        active = true;
    }

    float tick(float dt, float sampleRate) {
        if (!active) return 0.0f;
        t += dt;
        if (t >= decay + 0.01f) {
            active = false;
            return 0.0f;
        }
        float freq = endFreq;
        if (t < sweepTime) {
            const float ratio = endFreq / startFreq;
            freq = startFreq * std::pow(ratio, t / sweepTime);
        }
        phase += freq / sampleRate;
        if (phase >= 1.0f) phase -= std::floor(phase);
        const float sine = std::sin(phase * kTwoPi);

        float amp;
        if (t < 0.005f) {
            const float click = volume + clickLevel;
            amp = click + (volume - click) * (t / 0.005f);
        } else {
            const float remain = std::max(1e-6f, decay - 0.005f);
            const float u = std::min(1.0f, (t - 0.005f) / remain);
            amp = volume * std::exp(std::log(0.001f / std::max(volume, 1e-6f)) * u);
        }
        if (amp < 1e-5f && t > 0.02f) {
            active = false;
        }
        return sine * amp;
    }
};

struct SnareVoice {
    bool active = false;
    float t = 0.0f;
    float phase = 0.0f;
    float toneHz = 200.0f;
    float decay = 0.3f;
    float toneLevel = 0.5f;
    float noiseLevel = 0.4f;
    Biquad noiseBp;
    uint32_t rng = 0xA5A5C3C3u;

    void trigger(float tone, float decaySec, float noise, float vol, const KitCharacter& c, float sampleRate) {
        toneHz = std::max(20.0f, tone);
        decay = std::max(0.01f, decaySec);
        toneLevel = vol * 0.6f;
        noiseLevel = std::min(1.0f, noise / 5000.0f) * vol;
        t = 0.0f;
        phase = 0.0f;
        rng ^= static_cast<uint32_t>(toneHz * 17.0f) + 1u;
        noiseBp.reset();
        noiseBp.setBandpass(sampleRate, c.snareNoiseFreq, c.snareNoiseQ);
        active = true;
    }

    float nextNoise() {
        rng ^= rng << 13;
        rng ^= rng >> 17;
        rng ^= rng << 5;
        return (static_cast<int32_t>(rng) / 2147483648.0f);
    }

    float tick(float dt, float sampleRate) {
        if (!active) return 0.0f;
        t += dt;
        if (t >= decay + 0.01f) {
            active = false;
            return 0.0f;
        }
        float bodyFreq = toneHz;
        const float bodySweep = decay * 0.3f;
        if (t < bodySweep) {
            bodyFreq = toneHz * std::pow(0.5f, t / bodySweep);
        } else {
            bodyFreq = toneHz * 0.5f;
        }
        phase += bodyFreq / sampleRate;
        if (phase >= 1.0f) phase -= std::floor(phase);
        const float tri = 4.0f * std::fabs(phase - 0.5f) - 1.0f;

        const float bodyRemain = std::max(1e-6f, decay * 0.5f);
        const float bodyU = std::min(1.0f, t / bodyRemain);
        const float bodyAmp = toneLevel * std::exp(std::log(0.001f / std::max(toneLevel, 1e-6f)) * bodyU);

        const float noiseU = std::min(1.0f, t / decay);
        const float nAmp = noiseLevel * std::exp(std::log(0.001f / std::max(noiseLevel, 1e-6f)) * noiseU);
        const float noise = noiseBp.process(nextNoise()) * nAmp;

        if (bodyAmp + nAmp < 1e-5f && t > 0.02f) {
            active = false;
        }
        return tri * bodyAmp + noise;
    }
};

struct HatVoice {
    bool active = false;
    bool choking = false;
    float t = 0.0f;
    float chokeT = 0.0f;
    float decay = 0.05f;
    float volume = 0.7f;
    float phases[6]{};
    int oscCount = 4;
    float basePitch = 8000.0f;
    Biquad hp;
    Biquad bp;
    static constexpr float kChokeSec = 0.002f;

    void trigger(float pitch, float decaySec, float vol, const KitCharacter& c, float sampleRate, uint32_t seed) {
        decay = std::max(0.005f, decaySec);
        volume = vol;
        oscCount = std::clamp(c.hatOscCount, 1, 6);
        t = 0.0f;
        chokeT = 0.0f;
        choking = false;
        for (int i = 0; i < 6; ++i) {
            phases[i] = ((seed >> (i * 3)) & 0x7) / 8.0f;
        }
        hp.reset();
        bp.reset();
        hp.setHighpass(sampleRate, pitch, c.hatResonance);
        bp.setBandpass(sampleRate, pitch * 1.5f, c.hatResonance * 0.5f);
        basePitch = pitch;
        active = true;
        (void)seed;
    }

    void choke() {
        if (active && !choking) {
            choking = true;
            chokeT = 0.0f;
        }
    }

    float tick(float dt, float sampleRate) {
        if (!active) return 0.0f;
        t += dt;
        float chokeGain = 1.0f;
        if (choking) {
            chokeT += dt;
            chokeGain = std::max(0.0f, 1.0f - chokeT / kChokeSec);
            if (chokeGain <= 0.0f) {
                active = false;
                choking = false;
                return 0.0f;
            }
        }
        if (t >= decay + 0.01f) {
            active = false;
            return 0.0f;
        }
        float stack = 0.0f;
        for (int i = 0; i < oscCount; ++i) {
            const float freq = basePitch * kHatRatios[i];
            phases[i] += freq / sampleRate;
            if (phases[i] >= 1.0f) phases[i] -= std::floor(phases[i]);
            stack += phases[i] < 0.5f ? 1.0f : -1.0f;
        }
        stack /= static_cast<float>(oscCount);
        const float shaped = bp.process(hp.process(stack));
        const float u = std::min(1.0f, t / decay);
        const float amp = volume * std::exp(std::log(0.001f / std::max(volume, 1e-6f)) * u);
        if (amp < 1e-5f && t > 0.01f && !choking) {
            active = false;
        }
        return shaped * amp * chokeGain;
    }
};

/** Engine-private event types (hyphon::kEngine and up). */
enum DrumkitEvent : uint16_t {
    kDrumkitChokeOpenHat = hyphon::kEngine,
    kDrumkitSetKit       = hyphon::kEngine + 1,  // target = kit
    kDrumkitSetPan       = hyphon::kEngine + 2,  // target = voice, value = pan
};

static constexpr int kDrumkitVoiceCount = 4;

/**
 * Constant-power pan with unity at the centre: each channel is √2·cos / √2·sin
 * of the pan angle, so L² + R² = 2 everywhere — a centred hit is exactly the
 * mono kit on both channels, a hard-panned one is +3 dB on its side. Keep in
 * sync with drumPanGains() in src/engines/DrumKitEngine.ts.
 */
struct PanGains {
    float left = 1.0f;
    float right = 1.0f;
};

static PanGains panGains(float pan) {
    if (!std::isfinite(pan) || pan == 0.0f) return {};
    const float angle = (std::clamp(pan, -1.0f, 1.0f) + 1.0f) * (kPi * 0.25f);
    constexpr float kSqrt2 = 1.41421356237f;
    return {kSqrt2 * std::cos(angle), kSqrt2 * std::sin(angle)};
}

struct DrumkitEngine {
    float sampleRate = 44100.0f;
    int kit = DRUMKIT_KIT_808;
    KickVoice kick;
    SnareVoice snare;
    HatVoice closedHat;
    HatVoice openHat;
    /** Pan the next trigger of each voice takes (kDrumkitSetPan). */
    float nextPan[kDrumkitVoiceCount] = {0.0f, 0.0f, 0.0f, 0.0f};
    /** Pan of the hit each voice is playing. */
    PanGains pan[kDrumkitVoiceCount];
    int stride = 0;  // channel stride of the planar output (init's maxFrames)

    const KitCharacter& character() const {
        return kit == DRUMKIT_KIT_909 ? kKit909 : kKit808;
    }

    bool init(float sr, int maxFrames) {
        sampleRate = sr > 0.0f ? sr : 44100.0f;
        stride = maxFrames;
        return maxFrames > 0;
    }

    void setPan(int voice, float value) {
        if (voice >= 0 && voice < kDrumkitVoiceCount) nextPan[voice] = value;
    }

    void setKit(int k) {
        kit = (k == DRUMKIT_KIT_909) ? DRUMKIT_KIT_909 : DRUMKIT_KIT_808;
    }

    void trigger(int voice, float velocity, float a, float b, float c, float d) {
        const float vel = std::clamp(velocity, 0.0f, 2.0f);
        const KitCharacter& ch = character();
        if (voice >= 0 && voice < kDrumkitVoiceCount) pan[voice] = panGains(nextPan[voice]);
        switch (voice) {
            case DRUMKIT_KICK:
                kick.trigger(a, b, c, d * vel, ch);
                break;
            case DRUMKIT_SNARE:
                snare.trigger(a, b, c, d * vel, ch, sampleRate);
                break;
            case DRUMKIT_CLOSED_HAT:
                openHat.choke();
                closedHat.trigger(a, b, c * vel, ch, sampleRate, 0xC105EDu);
                break;
            case DRUMKIT_OPEN_HAT:
                openHat.trigger(a, b, c * vel, ch, sampleRate, 0x0A11u);
                break;
            default:
                break;
        }
    }

    void chokeOpenHat() { openHat.choke(); }

    void apply(const hyphon::Event& e) {
        switch (e.type) {
            case hyphon::kTrigger:
                trigger(e.target, e.value, e.args[0], e.args[1], e.args[2], e.args[3]);
                break;
            case kDrumkitChokeOpenHat:
                chokeOpenHat();
                break;
            case kDrumkitSetKit:
                setKit(e.target);
                break;
            case kDrumkitSetPan:
                setPan(e.target, e.value);
                break;
            default:
                break;
        }
    }

    /** Planar stereo: left at out[i], right at out[stride + i]. */
    void render(float* out, int numFrames) {
        const float dt = 1.0f / sampleRate;
        float* right = out + stride;
        const PanGains& pk = pan[DRUMKIT_KICK];
        const PanGains& ps = pan[DRUMKIT_SNARE];
        const PanGains& pc = pan[DRUMKIT_CLOSED_HAT];
        const PanGains& po = pan[DRUMKIT_OPEN_HAT];
        for (int i = 0; i < numFrames; ++i) {
            const float k = kick.tick(dt, sampleRate);
            const float sn = snare.tick(dt, sampleRate);
            const float ch = closedHat.tick(dt, sampleRate);
            const float oh = openHat.tick(dt, sampleRate);
            // Same summing order as the mono kit, so a centred hit (gain 1)
            // renders bit-for-bit what it did before pan.
            float l = k * pk.left;
            l += sn * ps.left;
            l += ch * pc.left;
            l += oh * po.left;
            float r = k * pk.right;
            r += sn * ps.right;
            r += ch * pc.right;
            r += oh * po.right;
            if (!std::isfinite(l)) l = 0.0f;
            if (!std::isfinite(r)) r = 0.0f;
            out[i] = std::clamp(l, -1.5f, 1.5f);
            right[i] = std::clamp(r, -1.5f, 1.5f);
        }
    }
};

using DrumkitNativeVoice = hyphon::NativeVoice<DrumkitEngine, 128, 2>;

// One kit per worklet today; the slack covers offline renders and tests.
HYPHON_EXPORT_VOICE(drumkit, DrumkitNativeVoice, 8)

extern "C" {

EMSCRIPTEN_KEEPALIVE
void drumkit_set_kit(uintptr_t handle, int kit) {
    if (auto* v = drumkit_voice(handle)) v->engine.setKit(kit);
}

EMSCRIPTEN_KEEPALIVE
void drumkit_trigger(uintptr_t handle, int voice, float velocity, float a, float b, float c, float d) {
    if (auto* v = drumkit_voice(handle)) v->engine.trigger(voice, velocity, a, b, c, d);
}

EMSCRIPTEN_KEEPALIVE
void drumkit_choke_open_hat(uintptr_t handle) {
    if (auto* v = drumkit_voice(handle)) v->engine.chokeOpenHat();
}

/**
 * Whole-block render with no event timing — the immediate calls above land on
 * the block's first frame. Planar stereo like drumkit_render. 0 (counted in
 * stats.overruns) for a block larger than init reserved: the right channel
 * sits one stride in, so the buffer cannot grow under it.
 */
EMSCRIPTEN_KEEPALIVE
uintptr_t drumkit_process(uintptr_t handle, int numFrames) {
    DrumkitNativeVoice* v = drumkit_voice(handle);
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

}  // extern "C"
