// emscripten/rubberband_fx.cpp — see rubberband_fx.h for the contract.
//
// Each stage below is a port of one module in src/audio-worklets/rubberband/;
// the comment on each names it. Character matches the TS oracle within the
// tolerance in src/__tests__/nativeVocalFx.integration.test.ts (not bit-exact:
// the compressor folds log10/pow into one pow, and C++ libm differs from V8).
// State is double like the JS numbers it replaces; audio spans stay float32.

#include "rubberband_fx.h"

#include <emscripten/emscripten.h>
#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;
constexpr double kSqrt1_2 = 0.70710678118654752440;

struct Grain {
    int phase = 0;
    int start = 0;
    int size = 0;
    bool active = false;
};

} // namespace

struct RbFx {
    double sampleRate;
    int maxFrames;
    double params[RB_FX_PARAM_COUNT];
    std::vector<float> channels[2];

    uint32_t rng = 0x9E3779B9u;

    // Source material for the freeze granulator.
    std::vector<float> sample;
    std::vector<float> customWindowShape;
    std::vector<float> customGrainEnvelope;

    // granularEngine.ts
    Grain grains[2];
    double grainLpState = 0.0;
    double freezeLfoPhase = 0.0;
    double grainLfoPhase = 0.0;
    bool wasFrozen = false;
    bool grainWrapPending = false;
    double grainPanL[3] = {kSqrt1_2, kSqrt1_2, kSqrt1_2};
    double grainPanR[3] = {kSqrt1_2, kSqrt1_2, kSqrt1_2};

    // toneFilters.ts
    double toneState = 0.0;
    double toneCutoffHz = 20000.0;
    // Coefficients for toneCoefHz. The smoothed cutoff settles to a fixed point
    // within a few thousand samples; after that the per-sample cos/sqrt is a
    // cache hit with bit-identical results.
    double toneCoefHz = -1.0;
    double toneB1 = 0.0;
    double toneA0 = 1.0;
    double syllableCutoffSmooth = 20000.0;
    double syllableLp = 0.0;
    double gatePhase = 0.0;
    double gateLfo = 1.0;

    // spectralEffects.ts
    double lp1 = 0.0, bp1 = 0.0, lp2 = 0.0, bp2 = 0.0;
    double bandEnv[3] = {0.0, 0.0, 0.0};

    // chorusEffect.ts
    std::vector<float> chorusBuf[2];
    int chorusWritePtr = 0;
    double chorusLfoPhase = 0.0;

    // subHarmonics.ts
    int subLastSign[2] = {0, 0};
    int subToggle[2] = {1, 1};
    double subLp1[2] = {0.0, 0.0};
    double subLp2[2] = {0.0, 0.0};

    // drumDuckEnvelope.ts (dynamic EQ band cut)
    double duckLp[2] = {0.0, 0.0};
    double duckBp[2] = {0.0, 0.0};

    // bitcrusher.ts
    double downsamplePhase[2] = {0.0, 0.0};
    double crushHeld[2] = {0.0, 0.0};

    double param(RbFxParam id) const { return params[id]; }

    /** xorshift32 → [0, 1), 24-bit resolution (reproducible from TS in tests). */
    double random() {
        uint32_t x = rng;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        rng = x;
        return (x >> 8) * (1.0 / 16777216.0);
    }
};

