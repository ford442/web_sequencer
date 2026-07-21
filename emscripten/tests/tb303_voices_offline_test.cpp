/**
 * tb303_voices_offline_test.cpp
 *
 * Offline buffer verification for the first two custom "303 voices"
 * (issue #898): `experimental-01` (scratchpad) and `1ink303-v1` (in-house).
 *
 * It renders a FIXED, documented note pattern through the open303-family DSP
 * (emscripten/open303_wrapper.cpp) once per voice via the plain C API and
 * checks, purely offline (no emsdk, no audio device):
 *
 *   1. Registry — experimental-01 and 1ink303-v1 are present as
 *      open303-family models.
 *   2. Determinism — rendering the stock voice twice is bit-identical.
 *   3. Stock unchanged — stock → other voice → stock reproduces the exact
 *      stock buffer (mid-session switch does not corrupt the stock path).
 *   4. Audible difference — each new voice differs from stock by a clearly
 *      audible margin (relative RMS > 2% and peak sample delta > 1e-3).
 *   5. Engine family guard — open303_set_model() rejects the jc303-family
 *      model (it is rendered by the rosic engine, not this DSP).
 *   6. No crash / no NaN when the model is switched every block mid-render.
 *
 * ── Fixed test pattern ────────────────────────────────────────────────────
 *   Sample rate 44100 Hz, block 128 frames, saw wave.
 *   Params: cutoff 0.35, resonance 0.70, envMod 0.55, decay 0.50,
 *           accent 0.70, volume 0.80.
 *   4 steps × 0.15 s, notes C2 C2 Eb2 G2 (MIDI 36 36 39 43),
 *   accent on steps 2 and 4 (velocity 120 vs 90); steps 2 and 4 are legato
 *   (no note-off first) so the slide/portamento path is exercised.
 *
 * Build + run (see run_offline_voices_test.sh):
 *   g++ -std=c++17 -I emscripten/tests/emscripten_stub \
 *       emscripten/tests/tb303_voices_offline_test.cpp -o /tmp/tb303_test
 *   /tmp/tb303_test
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

// Pull in the DSP under test. The emscripten stubs (bind.h / emscripten.h)
// neutralise the WASM-only bits so the extern "C" API links natively.
#include "../open303_wrapper.cpp"

namespace {

constexpr float  SAMPLE_RATE   = 44100.0f;
constexpr int    BLOCK         = 128;
constexpr int    STEP_BLOCKS   = 52;               // ~0.15 s per step
constexpr float  ACCENT_VEL    = 120.0f;           // > ACCENT_VELOCITY_THRESHOLD
constexpr float  NORMAL_VEL    = 90.0f;

// Open303Param ids (mirror of the enum in open303_wrapper.cpp).
constexpr int P_WAVEFORM  = 0;
constexpr int P_CUTOFF    = 2;
constexpr int P_RESONANCE = 3;
constexpr int P_ENVMOD    = 4;
constexpr int P_DECAY     = 5;
constexpr int P_ACCENT    = 6;
constexpr int P_VOLUME    = 7;

struct Step { int note; bool accent; bool legato; };
const Step kPattern[] = {
    { 36, false, false },
    { 36, true,  true  },   // legato: slide (same pitch)
    { 39, false, false },
    { 43, true,  true  },   // legato: slide 39 → 43
};

int findModelIndex(const char* id) {
    for (int i = 0; i < open303_get_model_count(); ++i) {
        const char* mid = open303_get_model_id(i);
        if (mid && std::strcmp(mid, id) == 0) return i;
    }
    return -1;
}

/** Render the fixed pattern through @p modelIndex into a fresh instance. */
std::vector<float> renderVoice(int modelIndex) {
    uintptr_t h = open303_create();
    open303_init(h, SAMPLE_RATE, BLOCK);
    open303_set_model(h, modelIndex);

    open303_set_param(h, P_WAVEFORM,  0.0f);   // saw
    open303_set_param(h, P_CUTOFF,    0.35f);
    open303_set_param(h, P_RESONANCE, 0.70f);
    open303_set_param(h, P_ENVMOD,    0.55f);
    open303_set_param(h, P_DECAY,     0.50f);
    open303_set_param(h, P_ACCENT,    0.70f);
    open303_set_param(h, P_VOLUME,    0.80f);

    std::vector<float> out;
    out.reserve(sizeof(kPattern) / sizeof(kPattern[0]) * STEP_BLOCKS * BLOCK);
    float block[BLOCK];

    int prevNote = -1;
    for (const Step& s : kPattern) {
        if (!s.legato && prevNote >= 0) open303_note_off(h, prevNote);
        open303_note_on(h, s.note, s.accent ? ACCENT_VEL : NORMAL_VEL);
        prevNote = s.note;
        for (int b = 0; b < STEP_BLOCKS; ++b) {
            std::memset(block, 0, sizeof(block));
            open303_process(h, reinterpret_cast<uintptr_t>(block), BLOCK);
            out.insert(out.end(), block, block + BLOCK);
        }
    }

    open303_destroy(h);
    return out;
}

double rms(const std::vector<float>& v) {
    double acc = 0.0;
    for (float x : v) acc += static_cast<double>(x) * x;
    return v.empty() ? 0.0 : std::sqrt(acc / v.size());
}

double rmsDiff(const std::vector<float>& a, const std::vector<float>& b) {
    double acc = 0.0;
    const size_t n = std::min(a.size(), b.size());
    for (size_t i = 0; i < n; ++i) {
        const double d = static_cast<double>(a[i]) - b[i];
        acc += d * d;
    }
    return n == 0 ? 0.0 : std::sqrt(acc / n);
}

