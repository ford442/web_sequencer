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
//   * Sine is sin of the phase (no discontinuities, nothing to fix), as an f64
//     polynomial accurate to a few f64 ulps (`sinTurn`).
//   * Saw and square peak at ~1.17, not 1.0: that is the Gibbs overshoot every
//     properly band-limited edge has (a PolyBLEP's 2-sample residual is too
//     short to ring). A square so high that only its fundamental is left below
//     Nyquist is that sine, amplitude 4/pi ~ 1.27. Aliasing below 16 kHz measures ~-92 dB at 3.5 kHz, where
//     a naive saw is at -19 dB (src/__tests__/cppOscModule.test.ts).
//   * It is **SIMD, with a scalar twin** (#1667). Built with -msimd128 the
//     sample loop runs on `wasm_simd128.h` intrinsics (public/cpp_osc.wasm):
//     frequency -> phase increment in f64x2, the naive saw / square / triangle
//     in f64x2 narrowed to f32x4, every 32-tap BLEP / BLAMP correction as eight
//     f32x4 multiply-adds over a transposed table row, the output copy and the
//     delay-line shift in v128 moves, and the filter's two integrators as one
//     f64x2 state. The same source built without it (public/cpp_osc_scalar.wasm)
//     takes the scalar branch of every one of those helpers, operation for
//     operation, so the two builds produce the same samples (no -ffast-math, no
//     FMA: IEEE f32 / f64 in the same order). CppOscillator.ts loads the scalar
//     build only where WASM SIMD does not validate, and says so: a browser
//     without SIMD (where the Rust OSC cannot run) still gets this band-limited
//     live voice, so `cpp` stays right below `rust` in the backend fallback
//     order.
//   * It is **real-time safe**: no allocator, no exceptions, no imports, fixed
//     memory that never grows (build_cpp_osc.sh, wasm_memory_budget.json#cppOsc).
//     The residual tables are built once in cosc_init by trigonometric
//     recurrences — no libm calls in that loop — so creating a voice on the
//     audio thread costs ~0.1-0.3 ms once, well inside one render quantum.
//
// The oscillator itself is unfiltered, as for every basic-wave family: the
// voice's filter sits after it (src/engines/VoiceManager.ts). What the kernel
// adds is the **C++ filter** (#1673): a resonant LP / BP / HP filter (`Svf`,
// below) that is independent of the oscillator shape and of the oscillator
// *engine*. A second instance of this same module runs it as a streaming stage
// (src/audio-worklets/cpp-filter-processor.ts), so JS, WASM OSC, Rust, DWGS,
// WebGPU, Pyodide, WAV and `cpp-*` voices can all choose it as their filter
// (`SynthParams.filterSource === 'cpp'`).
//
//   * Topology: a trapezoidal-integrator ("TPT" / zero-delay-feedback) state
//     variable filter in double precision. It is the bilinear transform of the
//     same analog prototype the RBJ biquads of the WASM OSC and Rust filters
//     come from, prewarped at the cutoff, so its LP / BP / HP magnitude AND
//     phase equal theirs: switching source does not change the sound of a
//     static setting. What differs is modulation: the SVF's state is the two
//     integrators' charge, so a cutoff sweep moves the response without the
//     transients a direct-form biquad produces when its coefficients jump.
//   * Band-limited where that is a question at all: the filter is linear and
//     time-invariant per block, so it creates no new partials (nothing to
//     alias); the bilinear map keeps every pole inside the unit circle, and the
//     cutoff is clamped to [20 Hz, sample_rate / 2.1] (the other sources'
//     clamp) so tan() stays finite and the resonance peak stays below Nyquist.
//   * Module placement: here, in the standalone cpp_osc.wasm, NOT in
//     hyphon_native. One filter stage is one more instance of this 2-page
//     module per voice that selects it (wasm_memory_budget.json#cppOsc); it adds
//     4 KiB of buffer and 64 B of state to the statics and never touches the
//     voice module's heap. A filter node does not call cosc_init, so it never
//     builds the oscillator's residual tables.
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
//   cflt_buf_ptr()     -> float*       filter I/O buffer (filtered in place)
//   cflt_configure(sample_rate, cutoff, resonance, type) -> int   1 on success
//   cflt_reset()                       filter from rest
//   cflt_process(frames) -> int        frames filtered