namespace {

// ---------------------------------------------------------------------------
// granularEngine.ts — GranularEngine.updateGrainPan
// ---------------------------------------------------------------------------
void updateGrainPan(RbFx& fx) {
    const double spread = fx.param(RB_FX_GRAIN_PAN_SPREAD);
    if (spread > 0 && fx.grainWrapPending) {
        fx.grainWrapPending = false;
        const double finalSpread = fx.param(RB_FX_IS_VOWEL) > 0 ? spread : spread * 0.3;
        // Pseudo-spiral LFO path per band (cos, sin, +45°) plus a little jitter.
        const double phases[3] = {fx.grainLfoPhase, fx.grainLfoPhase - kPi / 2, fx.grainLfoPhase + kPi / 4};
        for (int b = 0; b < 3; ++b) {
            const double spreadMod = b == 0 ? 0.4 : b == 1 ? 0.8 : 1.2;
            const double jitter = (fx.random() * 2 - 1) * 0.2;
            const double pos = std::max(-1.0, std::min(1.0, std::cos(phases[b]) + jitter));
            const double pan = pos * std::min(1.0, finalSpread * spreadMod);
            const double angle = ((pan + 1.0) * 0.5) * kPi / 2;
            fx.grainPanL[b] = std::cos(angle);
            fx.grainPanR[b] = std::sin(angle);
        }
    } else if (spread == 0) {
        for (int b = 0; b < 3; ++b) {
            fx.grainPanL[b] = kSqrt1_2;
            fx.grainPanR[b] = kSqrt1_2;
        }
    }
}

// ---------------------------------------------------------------------------
// toneFilters.ts — PhonemeToneFilter (mono)
// ---------------------------------------------------------------------------
void phonemeToneFilter(RbFx& fx, float* out, int n) {
    const double mod = fx.param(RB_FX_PHONEME_FILTER_MOD);
    if (fx.param(RB_FX_HAS_PHONEME_CONTEXT) > 0) {
        const double volume = fx.param(RB_FX_PHONEME_VOLUME);
        if (mod > 0.0) {
            const double minFc = 200, maxFc = 10000;
            const double brightness = std::pow(std::max(0.0, std::min(1.0, volume)), 0.7);
            const double targetFc = minFc + (maxFc - minFc) * (mod * brightness);
            const double w = kTwoPi / fx.sampleRate;
            for (int i = 0; i < n; ++i) {
                fx.toneCutoffHz = fx.toneCutoffHz * 0.99 + targetFc * 0.01;
                if (fx.toneCutoffHz != fx.toneCoefHz) {
                    const double costh = 2.0 - std::cos(w * fx.toneCutoffHz);
                    fx.toneB1 = std::sqrt(costh * costh - 1.0) - costh;
                    fx.toneA0 = 1.0 + fx.toneB1;
                    fx.toneCoefHz = fx.toneCutoffHz;
                }
                fx.toneState = fx.toneA0 * out[i] - fx.toneB1 * fx.toneState;
                out[i] = static_cast<float>(fx.toneState);
            }
        } else if (n > 0) {
            fx.toneState = out[n - 1];
        }
        if (volume != 1.0) {
            for (int i = 0; i < n; ++i) out[i] = static_cast<float>(out[i] * volume);
        }
    } else if (mod == 0.0 && n > 0) {
        fx.toneState = out[n - 1];
    }
}

// ---------------------------------------------------------------------------
// toneFilters.ts — SyllableVolumeFilter. The TS version also filters the
// right channel, but R is overwritten by the spectral stage, so mono is exact.
// ---------------------------------------------------------------------------
void syllableVolumeFilter(RbFx& fx, float* out, int n) {
    const double mod = fx.param(RB_FX_VOLUME_FILTER_MOD);
    if (mod <= 0) return;
    const double amount = mod * (0.25 + 0.75 * fx.param(RB_FX_IS_VOWEL));
    const double vol = std::min(1.0, std::max(0.0, fx.param(RB_FX_SYLLABLE_VOLUME)));
    const double targetCutoff = 400 * std::pow(8000.0 / 400.0, vol * amount);
    const double dt = 1.0 / fx.sampleRate;
    const double smoothAlpha = dt / (0.01 + dt);
    fx.syllableCutoffSmooth += smoothAlpha * (targetCutoff - fx.syllableCutoffSmooth);
    const double rc = 1.0 / (kTwoPi * fx.syllableCutoffSmooth);
    const double alpha = dt / (rc + dt);
    double lp = fx.syllableLp;
    for (int i = 0; i < n; ++i) {
        lp += alpha * (out[i] - lp);
        out[i] = static_cast<float>(lp);
    }
    fx.syllableLp = lp;
}

// ---------------------------------------------------------------------------
// toneFilters.ts — TranceGate (mono)
// ---------------------------------------------------------------------------
void tranceGate(RbFx& fx, float* out, int n) {
    const double depth = fx.param(RB_FX_GATE_DEPTH);
    const double rate = fx.param(RB_FX_GATE_RATE);
    if (!(depth > 0 && rate > 0)) return;
    const double inc = kTwoPi * rate / fx.sampleRate;
    for (int i = 0; i < n; ++i) {
        fx.gatePhase += inc;
        if (fx.gatePhase > kTwoPi) fx.gatePhase -= kTwoPi;
        const double target = std::sin(fx.gatePhase) > 0 ? 1.0 : 0.0;
        fx.gateLfo = fx.gateLfo * 0.92 + target * 0.08;
        out[i] = static_cast<float>(out[i] * (1.0 - depth * (1.0 - fx.gateLfo)));
    }
}

// ---------------------------------------------------------------------------
// spectralEffects.ts — SpectralBandProcessor, mono in → stereo out.
//
// One Chamberlin split and ONE compressor per band per sample. The TS history
// ran a second split + compress through the same filter memory (removed from
// TS in #1228); the unregistered `spectralCompression` leveler stage that TS
// still carries is a second compressor and is deliberately not ported.
// ---------------------------------------------------------------------------
void spectralBands(RbFx& fx, float* L, float* R, int n) {
    const double comp = fx.param(RB_FX_SPECTRAL_COMP);
    const double spread = fx.param(RB_FX_GRAIN_PAN_SPREAD);
    if (!(comp > 0 || spread > 0)) {
        std::memcpy(R, L, sizeof(float) * static_cast<size_t>(n));
        return;
    }

    const double fs = fx.sampleRate;
    const double f1 = 2 * std::sin(kPi * 300 / fs);
    const double f2 = 2 * std::sin(kPi * 3000 / fs);
    const double q = 0.5;
    const double attackCoef = std::exp(-1.0 / (fs * (2.0 / 1000.0)));
    const double releaseCoef = std::exp(-1.0 / (fs * (50.0 / 1000.0)));
    const double threshold = 0.1;
    const double ratio = 1.0 + 3.0 * comp;
    // 20log10(env/thr)·(1−1/ratio) dB of reduction capped at 12·comp dB, as a
    // single pow: gain = max((env/thr)^−slope, 10^(−maxGR/20)).
    const double slope = 1.0 - 1.0 / ratio;
    const double minGain = std::pow(10.0, -(12.0 * comp) / 20.0);
    const bool compress = comp > 0;

    const double panL0 = fx.grainPanL[0], panL1 = fx.grainPanL[1], panL2 = fx.grainPanL[2];
    const double panR0 = fx.grainPanR[0], panR1 = fx.grainPanR[1], panR2 = fx.grainPanR[2];
    double lp1 = fx.lp1, bp1 = fx.bp1, lp2 = fx.lp2, bp2 = fx.bp2;
    double* env = fx.bandEnv;

    for (int i = 0; i < n; ++i) {
        const double x = L[i];
        lp1 += f1 * bp1;
        const double hp1 = x - lp1 - q * bp1;
        bp1 += f1 * hp1;
        lp2 += f2 * bp2;
        const double hp2 = hp1 - lp2 - q * bp2;
        bp2 += f2 * hp2;

        double bands[3] = {lp1, lp2, hp2};
        if (compress) {
            for (int b = 0; b < 3; ++b) {
                const double a = std::fabs(bands[b]);
                const double c = a > env[b] ? attackCoef : releaseCoef;
                env[b] = c * env[b] + (1 - c) * a;
                if (env[b] > threshold) {
                    bands[b] *= std::max(std::pow(env[b] / threshold, -slope), minGain);
                }
            }
        }

        L[i] = static_cast<float>(bands[0] * panL0 + bands[1] * panL1 + bands[2] * panL2);
        R[i] = static_cast<float>(bands[0] * panR0 + bands[1] * panR1 + bands[2] * panR2);
    }

    fx.lp1 = lp1; fx.bp1 = bp1; fx.lp2 = lp2; fx.bp2 = bp2;
}

// ---------------------------------------------------------------------------
// chorusEffect.ts — VocalChorusEffect (stereo)
// ---------------------------------------------------------------------------
void vocalChorus(RbFx& fx, float* ch[2], int n) {
    const double amount = fx.param(RB_FX_VOCAL_CHORUS);
    if (amount <= 0) return;
    const double wet = amount * (fx.param(RB_FX_IS_VOWEL) > 0 ? 1.0 : 0.3);
    const double fs = fx.sampleRate;
    const int bufferSize = static_cast<int>(fx.chorusBuf[0].size());
    const double lfoInc = kTwoPi * 0.6 / fs;
    const double dryGain = 1.0 - wet * 0.3;
    const double wetGain = wet * 0.7;
    const double tapMix[2][2] = {{0.8, 0.2}, {0.2, 0.8}};

    for (int i = 0; i < n; ++i) {
        fx.chorusLfoPhase += lfoInc;
        if (fx.chorusLfoPhase > kTwoPi) fx.chorusLfoPhase -= kTwoPi;
        const double lfo = std::sin(fx.chorusLfoPhase);
        const int d1 = static_cast<int>(std::floor((12.0 + lfo * 3.0 * amount) * 0.001 * fs));
        const int d2 = static_cast<int>(std::floor((18.0 - lfo * 4.0 * amount) * 0.001 * fs));
        int r1 = fx.chorusWritePtr - d1;
        int r2 = fx.chorusWritePtr - d2;
        if (r1 < 0) r1 += bufferSize;
        if (r2 < 0) r2 += bufferSize;

        for (int c = 0; c < 2; ++c) {
            float* buf = fx.chorusBuf[c].data();
            const double dry = ch[c][i];
            buf[fx.chorusWritePtr] = ch[c][i];
            const double mixed = buf[r1] * tapMix[c][0] + buf[r2] * tapMix[c][1];
            ch[c][i] = static_cast<float>(dry * dryGain + mixed * wetGain);
        }

        if (++fx.chorusWritePtr >= bufferSize) fx.chorusWritePtr = 0;
    }
}

// ---------------------------------------------------------------------------
// subHarmonics.ts — SubHarmonicsEffect (stereo), ducked on kicks by the caller
// logic in rubberband-processor.ts, folded in here. SIMD: L/R in f64x2 lanes,
// same IEEE ops as the scalar loop (see masterDuck).
// ---------------------------------------------------------------------------
void subHarmonics(RbFx& fx, float* ch[2], int n) {
    const double duck = fx.param(RB_FX_DUCKING_SCALAR);
    const double amount = fx.param(RB_FX_SUB_HARMONICS) *
        (fx.param(RB_FX_DRUM_IS_SNARE) == 0.0 ? std::max(0.0, 1.0 - duck) : 1.0);
    if (amount <= 0 || fx.param(RB_FX_IS_VOWEL) <= 0) return;

    const double rc = 1.0 / (kTwoPi * 80.0);
    const double dt = 1.0 / fx.sampleRate;
    const double alpha = dt / (rc + dt);
    const double drive = 2.5;

#ifdef __wasm_simd128__
    float* L = ch[0];
    float* R = ch[1];
    const v128_t one = wasm_f64x2_splat(1.0);
    const v128_t minusOne = wasm_f64x2_splat(-1.0);
    const v128_t zero = wasm_f64x2_splat(0.0);
    const v128_t half = wasm_f64x2_splat(0.5);
    const v128_t four = wasm_f64x2_splat(4.0);
    const v128_t vAlpha = wasm_f64x2_splat(alpha);
    const v128_t vDrive = wasm_f64x2_splat(drive);
    const v128_t vAmount = wasm_f64x2_splat(amount);
    v128_t lastSign = wasm_f64x2_make(fx.subLastSign[0], fx.subLastSign[1]);
    v128_t toggle = wasm_f64x2_make(fx.subToggle[0], fx.subToggle[1]);
    v128_t lp1 = wasm_f64x2_make(fx.subLp1[0], fx.subLp1[1]);
    v128_t lp2 = wasm_f64x2_make(fx.subLp2[0], fx.subLp2[1]);
    for (int i = 0; i < n; ++i) {
        const v128_t x = wasm_f64x2_make(L[i], R[i]);
        // A new positive half-cycle (sign turns +1 from 0 / −1) flips the divider.
        const v128_t isPos = wasm_f64x2_ge(x, zero);
        const v128_t flip = wasm_v128_andnot(isPos, wasm_f64x2_eq(lastSign, one));
        toggle = wasm_v128_bitselect(wasm_f64x2_neg(toggle), toggle, flip);
        lastSign = wasm_v128_bitselect(one, minusOne, isPos);
        lp1 = wasm_f64x2_add(lp1, wasm_f64x2_mul(vAlpha, wasm_f64x2_sub(wasm_f64x2_mul(toggle, half), lp1)));
        lp2 = wasm_f64x2_add(lp2, wasm_f64x2_mul(vAlpha, wasm_f64x2_sub(lp1, lp2)));
        const v128_t driven = wasm_f64x2_mul(wasm_f64x2_mul(lp2, four), vDrive);
        const v128_t saturated = wasm_f64x2_div(driven, wasm_f64x2_add(one, wasm_f64x2_abs(driven)));
        const v128_t sub = wasm_f64x2_mul(wasm_f64x2_mul(wasm_f64x2_div(saturated, vDrive), four), vAmount);
        const v128_t y = wasm_f64x2_add(x, sub);
        L[i] = static_cast<float>(wasm_f64x2_extract_lane(y, 0));
        R[i] = static_cast<float>(wasm_f64x2_extract_lane(y, 1));
    }
    for (int c = 0; c < 2; ++c) {
        const double s = c == 0 ? wasm_f64x2_extract_lane(lastSign, 0) : wasm_f64x2_extract_lane(lastSign, 1);
        const double t = c == 0 ? wasm_f64x2_extract_lane(toggle, 0) : wasm_f64x2_extract_lane(toggle, 1);
        fx.subLastSign[c] = static_cast<int>(s);
        fx.subToggle[c] = static_cast<int>(t);
    }
    fx.subLp1[0] = wasm_f64x2_extract_lane(lp1, 0);
    fx.subLp1[1] = wasm_f64x2_extract_lane(lp1, 1);
    fx.subLp2[0] = wasm_f64x2_extract_lane(lp2, 0);
    fx.subLp2[1] = wasm_f64x2_extract_lane(lp2, 1);
#else
    for (int c = 0; c < 2; ++c) {
        float* out = ch[c];
        int lastSign = fx.subLastSign[c];
        int toggle = fx.subToggle[c];
        double lp1 = fx.subLp1[c], lp2 = fx.subLp2[c];
        for (int i = 0; i < n; ++i) {
            const double x = out[i];
            const int sign = x >= 0 ? 1 : -1;
            if (sign != lastSign) {
                if (sign == 1) toggle = -toggle;
                lastSign = sign;
            }
            lp1 += alpha * (toggle * 0.5 - lp1);
            lp2 += alpha * (lp1 - lp2);
            const double driven = lp2 * 4.0 * drive;
            const double saturated = driven / (1.0 + std::fabs(driven));
            out[i] = static_cast<float>(x + (saturated / drive) * 4.0 * amount);
        }
        fx.subLastSign[c] = lastSign;
        fx.subToggle[c] = toggle;
        fx.subLp1[c] = lp1;
        fx.subLp2[c] = lp2;
    }
#endif
}

// ---------------------------------------------------------------------------
// drumDuckEnvelope.ts — DrumDuckEnvelope.applyMasterDuck (stereo): a 350 Hz
// Chamberlin band cut scaled by the duck, then vowel-weighted gain. The filter
// only runs while ducking, like the TS state it mirrors.
//
// L and R share every coefficient, so the SIMD build runs both channels in the
// two f64x2 lanes. Lane arithmetic is the same IEEE double math as the scalar
// loop, so both paths are bit-identical to the TS oracle.
// ---------------------------------------------------------------------------
void masterDuck(RbFx& fx, float* ch[2], int n) {
    const double duck = fx.param(RB_FX_DUCKING_SCALAR);
    if (duck <= 0) return;
    const double g = 1.0 - duck * (0.25 + 0.75 * fx.param(RB_FX_IS_VOWEL));
    const double q = 0.5;
    const double w = 2.0 * std::sin(kPi * 350.0 / fx.sampleRate);
#ifdef __wasm_simd128__
    float* L = ch[0];
    float* R = ch[1];
    const v128_t vw = wasm_f64x2_splat(w);
    const v128_t vq = wasm_f64x2_splat(q);
    const v128_t vDuck = wasm_f64x2_splat(duck);
    const v128_t vg = wasm_f64x2_splat(g);
    v128_t lp = wasm_f64x2_make(fx.duckLp[0], fx.duckLp[1]);
    v128_t bp = wasm_f64x2_make(fx.duckBp[0], fx.duckBp[1]);
    for (int i = 0; i < n; ++i) {
        const v128_t x = wasm_f64x2_make(L[i], R[i]);
        lp = wasm_f64x2_add(lp, wasm_f64x2_mul(vw, bp));
        const v128_t hp = wasm_f64x2_sub(wasm_f64x2_sub(x, lp), wasm_f64x2_mul(vq, bp));
        bp = wasm_f64x2_add(bp, wasm_f64x2_mul(vw, hp));
        const v128_t band = wasm_f64x2_mul(bp, vq);
        const v128_t y = wasm_f64x2_mul(wasm_f64x2_sub(x, wasm_f64x2_mul(band, vDuck)), vg);
        L[i] = static_cast<float>(wasm_f64x2_extract_lane(y, 0));
        R[i] = static_cast<float>(wasm_f64x2_extract_lane(y, 1));
    }
    fx.duckLp[0] = wasm_f64x2_extract_lane(lp, 0);
    fx.duckLp[1] = wasm_f64x2_extract_lane(lp, 1);
    fx.duckBp[0] = wasm_f64x2_extract_lane(bp, 0);
    fx.duckBp[1] = wasm_f64x2_extract_lane(bp, 1);
#else
    for (int c = 0; c < 2; ++c) {
        float* out = ch[c];
        double lp = fx.duckLp[c], bp = fx.duckBp[c];
        for (int i = 0; i < n; ++i) {
            const double x = out[i];
            lp += w * bp;
            const double hp = x - lp - q * bp;
            bp += w * hp;
            out[i] = static_cast<float>((x - bp * q * duck) * g);
        }
        fx.duckLp[c] = lp;
        fx.duckBp[c] = bp;
    }
#endif
}

// ---------------------------------------------------------------------------
// bitcrusher.ts — Bitcrusher (stereo)
// ---------------------------------------------------------------------------
void bitcrusher(RbFx& fx, float* ch[2], int n) {
    const double amount = fx.param(RB_FX_BITCRUSH);
    const double factor = fx.param(RB_FX_DOWNSAMPLE);
    if (!(amount > 0 || factor > 1.0)) return;
    const double steps = amount > 0 ? std::pow(2.0, 16 - amount * 14) : 0.0;
    for (int c = 0; c < 2; ++c) {
        float* out = ch[c];
        double phase = fx.downsamplePhase[c];
        double held = fx.crushHeld[c];
        for (int i = 0; i < n; ++i) {
            phase += 1.0;
            if (phase >= factor) {
                phase -= factor;
                held = amount > 0 ? std::floor(out[i] * steps) / steps : out[i];
            }
            out[i] = static_cast<float>(held);
        }
        fx.downsamplePhase[c] = phase;
        fx.crushHeld[c] = held;
    }
}

double interpolate(const std::vector<float>& table, double phase) {
    const double index = phase * (table.size() - 1);
    const size_t lower = static_cast<size_t>(std::floor(index));
    const size_t upper = static_cast<size_t>(std::ceil(index));
    const double weight = index - lower;
    return table[lower] * (1 - weight) + table[upper] * weight;
}

double windowValue(const RbFx& fx, double phase) {
    if (!fx.customWindowShape.empty()) return interpolate(fx.customWindowShape, phase);
    if (!fx.customGrainEnvelope.empty()) return interpolate(fx.customGrainEnvelope, phase);
    const double shape = fx.param(RB_FX_WINDOW_SHAPE);
    // 0 Hann, 1 Hamming, 2 Blackman, 3 Rectangular, 4 Gaussian, 5 sin^4
    if (shape < 0.5) return 0.5 * (1 - std::cos(kTwoPi * phase));
    if (shape < 1.5) return 0.54 - 0.46 * std::cos(kTwoPi * phase);
    if (shape < 2.5) return 0.42 - 0.5 * std::cos(kTwoPi * phase) + 0.08 * std::cos(2 * kTwoPi * phase);
    if (shape < 3.5) return 1.0;
    if (shape < 4.5) {
        const double z = (phase - 0.5) / 0.15;
        return std::exp(-0.5 * z * z);
    }
    const double s = std::sin(kPi * phase);
    return s * s * s * s;
}

} // namespace

