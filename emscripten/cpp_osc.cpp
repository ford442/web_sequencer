// emscripten/cpp_osc.cpp
//
// `cpp-*` oscillator family (#1665, parent #1663): the kernel behind Hyphon's
// "C++ OSC". Before this file existed `cpp-*` had no renderer at all — the
// selector offered it and it silently played an OscillatorNode (#1294 removed
// it for that). This is the real thing:
//
//   * It runs **inside an AudioWorklet** (src/audio-worklets/cpp-osc-processor.ts),
//     one instance per synth voice, driven sample by sample from the node's
//     a-rate `frequency` AudioParam. Nothing is pre-rendered or looped.
//   * It is **band-limited with a linear-phase windowed-sinc BLEP**, not a
//     polynomial approximation: every discontinuity (saw wrap, both square
//     edges) is corrected with the residual of a 32-tap Blackman-Harris
//     windowed sinc, and every slope corner (triangle) with its integral, the
//     BLAMP. That is the difference from the Rust OSC's 2-sample PolyBLEP: the
//     residual spans 16 samples either side, so aliases are pushed far below
//     the PolyBLEP's, at the cost of 16 samples of fixed latency (0.33 ms at
//     48 kHz — the output is the naive wave delayed by kZeroCrossings, with the
//     corrections added into the delay line ahead of it).
//   * Note onsets are band-limited too: a gate-open edge is a step from silence
//     to the wave's first value (plus a slope corner), corrected the same way.
//   * Sine is libm sin of the phase (no discontinuities, nothing to fix).
//   * Saw and square peak at ~1.17, not 1.0: that is the Gibbs overshoot every
//     properly band-limited edge has (a PolyBLEP's 2-sample residual is too
//     short to ring). A square so high that only its fundamental is left below
//     Nyquist is that sine, amplitude 4/pi ~ 1.27. Aliasing below 16 kHz measures ~-92 dB at 3.5 kHz, where
//     a naive saw is at -19 dB (src/__tests__/cppOscModule.test.ts).
//   * It is **scalar**: no simd128 requirement. A browser without WASM SIMD
//     (where the Rust OSC cannot run) still gets a band-limited live voice, so
//     `cpp` sits right below `rust` in the backend fallback order.
//   * It is **real-time safe**: no allocator, no exceptions, no imports, fixed
//     memory that never grows (build_cpp_osc.sh, wasm_memory_budget.json#cppOsc).
//     The residual tables are built once in cosc_init by trigonometric
//     recurrences — no libm calls in that loop — so creating a voice on the
//     audio thread costs ~0.1-0.3 ms once, well inside one render quantum.
//
// Filtering is deliberately absent, as for every basic-wave family: the voice's
// own BiquadFilterNode sits after this source (src/engines/VoiceManager.ts).
// A resonant in-kernel C++ filter is #1673.
//
// ABI (extern "C", the `cppOsc` section of wasm_export_manifest.json):
//   cosc_abi_version() -> int          bumps when the surface changes
//   cosc_max_frames()  -> int          capacity of the I/O buffers
//   cosc_latency()     -> int          fixed output delay, in samples
//   cosc_freq_ptr()    -> float*       frequency input (Hz)
//   cosc_out_ptr()     -> float*       rendered samples
//   cosc_init(sample_rate) -> int      1 on success; builds the tables
//   cosc_reset(phase)                  gate-open edge: phase in cycles, wrapped
//                                      to [0, 1); clears the delay line
//   cosc_render(shape, frames, per_sample_freq) -> int   frames rendered

#include <emscripten/emscripten.h>

#include <cmath>
#include <cstdint>