#include <emscripten/emscripten.h>

#include <cmath>
#include <cstdint>

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#define COSC_SIMD 1
#else
#define COSC_SIMD 0
#endif

namespace {

constexpr int kAbiVersion = 2;

// A render quantum is 128 frames today; the headroom matches the Rust OSC so
// both worklets chunk the same way. Larger requests are split by the caller.
constexpr int kMaxFrames = 1024;

constexpr int kShapeSaw = 0;
constexpr int kShapeSqr = 1;
constexpr int kShapeTri = 2;
constexpr int kShapeSin = 3;

// Filter response ids: the numbering of `FilterType` in src/types/synth.ts,
// `FILTER_*` in assembly/biquad.ts and rust-audio/src/lib.rs.
constexpr int kFilterLp = 0;
constexpr int kFilterBp = 1;
constexpr int kFilterHp = 2;

// Residual half-width in samples. 16 zero crossings of a Blackman-Harris
// windowed sinc puts its transition band at roughly 0.375-0.625 fs, so what
// does alias folds back above 0.375 fs (18 kHz at 48 kHz) and is attenuated by
// the window's > 90 dB sidelobes everywhere else.
constexpr int kZeroCrossings = 16;
constexpr int kSpan = 2 * kZeroCrossings;  // taps per correction
static_assert(kSpan % 4 == 0, "a correction is a whole number of f32x4 lanes");
static_assert(kZeroCrossings % 4 == 0, "the naive wave lands on an f32x4 boundary");

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
    alignas(16) float freq[kMaxFrames];
    alignas(16) float out[kMaxFrames];
    // Linear delay line of corrections. At the start of a block, acc[j] is the
    // pending correction of output sample n0 - kZeroCrossings + j for j < kSpan
    // (and acc[j >= kSpan] is 0); a correction referenced to block sample i is
    // added at [i, i + kSpan). After the block the kSpan pending values move
    // back to the front. (Linear rather than a ring so every correction is
    // contiguous: eight f32x4 loads and stores.)
    alignas(16) float acc[kMaxFrames + kSpan];
    // The naive wave, delayed the same kZeroCrossings: block sample i is stored
    // at i + kZeroCrossings. Kept apart from `acc` and added once, at output, so
    // the corrections sum in strict time order and the f32 result does not
    // depend on where block boundaries fall.
    alignas(16) float naiveLine[kMaxFrames + kZeroCrossings];
    // Per-block scratch: phase increment (cycles / sample) and phase at each
    // sample, so the serial phase walk and the vector passes can be split.
    alignas(16) double inc[kMaxFrames];
    alignas(16) double phaseAt[kMaxFrames];
    // Band-limited step minus the ideal step. Transposed: row k holds point k
    // of every one-sample segment, so one correction reads two adjacent rows.
    alignas(16) float blep[kSegment][kSpan];
    // Its integral: band-limited ramp minus the ideal ramp, same layout.
    alignas(16) float blamp[kSegment][kSpan];
    double phase;       // cycles, always in [0, 1)
    double invSampleRate;
    bool onset;         // a gate-open edge is waiting to be band-limited
    bool ready;
};

Engine g;

// ── C++ filter (#1673) ──────────────────────────────────────────────────────

constexpr double kMinCutoff = 20.0;     // Hz
constexpr double kMinResonance = 0.1;   // Q
// State below this magnitude is flushed to zero (denormals cost real time on some CPUs).
constexpr double kDenormalFloor = 1.0e-30;