// ===========================================================================
// C API
// ===========================================================================

EMSCRIPTEN_KEEPALIVE int rb_fx_abi_version(void) { return RB_FX_ABI_VERSION; }
EMSCRIPTEN_KEEPALIVE int rb_fx_param_count(void) { return RB_FX_PARAM_COUNT; }

EMSCRIPTEN_KEEPALIVE RbFx* rb_fx_create(double sampleRate, int maxFrames) {
    if (!(sampleRate > 0) || maxFrames <= 0) return nullptr;
    RbFx* fx = new RbFx();
    fx->sampleRate = sampleRate;
    fx->maxFrames = maxFrames;
    std::fill(std::begin(fx->params), std::end(fx->params), 0.0);
    fx->params[RB_FX_DOWNSAMPLE] = 1.0;
    fx->params[RB_FX_PHONEME_VOLUME] = 1.0;
    fx->params[RB_FX_SYLLABLE_VOLUME] = 1.0;
    fx->params[RB_FX_PHONEME_GRAIN_JITTER] = -1.0;
    fx->params[RB_FX_PHONEME_GRAIN_SIZE_MS] = -1.0;
    fx->channels[0].assign(static_cast<size_t>(maxFrames), 0.0f);
    fx->channels[1].assign(static_cast<size_t>(maxFrames), 0.0f);
    fx->chorusBuf[0].assign(48000, 0.0f);
    fx->chorusBuf[1].assign(48000, 0.0f);
    return fx;
}