namespace {

constexpr int kAbiVersion = 1;

// A render quantum is 128 frames today; the headroom matches the Rust OSC so
// both worklets chunk the same way. Larger requests are split by the caller.
constexpr int kMaxFrames = 1024;

constexpr int kShapeSaw = 0;
constexpr int kShapeSqr = 1;
constexpr int kShapeTri = 2;
constexpr int kShapeSin = 3;

// Residual half-width in samples. 16 zero crossings of a Blackman-Harris
// windowed sinc puts its transition band at roughly 0.375-0.625 fs, so what
// does alias folds back above 0.375 fs (18 kHz at 48 kHz) and is attenuated by
// the window's > 90 dB sidelobes everywhere else.
constexpr int kZeroCrossings = 16;
constexpr int kSpan = 2 * kZeroCrossings;  // taps per correction
constexpr int kRing = kSpan;               // delay line (power of two)
constexpr int kRingMask = kRing - 1;
static_assert((kRing & kRingMask) == 0, "the delay line must be a power of two");

// Table resolution: points per sample of residual, linearly interpolated.
// 128 keeps the interpolation error near -80 dB of the step height.
constexpr int kOversample = 128;
// Each one-sample segment of the residual is stored with BOTH endpoints, so the
// BLEP's jump at tau = 0 is never interpolated across: segment kZeroCrossings-1
// ends at r(0-) = +1/2, segment kZeroCrossings starts at r(0+) = -1/2.
constexpr int kSegment = kOversample + 1;

// Highest phase increment accepted, cycles per sample (Nyquist). At or below
// it a sample advance crosses at most one discontinuity of any shape.
constexpr double kMaxInc = 0.5;

constexpr float kMinSampleRate = 8000.0f;
constexpr float kMaxSampleRate = 768000.0f;

constexpr double kPi = 3.14159265358979323846;

struct Engine {
    float freq[kMaxFrames];
    float out[kMaxFrames];
    // Pending output: slot (pos + j) & mask is sample n - kZeroCrossings + j.
    float ring[kRing];
    // Band-limited step minus the ideal step, per segment.
    float blep[kSpan][kSegment];
    // Its integral: band-limited ramp minus the ideal ramp, per segment.
    float blamp[kSpan][kSegment];
    double phase;       // cycles, always in [0, 1)
    double invSampleRate;
    uint32_t pos;
    bool onset;         // a gate-open edge is waiting to be band-limited
    bool ready;
};

Engine g;

// 4-term Blackman-Harris (-92 dB sidelobes).
constexpr double kBh0 = 0.35875;
constexpr double kBh1 = 0.48829;
constexpr double kBh2 = 0.14128;
constexpr double kBh3 = 0.01168;

/**
 * Walks the windowed sinc on a uniform grid with two rotation recurrences
 * (sin(pi t) and cos of the window angle) instead of calling libm per point.
 * Over the 8k steps of one pass the recurrence drifts by ~1e-12, far below the
 * float tables it fills.
 */
struct KernelWalk {
    double t;          // samples, from -kZeroCrossings
    double step;
    double sinPiT, cosPiT, sinD, cosD;    // sin(pi t) rotation
    double cosW, sinW, cosWD, sinWD;      // window angle 2 pi x, x = (t + Z) / 2Z

    explicit KernelWalk(double stepSamples) : t(-kZeroCrossings), step(stepSamples) {
        // kZeroCrossings is an integer, so sin(pi t) starts at exactly 0 and
        // cos(pi t) at (-1)^Z.
        sinPiT = 0.0;
        cosPiT = (kZeroCrossings % 2 == 0) ? 1.0 : -1.0;
        sinD = std::sin(kPi * step);
        cosD = std::cos(kPi * step);
        cosW = 1.0;
        sinW = 0.0;
        const double dw = kPi * step / kZeroCrossings;  // 2 pi * step / (2 Z)
        cosWD = std::cos(dw);
        sinWD = std::sin(dw);
    }

    double value() const {
        const double c1 = cosW;
        const double c2 = 2.0 * c1 * c1 - 1.0;   // cos 2a
        const double c3 = c1 * (2.0 * c2 - 1.0); // cos 3a
        const double w = kBh0 - kBh1 * c1 + kBh2 * c2 - kBh3 * c3;
        const double s = std::fabs(t) < 1e-9 ? 1.0 : sinPiT / (kPi * t);
        return s * w;
    }