/**
 * Trapezoidal state variable filter (Zavalishin's TPT SVF, in the form
 * Simper published), f64 coefficients and state. With g = tan(pi fc / fs),
 * k = 1 / Q, a1 = 1 / (1 + g (g + k)), a2 = g a1, a3 = g a2, one sample is
 *
 *   v3 = v0 - ic2,  v1 = a1 ic1 + a2 v3,  v2 = ic2 + a2 ic1 + a3 v3
 *   ic1 <- 2 v1 - ic1,  ic2 <- 2 v2 - ic2
 *   LP  v2              = H(s) 1     / (s^2 + k s + 1)
 *   BP  k v1            = H(s) k s   / (s^2 + k s + 1)   constant 0 dB peak
 *   HP  v0 - k v1 - v2  = H(s) s^2   / (s^2 + k s + 1)
 *
 * mapped by the bilinear transform prewarped at fc: the RBJ cookbook's LP,
 * constant-0-dB-peak BP and HP. (f32 is not enough: g at 20 Hz / 48 kHz is
 * 1.3e-3 and the integrators would drift, as an f32 direct-form biquad does.)
 *
 * The same recurrence is run in its state-space form, x = [ic1, ic2]:
 *
 *   x <- A x + B u,   y = C x + D u
 *   A = [[2 a1 - 1, -2 a2], [2 a2, 1 - 2 a3]],  B = [2 a2, 2 a3]
 *   C, D per response (expanding the outputs above in ic1, ic2, v0)
 *
 * and two samples per step (#1667): x <- A^2 x + A B u0 + B u1, and
 * [y0, y1] = [C; C A] x + [D; C B] u0 + [0; D] u1. That is one f64x2 state
 * update and one f64x2 output per pair, and the recurrence the next pair waits
 * on is one step deep instead of two. It is the same linear map, in f64 (the
 * products are re-associated, ~1e-16 relative: below one f32 ulp of the
 * output). The integrators keep their meaning, so a coefficient change
 * mid-sweep still leaves the state alone. The scalar build evaluates the same
 * sums in the same order lane by lane, so the two builds agree to the bit.
 */
struct Svf {
    // Pair-step matrices, as f64x2 columns (lane 0, lane 1).
    double p0[2], p1[2];   // A^2 columns: state update from ic1, ic2
    double q0[2], q1[2];   // A B, B: state update from u0, u1
    double r0[2], r1[2];   // [C; C A] columns: outputs from ic1, ic2
    double s0[2], s1[2];   // [D; C B], [0; D]: outputs from u0, u1
    // Single step (odd tail): A, B, C, D.
    double a11, a12, a21, a22, b1, b2, c1, c2, d;
    double ic1 = 0.0, ic2 = 0.0;   // integrator states
    bool configured = false;       // false = identity (see cflt_process)