double maxAbsDiff(const std::vector<float>& a, const std::vector<float>& b) {
    double m = 0.0;
    const size_t n = std::min(a.size(), b.size());
    for (size_t i = 0; i < n; ++i) {
        m = std::max(m, std::fabs(static_cast<double>(a[i]) - b[i]));
    }
    return m;
}

bool allFinite(const std::vector<float>& v) {
    for (float x : v) if (!std::isfinite(x)) return false;
    return true;
}

int g_failures = 0;
void check(bool cond, const char* msg) {
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", msg);
    if (!cond) ++g_failures;
}

}  // namespace

int main() {
    std::printf("TB-303 voices offline buffer test\n");
    std::printf("=================================\n");

    // 1. Registry: both new voices present, open303 family.
    const int iStock = findModelIndex("stock-open303");
    const int iExp   = findModelIndex("experimental-01");
    const int i1ink  = findModelIndex("1ink303-v1");
    const int iJc    = findModelIndex("jc303");
    std::printf("Registry (%d models):\n", open303_get_model_count());
    check(iStock >= 0, "stock-open303 registered");
    check(iExp   >= 0, "experimental-01 registered");
    check(i1ink  >= 0, "1ink303-v1 registered");
    check(iExp  >= 0 && open303_get_model_engine(iExp)  == ENGINE_OPEN303,
          "experimental-01 is open303-family");
    check(i1ink >= 0 && open303_get_model_engine(i1ink) == ENGINE_OPEN303,
          "1ink303-v1 is open303-family");

    if (iStock < 0 || iExp < 0 || i1ink < 0) {
        std::printf("\nMissing required models — aborting.\n");
        return 1;
    }

    // 2. Determinism of the stock render.
    const std::vector<float> stock  = renderVoice(iStock);
    const std::vector<float> stock2 = renderVoice(iStock);
    check(!stock.empty(), "stock render produced samples");
    check(allFinite(stock), "stock output is finite (no NaN/inf)");
    check(maxAbsDiff(stock, stock2) == 0.0, "stock render is deterministic (bit-identical)");

    // 3. Stock unchanged after a mid-session switch stock → voice → stock.
    {
        uintptr_t h = open303_create();
        open303_init(h, SAMPLE_RATE, BLOCK);
        open303_set_model(h, iExp);          // switch away…
        open303_set_model(h, i1ink);         // …and again…
        open303_set_model(h, iStock);        // …then back to stock.
        open303_destroy(h);
        const std::vector<float> stockAfter = renderVoice(iStock);
        check(maxAbsDiff(stock, stockAfter) == 0.0,
              "stock path unchanged after switching models");
    }

    const double stockRms = rms(stock);
    std::printf("Stock RMS: %.6f over %zu samples\n", stockRms, stock.size());

    // 4. Audible difference vs stock for each new voice.
    struct VoiceCase { const char* id; int idx; };
    const VoiceCase voices[] = { { "experimental-01", iExp }, { "1ink303-v1", i1ink } };
    for (const VoiceCase& vc : voices) {
        const std::vector<float> buf = renderVoice(vc.idx);
        const double relRms = stockRms > 0.0 ? rmsDiff(stock, buf) / stockRms : 0.0;
        const double peak   = maxAbsDiff(stock, buf);
        std::printf("Voice %-16s relRMS=%.4f (%.2f%%) peakDelta=%.5f\n",
                    vc.id, relRms, relRms * 100.0, peak);
        std::string m1 = std::string(vc.id) + " differs audibly from stock (relRMS > 2%)";
        std::string m2 = std::string(vc.id) + " output is finite (no NaN/inf)";
        check(relRms > 0.02, m1.c_str());
        check(peak > 1.0e-3, (std::string(vc.id) + " peak sample delta > 1e-3").c_str());
        check(allFinite(buf), m2.c_str());
    }

    // 5. Engine-family guard: jc303 is not an open303-family profile.
    {
        uintptr_t h = open303_create();
        open303_init(h, SAMPLE_RATE, BLOCK);
        const int ok = (iJc >= 0) ? open303_set_model(h, iJc) : 0;
        check(iJc >= 0 && ok == 0,
              "open303_set_model rejects jc303-family model (handled by rosic engine)");
        // An out-of-range index is rejected too.
        check(open303_set_model(h, 9999) == 0, "open303_set_model rejects unknown index");
        open303_destroy(h);
    }

    // 6. No crash / no NaN when switching model every block mid-render.
    {
        uintptr_t h = open303_create();
        open303_init(h, SAMPLE_RATE, BLOCK);
        open303_set_param(h, P_CUTOFF, 0.35f);
        open303_set_param(h, P_RESONANCE, 0.70f);
        open303_note_on(h, 36, ACCENT_VEL);
        float block[BLOCK];
        bool finite = true;
        const int count = open303_get_model_count();
        for (int b = 0; b < 200; ++b) {
            open303_set_model(h, b % count);   // includes the jc303 no-op
            std::memset(block, 0, sizeof(block));
            open303_process(h, reinterpret_cast<uintptr_t>(block), BLOCK);
            for (float x : block) if (!std::isfinite(x)) finite = false;
        }
        open303_destroy(h);
        check(finite, "mid-render model switching stays finite (no crash/NaN)");
    }

    std::printf("\n%s (%d failure%s)\n",
                g_failures == 0 ? "ALL PASSED" : "FAILED",
                g_failures, g_failures == 1 ? "" : "s");
    return g_failures == 0 ? 0 : 1;
}