    void advance() {
        const double s = sinPiT * cosD + cosPiT * sinD;
        const double c = cosPiT * cosD - sinPiT * sinD;
        sinPiT = s;
        cosPiT = c;
        const double sw = sinW * cosWD + cosW * sinWD;
        const double cw = cosW * cosWD - sinW * sinWD;
        sinW = sw;
        cosW = cw;
        t += step;
    }
};

/**
 * Fill g.blep / g.blamp. Simpson's rule on the table grid (midpoints from a
 * half-step walk) integrates the kernel k and the moment u*k(u):
 *
 *   S(tau) = (1/K) integral k         band-limited step, 0 -> 1
 *   I(tau) = tau S(tau) - (1/K) integral u k(u) du     its integral (by parts)
 *
 * blep  = S - H(tau)          (H: unit step, H(0) = 1)
 * blamp = I - max(0, tau)
 *
 * Two passes: the first only finds K, the normalisation, so the second writes
 * final values straight into the float tables.
 */
void buildTables() {
    constexpr int kIntervals = kSpan * kOversample;
    const double h = 1.0 / kOversample;

    double total = 0.0;
    {
        KernelWalk walk(h * 0.5);
        double left = walk.value();
        for (int i = 0; i < kIntervals; ++i) {
            walk.advance();
            const double mid = walk.value();
            walk.advance();
            const double right = walk.value();
            total += (h / 6.0) * (left + 4.0 * mid + right);
            left = right;
        }
    }
    const double invK = 1.0 / total;

    KernelWalk walk(h * 0.5);
    double s = 0.0;  // integral of k, unnormalised
    double m = 0.0;  // integral of u k(u)
    double tLeft = -kZeroCrossings;
    double left = walk.value();
    auto store = [&](int index, double tau, double stepS, double moment) {
        const int seg = index / kOversample;
        const int k = index % kOversample;
        const double S = stepS * invK;
        const double I = tau * S - moment * invK;
        const double ramp = tau > 0.0 ? tau : 0.0;
        // Right-hand limit at the start of each segment...
        if (seg < kSpan) {
            const double H = (tau >= 0.0) ? 1.0 : 0.0;
            g.blep[seg][k] = static_cast<float>(S - H);
            g.blamp[seg][k] = static_cast<float>(I - ramp);
        }
        // ...and the left-hand limit at the end of the previous one, which
        // differs from it only at tau = 0 (the step itself).
        if (k == 0 && seg > 0) {
            const double Hl = (tau > 0.0) ? 1.0 : 0.0;
            g.blep[seg - 1][kOversample] = static_cast<float>(S - Hl);
            g.blamp[seg - 1][kOversample] = static_cast<float>(I - ramp);
        }
    };
    store(0, tLeft, 0.0, 0.0);
    for (int i = 0; i < kIntervals; ++i) {
        walk.advance();
        const double mid = walk.value();
        walk.advance();
        const double right = walk.value();
        const double tMid = tLeft + 0.5 * h;
        const double tRight = tLeft + h;
        s += (h / 6.0) * (left + 4.0 * mid + right);
        m += (h / 6.0) * (tLeft * left + 4.0 * tMid * mid + tRight * right);
        // Grid index from the loop counter, not from t, so rounding in the
        // accumulated walk can never shift a value into the wrong segment.
        const int index = i + 1;
        const double tau = static_cast<double>(index) / kOversample - kZeroCrossings;
        store(index, tau, s, m);
        left = right;
        tLeft = tau;
    }
    // The residuals are zero outside +-Z by construction; pin the ends so
    // float rounding cannot leave a constant offset after a correction.
    g.blep[0][0] = 0.0f;
    g.blamp[0][0] = 0.0f;
    g.blep[kSpan - 1][kOversample] = 0.0f;
    g.blamp[kSpan - 1][kOversample] = 0.0f;
}

inline double incFor(float hz) {
    const double v = static_cast<double>(hz) * g.invSampleRate;
    // `!(v > 0)` is also true for NaN, so NaN Hz becomes 0 instead of
    // poisoning the phase.
    if (!(v > 0.0)) return 0.0;
    return v < kMaxInc ? v : kMaxInc;
}

/**
 * Add `height * residual(j - Z + d)` to every pending slot: a discontinuity of
 * `table`'s kind that happened `d` samples (0 <= d < 1) before the sample that
 * slot kZeroCrossings holds.
 */
inline void addResidual(const float (&table)[kSpan][kSegment], double height, double d) {
    const double posD = d * kOversample;
    int idx = static_cast<int>(posD);
    if (idx >= kOversample) idx = kOversample - 1;  // d rounded up to 1.0
    const float frac = static_cast<float>(posD - idx);
    const float hgt = static_cast<float>(height);
    for (int j = 0; j < kSpan; ++j) {
        const float a = table[j][idx];
        const float b = table[j][idx + 1];
        g.ring[(g.pos + j) & kRingMask] += hgt * (a + frac * (b - a));
    }
}

inline double naive(int shape, double p) {
    switch (shape) {
        case kShapeSqr: return p < 0.5 ? 1.0 : -1.0;
        case kShapeTri: return p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p;
        case kShapeSin: return std::sin(2.0 * kPi * p);
        default:        return 2.0 * p - 1.0;
    }
}

/** d(naive)/d(sample) at phase p for increment inc. */
inline double slope(int shape, double p, double inc) {
    switch (shape) {
        case kShapeSqr: return 0.0;
        case kShapeTri: return (p < 0.5 ? 4.0 : -4.0) * inc;
        case kShapeSin: return 2.0 * kPi * inc * std::cos(2.0 * kPi * p);
        default:        return 2.0 * inc;
    }
}

int render(int shape, int frames, bool perSampleFreq) {
    if (!g.ready) return 0;
    if (shape < kShapeSaw || shape > kShapeSin) shape = kShapeSaw;
    const int n = frames < 0 ? 0 : (frames > kMaxFrames ? kMaxFrames : frames);
    const double constInc = incFor(g.freq[0]);
    double p = g.phase;

    for (int i = 0; i < n; ++i) {
        const double inc = perSampleFreq ? incFor(g.freq[i]) : constInc;
        const double x = naive(shape, p);

        if (g.onset) {
            // Gate-open edge: silence -> x, with the wave's slope starting here.
            // Both corrections are referenced to this sample (d = 0).
            g.onset = false;
            addResidual(g.blep, x, 0.0);
            const double sl = slope(shape, p, inc);
            if (sl != 0.0) addResidual(g.blamp, sl, 0.0);
        }

        // This sample enters the delay line; the oldest one leaves it.
        g.ring[(g.pos + kZeroCrossings) & kRingMask] += static_cast<float>(x);
        g.out[i] = g.ring[g.pos];
        g.ring[g.pos] = 0.0f;
        g.pos = (g.pos + 1) & kRingMask;

        // Advance to the next sample. A crossing at phase c lands d = (q - c) /
        // inc before it; slots are now relative to that next sample.
        const double q = p + inc;
        if (inc > 0.0) {
            const double invInc = 1.0 / inc;
            switch (shape) {
                case kShapeSaw:
                    if (q >= 1.0) addResidual(g.blep, -2.0, (q - 1.0) * invInc);
                    break;
                case kShapeSqr:
                    if (p < 0.5 && q >= 0.5) addResidual(g.blep, -2.0, (q - 0.5) * invInc);
                    else if (q >= 1.0) addResidual(g.blep, 2.0, (q - 1.0) * invInc);
                    break;
                case kShapeTri:
                    // Slope change per sample at each corner: -8 inc, then +8 inc.
                    if (p < 0.5 && q >= 0.5) addResidual(g.blamp, -8.0 * inc, (q - 0.5) * invInc);
                    else if (q >= 1.0) addResidual(g.blamp, 8.0 * inc, (q - 1.0) * invInc);
                    break;
                default:
                    break;
            }
        }
        p = q >= 1.0 ? q - 1.0 : q;
    }
    g.phase = p;
    return n;
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int cosc_abi_version() { return kAbiVersion; }

EMSCRIPTEN_KEEPALIVE int cosc_max_frames() { return kMaxFrames; }

EMSCRIPTEN_KEEPALIVE int cosc_latency() { return kZeroCrossings; }

EMSCRIPTEN_KEEPALIVE float* cosc_freq_ptr() { return g.freq; }

EMSCRIPTEN_KEEPALIVE float* cosc_out_ptr() { return g.out; }

EMSCRIPTEN_KEEPALIVE int cosc_init(float sample_rate) {
    // The comparison is false for NaN, so NaN is rejected too.
    if (!(sample_rate >= kMinSampleRate && sample_rate <= kMaxSampleRate)) return 0;
    g.invSampleRate = 1.0 / static_cast<double>(sample_rate);
    if (!g.ready) buildTables();
    for (int j = 0; j < kRing; ++j) g.ring[j] = 0.0f;
    for (int i = 0; i < kMaxFrames; ++i) g.out[i] = 0.0f;
    g.pos = 0;
    g.phase = 0.0;
    g.onset = true;
    g.ready = true;
    return 1;
}

EMSCRIPTEN_KEEPALIVE void cosc_reset(float phase) {
    // Non-finite or negative input lands on 0 rather than poisoning state.
    double p = (std::isfinite(phase) && phase >= 0.0f) ? static_cast<double>(phase) : 0.0;
    p -= std::floor(p);
    g.phase = p >= 1.0 ? 0.0 : p;
    for (int j = 0; j < kRing; ++j) g.ring[j] = 0.0f;
    g.pos = 0;
    g.onset = true;
}

EMSCRIPTEN_KEEPALIVE int cosc_render(int shape, int frames, int per_sample_freq) {
    return render(shape, frames, per_sample_freq != 0);
}

}  // extern "C"