    /**
     * Set the response, leaving the integrators alone so a sweep is smooth.
     * Returns false and keeps the previous response for a non-finite value, a
     * rate outside the module's range, or an unknown type. Never traps.
     */
    bool configure(double sampleRate, double cutoff, double resonance, int kind) {
        const bool rateOk = sampleRate >= kMinSampleRate && sampleRate <= kMaxSampleRate;
        if (!rateOk || !std::isfinite(cutoff) || !std::isfinite(resonance)) return false;
        if (kind < kFilterLp || kind > kFilterHp) return false;
        double fc = cutoff < sampleRate / 2.1 ? cutoff : sampleRate / 2.1;
        if (fc < kMinCutoff) fc = kMinCutoff;
        const double q = resonance > kMinResonance ? resonance : kMinResonance;
        const double g = std::tan(kPi * fc / sampleRate);
        const double k = 1.0 / q;
        const double a1 = 1.0 / (1.0 + g * (g + k));
        const double a2 = g * a1;
        const double a3 = g * a2;

        a11 = 2.0 * a1 - 1.0;
        a12 = -2.0 * a2;
        a21 = 2.0 * a2;
        a22 = 1.0 - 2.0 * a3;
        b1 = 2.0 * a2;
        b2 = 2.0 * a3;
        switch (kind) {
            case kFilterBp:   // k v1
                c1 = k * a1;
                c2 = -k * a2;
                d = k * a2;
                break;
            case kFilterHp:   // v0 - k v1 - v2
                c1 = -(k * a1 + a2);
                c2 = k * a2 - (1.0 - a3);
                d = 1.0 - k * a2 - a3;
                break;
            default:          // v2
                c1 = a2;
                c2 = 1.0 - a3;
                d = a3;
                break;
        }
        // A^2 = A A.
        p0[0] = a11 * a11 + a12 * a21;
        p0[1] = a21 * a11 + a22 * a21;
        p1[0] = a11 * a12 + a12 * a22;
        p1[1] = a21 * a12 + a22 * a22;
        q0[0] = a11 * b1 + a12 * b2;   // A B
        q0[1] = a21 * b1 + a22 * b2;
        q1[0] = b1;
        q1[1] = b2;
        r0[0] = c1;
        r0[1] = c1 * a11 + c2 * a21;   // C A
        r1[0] = c2;
        r1[1] = c1 * a12 + c2 * a22;
        s0[0] = d;
        s0[1] = c1 * b1 + c2 * b2;     // C B
        s1[0] = 0.0;
        s1[1] = d;
        configured = true;
        return true;
    }

    void reset() {
        ic1 = 0.0;
        ic2 = 0.0;
    }

    /** One sample: y = C x + D u, x <- A x + B u. */
    inline float step(float in) {
        const double u = static_cast<double>(in);
        const double y = c1 * ic1 + c2 * ic2 + d * u;
        const double n1 = a11 * ic1 + a12 * ic2 + b1 * u;
        const double n2 = a21 * ic1 + a22 * ic2 + b2 * u;
        ic1 = n1;
        ic2 = n2;
        return static_cast<float>(y);
    }

    /** Filter buf[0, n) in place: pairs, then at most one single step. */
    void process(float* buf, int n) {
        int i = 0;
#if COSC_SIMD
        const v128_t P0 = wasm_v128_load(p0), P1 = wasm_v128_load(p1);
        const v128_t Q0 = wasm_v128_load(q0), Q1 = wasm_v128_load(q1);
        const v128_t R0 = wasm_v128_load(r0), R1 = wasm_v128_load(r1);
        const v128_t S0 = wasm_v128_load(s0), S1 = wasm_v128_load(s1);
        v128_t x = wasm_f64x2_make(ic1, ic2);
        for (; i + 2 <= n; i += 2) {
            const v128_t u = wasm_f64x2_promote_low_f32x4(wasm_v128_load64_zero(buf + i));
            const v128_t u0 = wasm_i64x2_shuffle(u, u, 0, 0);
            const v128_t u1 = wasm_i64x2_shuffle(u, u, 1, 1);
            const v128_t x1 = wasm_i64x2_shuffle(x, x, 0, 0);
            const v128_t x2 = wasm_i64x2_shuffle(x, x, 1, 1);
            const v128_t y = wasm_f64x2_add(
                wasm_f64x2_add(wasm_f64x2_add(wasm_f64x2_mul(R0, x1), wasm_f64x2_mul(R1, x2)),
                               wasm_f64x2_mul(S0, u0)),
                wasm_f64x2_mul(S1, u1));
            x = wasm_f64x2_add(
                wasm_f64x2_add(wasm_f64x2_add(wasm_f64x2_mul(P0, x1), wasm_f64x2_mul(P1, x2)),
                               wasm_f64x2_mul(Q0, u0)),
                wasm_f64x2_mul(Q1, u1));
            wasm_v128_store64_lane(buf + i, wasm_f32x4_demote_f64x2_zero(y), 0);
        }
        ic1 = wasm_f64x2_extract_lane(x, 0);
        ic2 = wasm_f64x2_extract_lane(x, 1);
#else
        for (; i + 2 <= n; i += 2) {
            const double u0 = static_cast<double>(buf[i]);
            const double u1 = static_cast<double>(buf[i + 1]);
            const double x1 = ic1, x2 = ic2;
            const double y0 = ((r0[0] * x1 + r1[0] * x2) + s0[0] * u0) + s1[0] * u1;
            const double y1 = ((r0[1] * x1 + r1[1] * x2) + s0[1] * u0) + s1[1] * u1;
            ic1 = ((p0[0] * x1 + p1[0] * x2) + q0[0] * u0) + q1[0] * u1;
            ic2 = ((p0[1] * x1 + p1[1] * x2) + q0[1] * u0) + q1[1] * u1;
            buf[i] = static_cast<float>(y0);
            buf[i + 1] = static_cast<float>(y1);
        }
#endif
        if (i < n) buf[i] = step(buf[i]);
    }