EMSCRIPTEN_KEEPALIVE void rb_fx_destroy(RbFx* fx) { delete fx; }

EMSCRIPTEN_KEEPALIVE double* rb_fx_params(RbFx* fx) { return fx->params; }

EMSCRIPTEN_KEEPALIVE float* rb_fx_channel(RbFx* fx, int ch) {
    return (ch == 0 || ch == 1) ? fx->channels[ch].data() : nullptr;
}

EMSCRIPTEN_KEEPALIVE void rb_fx_seed(RbFx* fx, uint32_t seed) { fx->rng = seed ? seed : 0x9E3779B9u; }

EMSCRIPTEN_KEEPALIVE void rb_fx_note_on(RbFx* fx) { fx->syllableLp = 0.0; }

EMSCRIPTEN_KEEPALIVE float* rb_fx_sample_alloc(RbFx* fx, int frames) {
    fx->sample.assign(static_cast<size_t>(std::max(0, frames)), 0.0f);
    for (Grain& g : fx->grains) g.active = false;
    return fx->sample.empty() ? nullptr : fx->sample.data();
}

EMSCRIPTEN_KEEPALIVE float* rb_fx_window_alloc(RbFx* fx, int kind, int len) {
    std::vector<float>* target = kind == RB_FX_WINDOW_CUSTOM_SHAPE ? &fx->customWindowShape
        : kind == RB_FX_WINDOW_CUSTOM_ENVELOPE ? &fx->customGrainEnvelope
        : nullptr;
    if (!target) return nullptr;
    target->assign(static_cast<size_t>(std::max(0, len)), 0.0f);
    return target->empty() ? nullptr : target->data();
}