    /** Once per block: a silent input must not leave the state decaying into denormals. */
    void flushDenormals() {
        if (std::fabs(ic1) < kDenormalFloor) ic1 = 0.0;
        if (std::fabs(ic2) < kDenormalFloor) ic2 = 0.0;
    }
};

// Separate from `g`: a filter instance never renders, an oscillator instance
// never filters, and neither may disturb the other's buffers.
alignas(16) float gFilterBuf[kMaxFrames];
Svf gFilter;

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
 * Fill g.blep / g.blamp (transposed: [point][segment]). Simpson's rule on the table grid (midpoints from a
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
            g.blep[k][seg] = static_cast<float>(S - H);
            g.blamp[k][seg] = static_cast<float>(I - ramp);
        }
        // ...and the left-hand limit at the end of the previous one, which
        // differs from it only at tau = 0 (the step itself).
        if (k == 0 && seg > 0) {
            const double Hl = (tau > 0.0) ? 1.0 : 0.0;
            g.blep[kOversample][seg - 1] = static_cast<float>(S - Hl);
            g.blamp[kOversample][seg - 1] = static_cast<float>(I - ramp);
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
    g.blep[kOversample][kSpan - 1] = 0.0f;
    g.blamp[kOversample][kSpan - 1] = 0.0f;
}

/**
 * Add `height * residual(j - Z + d)` to acc[base + j], j in [0, kSpan): a
 * discontinuity of `table`'s kind that happened `d` samples (0 <= d < 1)
 * before the sample acc[base + kZeroCrossings] holds.
 */
inline void addResidual(const float (&table)[kSegment][kSpan], double height, double d, int base) {
    const double posD = d * kOversample;
    int idx = static_cast<int>(posD);
    if (idx >= kOversample) idx = kOversample - 1;  // d rounded up to 1.0
    const float frac = static_cast<float>(posD - idx);
    const float hgt = static_cast<float>(height);
    const float* a = table[idx];
    const float* b = table[idx + 1];
    float* dst = g.acc + base;
#if COSC_SIMD
    const v128_t vf = wasm_f32x4_splat(frac);
    const v128_t vh = wasm_f32x4_splat(hgt);
    for (int j = 0; j < kSpan; j += 4) {
        const v128_t va = wasm_v128_load(a + j);
        const v128_t vb = wasm_v128_load(b + j);
        const v128_t r = wasm_f32x4_mul(vh, wasm_f32x4_add(va, wasm_f32x4_mul(vf, wasm_f32x4_sub(vb, va))));
        wasm_v128_store(dst + j, wasm_f32x4_add(wasm_v128_load(dst + j), r));
    }
#else
    for (int j = 0; j < kSpan; ++j) {
        dst[j] += hgt * (a[j] + frac * (b[j] - a[j]));
    }
#endif
}

inline double incFor(float hz) {
    const double v = static_cast<double>(hz) * g.invSampleRate;
    // `!(v > 0)` is also true for NaN, so NaN Hz becomes 0 instead of
    // poisoning the phase.
    if (!(v > 0.0)) return 0.0;
    return v < kMaxInc ? v : kMaxInc;
}

/** g.inc[0, n) from g.freq: incFor per frame, two frames per f64x2. */
void fillIncrements(int n) {
    int i = 0;
#if COSC_SIMD
    const v128_t rate = wasm_f64x2_splat(g.invSampleRate);
    const v128_t zero = wasm_f64x2_splat(0.0);
    const v128_t maxInc = wasm_f64x2_splat(kMaxInc);
    for (; i + 2 <= n; i += 2) {
        const v128_t hz = wasm_f64x2_promote_low_f32x4(wasm_v128_load64_zero(g.freq + i));
        v128_t v = wasm_f64x2_mul(hz, rate);
        // v > 0 is false for NaN and both zeros: those lanes become +0.
        v = wasm_v128_and(v, wasm_f64x2_gt(v, zero));
        // pmin(max, v) = v < max ? v : max, the scalar clamp exactly.
        wasm_v128_store(g.inc + i, wasm_f64x2_pmin(maxInc, v));
    }
#endif
    for (; i < n; ++i) g.inc[i] = incFor(g.freq[i]);
}

// sin(2 pi t) for |t| <= 1/4: its Taylor series in t through t^23, Horner in
// t^2. The first omitted term is < 2e-18 at t = 1/4 and the evaluation's own
// rounding a few f64 ulps (~4e-16), so after the f32 store it is libm sin in
// practice (src/__tests__/cppOscModule.test.ts measures it). A polynomial
// rather than libm so the SIMD build can run it in f64x2 and the scalar build
// the same operations in the same order (#1667).
constexpr double kSinC[12] = {
    6.283185307179586,      -41.34170224039976,     81.60524927607506,
    -76.70585975306139,     42.058693944897655,     -15.09464257682299,
    3.819952584848282,      -0.7181223017785006,    0.10422916220813984,
    -0.012031585942120627,  0.0011309237482517963,  -8.823533599243006e-05,
};

/**
 * sin(2 pi p) for p in [0, 1). The fold to [-1/4, 1/4] is exact (Sterbenz):
 * 0.5 - p for p in [1/4, 3/4), p - 1 above.
 */
inline double sinTurn(double p) {
    const double t = p >= 0.75 ? p - 1.0 : (p >= 0.25 ? 0.5 - p : p);
    const double t2 = t * t;
    double acc = kSinC[11];
    for (int k = 10; k >= 0; --k) acc = acc * t2 + kSinC[k];
    return t * acc;
}