EMSCRIPTEN_KEEPALIVE double rb_fx_advance_lfo(RbFx* fx, double freezeLfoRate, double grainLfoRate, int frames) {
    fx->freezeLfoPhase += kTwoPi * freezeLfoRate * frames / fx->sampleRate;
    if (fx->freezeLfoPhase > kTwoPi) fx->freezeLfoPhase -= kTwoPi;
    fx->grainLfoPhase += kTwoPi * grainLfoRate * frames / fx->sampleRate;
    if (fx->grainLfoPhase > kTwoPi) fx->grainLfoPhase -= kTwoPi;
    return std::sin(fx->freezeLfoPhase);
}

EMSCRIPTEN_KEEPALIVE void rb_fx_exit_freeze(RbFx* fx) {
    fx->grains[0].active = false;
    fx->grains[1].active = false;
    if (fx->wasFrozen) {
        fx->grainWrapPending = false;
        fx->wasFrozen = false;
        for (int b = 0; b < 3; ++b) {
            fx->grainPanL[b] = kSqrt1_2;
            fx->grainPanR[b] = kSqrt1_2;
        }
    }
}

// granularEngine.ts — enterFreeze + renderFrozenBlock (minus the stretcher call)
EMSCRIPTEN_KEEPALIVE int rb_fx_render_grains(RbFx* fx, float* out, int frames, int currentSample, int startSample, int endSample) {
    if (!fx->wasFrozen) fx->grainWrapPending = true;
    fx->wasFrozen = true;
    if (frames <= 0) return -1;

    const int bufLen = static_cast<int>(fx->sample.size());
    const float* buf = fx->sample.data();
    const double sr = fx->sampleRate;

    int baseGrainSize = static_cast<int>(std::floor(sr * 0.1));
    // Softer notes jitter more: velocity 1 → ×1, velocity 0 → ×1.5.
    const double velocityScale = std::max(1.0, 1.5 - fx->param(RB_FX_VELOCITY) * 0.5);
    double jitter = std::min(1.0, fx->param(RB_FX_GRAIN_JITTER) * velocityScale);
    if (fx->param(RB_FX_HAS_PHONEME_CONTEXT) > 0) {
        if (fx->param(RB_FX_PHONEME_GRAIN_JITTER) != -1.0) {
            jitter = std::min(1.0, fx->param(RB_FX_PHONEME_GRAIN_JITTER) * velocityScale);
        }
        if (fx->param(RB_FX_PHONEME_GRAIN_SIZE_MS) != -1.0) {
            baseGrainSize = static_cast<int>(std::floor(sr * (fx->param(RB_FX_PHONEME_GRAIN_SIZE_MS) / 1000.0)));
        }
    }

    const double grainLfo = std::sin(fx->grainLfoPhase);
    const double lfoMod = 1.0 - fx->param(RB_FX_GRAIN_LFO_DEPTH) * ((grainLfo + 1) * 0.5);
    const int maxPosScan = static_cast<int>(std::floor(0.25 * sr));
    const bool hasSlice = endSample > startSample;
    const int sliceStart = hasSlice ? startSample : 0;
    const int sliceEnd = hasSlice ? endSample : bufLen;
    const int sliceLen = std::max(0, sliceEnd - sliceStart);
    const int allowedScan = std::min(maxPosScan, static_cast<int>(std::floor(sliceLen * 0.5)));
    const int posMod = static_cast<int>(std::floor(grainLfo * fx->param(RB_FX_GRAIN_POS_LFO_DEPTH) * allowedScan));
    const int maxJitter = static_cast<int>(std::floor(0.05 * sr * jitter));
    const double ducking = fx->param(RB_FX_DUCKING_SCALAR);
    const double envShrink = 1.0 - fx->param(RB_FX_GRAIN_ENV_DEPTH) * fx->param(RB_FX_ENVELOPE_VALUE);

    auto initGrain = [&](Grain& g) {
        const double ducked = baseGrainSize * (1.0 - ducking * 0.5);
        const int size = std::max(100, static_cast<int>(std::floor(ducked * lfoMod * envShrink)));
        const int jitterOffset = maxJitter > 0
            ? static_cast<int>(std::floor((fx->random() * 2 - 1) * maxJitter)) : 0;
        const int rawCenter = currentSample + jitterOffset + posMod;
        const int center = std::max(sliceStart + size / 2, std::min(sliceEnd - size / 2, rawCenter));
        g.start = std::max(0, std::min(bufLen - size, center - size / 2));
        g.size = std::min(bufLen, g.start + size) - g.start;
        g.phase = 0;
        g.active = g.size > 0;
    };

    if (!fx->grains[0].active && !fx->grains[1].active) initGrain(fx->grains[0]);
    if (!fx->grains[0].active && !fx->grains[1].active) return 0;

    double cutoff = 20000;
    if (fx->param(RB_FX_HAS_PHONEME_CONTEXT) > 0 && fx->param(RB_FX_PHONEME_VOLUME) < 1.0) {
        cutoff = 200 * std::pow(100.0, fx->param(RB_FX_PHONEME_VOLUME));
    }
    const double dt = 1.0 / sr;
    const double rc = 1.0 / (kTwoPi * cutoff);
    const double alpha = dt / (rc + dt);

    for (int i = 0; i < frames; ++i) {
        double value = 0;
        for (int gi = 0; gi < 2; ++gi) {
            Grain& g = fx->grains[gi];
            if (!g.active) continue;
            const double phase = g.size > 1 ? static_cast<double>(g.phase) / (g.size - 1) : 0.0;
            value += buf[g.start + g.phase] * windowValue(*fx, phase);
            g.phase++;

            Grain& other = fx->grains[1 - gi];
            if (g.phase == g.size / 2 && !other.active) initGrain(other);

            if (g.phase >= g.size) {
                g.active = false;
                // Only the primary grain re-randomises the pan (avoids flutter).
                if (gi == 0) fx->grainWrapPending = true;
            }
        }
        fx->grainLpState += alpha * (value - fx->grainLpState);
        out[i] = static_cast<float>(fx->grainLpState);
    }
    return frames;
}

EMSCRIPTEN_KEEPALIVE void rb_fx_process(RbFx* fx, float* ioL, float* ioR, int frames) {
    if (frames <= 0) return;
    phonemeToneFilter(*fx, ioL, frames);
    syllableVolumeFilter(*fx, ioL, frames);
    tranceGate(*fx, ioL, frames);
    updateGrainPan(*fx);
    spectralBands(*fx, ioL, ioR, frames);
    float* ch[2] = {ioL, ioR};
    vocalChorus(*fx, ch, frames);
    subHarmonics(*fx, ch, frames);
    masterDuck(*fx, ch, frames);
    bitcrusher(*fx, ch, frames);
}