inline double naive(int shape, double p) {
    switch (shape) {
        case kShapeSqr: return p < 0.5 ? 1.0 : -1.0;
        case kShapeTri: return p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p;
        case kShapeSin: return sinTurn(p);
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

#if COSC_SIMD
/** naive() of two phases, for the shapes that are arithmetic (not sine). */
template <int Shape>
inline v128_t naive2(v128_t p) {
    const v128_t half = wasm_f64x2_splat(0.5);
    const v128_t one = wasm_f64x2_splat(1.0);
    if (Shape == kShapeSqr) {
        // (p < 0.5 ? 2 : 0) - 1: exactly +1 / -1.
        const v128_t two = wasm_f64x2_splat(2.0);
        return wasm_f64x2_sub(wasm_v128_and(two, wasm_f64x2_lt(p, half)), one);
    }
    if (Shape == kShapeTri) {
        const v128_t four = wasm_f64x2_splat(4.0);
        const v128_t p4 = wasm_f64x2_mul(four, p);
        const v128_t rise = wasm_f64x2_sub(p4, one);
        const v128_t fall = wasm_f64x2_sub(wasm_f64x2_splat(3.0), p4);
        return wasm_v128_bitselect(rise, fall, wasm_f64x2_lt(p, half));
    }
    if (Shape == kShapeSin) {
        // sinTurn, two lanes: the same fold, the same Horner steps.
        const v128_t t = wasm_v128_bitselect(
            wasm_f64x2_sub(p, one),
            wasm_v128_bitselect(wasm_f64x2_sub(half, p), p, wasm_f64x2_ge(p, wasm_f64x2_splat(0.25))),
            wasm_f64x2_ge(p, wasm_f64x2_splat(0.75)));
        const v128_t t2 = wasm_f64x2_mul(t, t);
        v128_t acc = wasm_f64x2_splat(kSinC[11]);
        for (int k = 10; k >= 0; --k) acc = wasm_f64x2_add(wasm_f64x2_mul(acc, t2), wasm_f64x2_splat(kSinC[k]));
        return wasm_f64x2_mul(t, acc);
    }
    return wasm_f64x2_sub(wasm_f64x2_add(p, p), one);  // 2p - 1 (2p is exact)
}
#endif

/** naiveLine[i + Z] = naive(phaseAt[i]) for i in [0, n). */
template <int Shape>
void storeNaive(int n) {
    float* dst = g.naiveLine + kZeroCrossings;
    int i = 0;
#if COSC_SIMD
    for (; i + 4 <= n; i += 4) {
        const v128_t lo = wasm_f32x4_demote_f64x2_zero(naive2<Shape>(wasm_v128_load(g.phaseAt + i)));
        const v128_t hi = wasm_f32x4_demote_f64x2_zero(naive2<Shape>(wasm_v128_load(g.phaseAt + i + 2)));
        wasm_v128_store(dst + i, wasm_i32x4_shuffle(lo, hi, 0, 1, 4, 5));
    }
#endif
    for (; i < n; ++i) dst[i] = static_cast<float>(naive(Shape, g.phaseAt[i]));
}

/**
 * out[0, n) = naiveLine[0, n) + acc[0, n); the pending naive values and
 * corrections move to the front.
 */
void drain(int n) {
    int i = 0;
#if COSC_SIMD
    for (; i + 4 <= n; i += 4) {
        wasm_v128_store(g.out + i, wasm_f32x4_add(wasm_v128_load(g.naiveLine + i), wasm_v128_load(g.acc + i)));
    }
#endif
    for (; i < n; ++i) g.out[i] = g.naiveLine[i] + g.acc[i];
    if (n == 0) return;
    // Forward copies x[n + j] -> x[j]: the destination is always behind the
    // source, so this is safe even when the two ranges overlap (n < the
    // length), four lanes at a time included (a store never reaches a lane
    // still unread).
#if COSC_SIMD
    for (int j = 0; j < kZeroCrossings; j += 4) {
        wasm_v128_store(g.naiveLine + j, wasm_v128_load(g.naiveLine + n + j));
    }
    for (int j = 0; j < kSpan; j += 4) wasm_v128_store(g.acc + j, wasm_v128_load(g.acc + n + j));
    const v128_t zero = wasm_f32x4_splat(0.0f);
    int z = kSpan;
    for (; z + 4 <= n + kSpan; z += 4) wasm_v128_store(g.acc + z, zero);
    for (; z < n + kSpan; ++z) g.acc[z] = 0.0f;
#else
    for (int j = 0; j < kZeroCrossings; ++j) g.naiveLine[j] = g.naiveLine[n + j];
    for (int j = 0; j < kSpan; ++j) g.acc[j] = g.acc[n + j];
    for (int z = kSpan; z < n + kSpan; ++z) g.acc[z] = 0.0f;
#endif
}

/**
 * The serial part: walk the phase, record it per sample, and add the
 * corrections for the onset and for every edge crossed. The corrections are
 * the vector work (addResidual); the walk itself is a prefix sum.
 */
template <int Shape>
void walk(int n, bool perSampleFreq, double constInc) {
    double p = g.phase;
    for (int i = 0; i < n; ++i) {
        const double inc = perSampleFreq ? g.inc[i] : constInc;
        g.phaseAt[i] = p;

        if (g.onset) {
            // Gate-open edge: silence -> x, with the wave's slope starting here.
            // Both corrections are referenced to this sample (d = 0).
            g.onset = false;
            addResidual(g.blep, naive(Shape, p), 0.0, i);
            const double sl = slope(Shape, p, inc);
            if (sl != 0.0) addResidual(g.blamp, sl, 0.0, i);
        }

        // Advance to the next sample. A crossing at phase c lands d = (q - c) /
        // inc before it, so its correction is referenced to sample i + 1.
        const double q = p + inc;
        if (inc > 0.0) {
            if (Shape == kShapeSaw) {
                if (q >= 1.0) addResidual(g.blep, -2.0, (q - 1.0) * (1.0 / inc), i + 1);
            } else if (Shape == kShapeSqr) {
                if (p < 0.5 && q >= 0.5) addResidual(g.blep, -2.0, (q - 0.5) * (1.0 / inc), i + 1);
                else if (q >= 1.0) addResidual(g.blep, 2.0, (q - 1.0) * (1.0 / inc), i + 1);
            } else if (Shape == kShapeTri) {
                // Slope change per sample at each corner: -8 inc, then +8 inc.
                if (p < 0.5 && q >= 0.5) addResidual(g.blamp, -8.0 * inc, (q - 0.5) * (1.0 / inc), i + 1);
                else if (q >= 1.0) addResidual(g.blamp, 8.0 * inc, (q - 1.0) * (1.0 / inc), i + 1);
            }
        }
        p = q >= 1.0 ? q - 1.0 : q;
    }
    g.phase = p;
}

template <int Shape>
void renderShape(int n, bool perSampleFreq) {
    const double constInc = incFor(g.freq[0]);
    if (perSampleFreq) fillIncrements(n);
    walk<Shape>(n, perSampleFreq, constInc);
    storeNaive<Shape>(n);
    drain(n);
}

int render(int shape, int frames, bool perSampleFreq) {
    if (!g.ready) return 0;
    const int n = frames < 0 ? 0 : (frames > kMaxFrames ? kMaxFrames : frames);
    switch (shape) {
        case kShapeSqr: renderShape<kShapeSqr>(n, perSampleFreq); break;
        case kShapeTri: renderShape<kShapeTri>(n, perSampleFreq); break;
        case kShapeSin: renderShape<kShapeSin>(n, perSampleFreq); break;
        default:        renderShape<kShapeSaw>(n, perSampleFreq); break;
    }
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
    for (int j = 0; j < kMaxFrames + kSpan; ++j) g.acc[j] = 0.0f;
    for (int j = 0; j < kZeroCrossings; ++j) g.naiveLine[j] = 0.0f;
    for (int i = 0; i < kMaxFrames; ++i) g.out[i] = 0.0f;
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
    // Only the pending fronts are ever read before being written.
    for (int j = 0; j < kSpan; ++j) g.acc[j] = 0.0f;
    for (int j = 0; j < kZeroCrossings; ++j) g.naiveLine[j] = 0.0f;
    g.onset = true;
}

EMSCRIPTEN_KEEPALIVE int cosc_render(int shape, int frames, int per_sample_freq) {
    return render(shape, frames, per_sample_freq != 0);
}

EMSCRIPTEN_KEEPALIVE float* cflt_buf_ptr() { return gFilterBuf; }

EMSCRIPTEN_KEEPALIVE int cflt_configure(float sample_rate, float cutoff, float resonance, int type) {
    return gFilter.configure(static_cast<double>(sample_rate), static_cast<double>(cutoff),
                             static_cast<double>(resonance), type) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE void cflt_reset() { gFilter.reset(); }

EMSCRIPTEN_KEEPALIVE int cflt_process(int frames) {
    const int n = frames < 0 ? 0 : (frames > kMaxFrames ? kMaxFrames : frames);
    // Never configured: pass through (the worklet refuses to run before the
    // first successful cflt_configure, so this is only a safe default).
    if (!gFilter.configured) return n;
    gFilter.process(gFilterBuf, n);
    gFilter.flushDenormals();
    return n;
}

}  // extern "C"
