/**
 * tb303_highfid_offline_test.cpp
 *
 * Phase-2 (#975) offline tests for the highfid-cpu diode-ladder reference.
 *
 * Checks:
 *   1. Engine id string is "highfid-cpu"
 *   2. Canonical pattern render is finite + deterministic
 *   3. 4× oversample stays finite
 *   4. Fuzzed param sweep (cutoff/res/env/accent/decay) never produces NaN
 *   5. Extreme resonance self-osc path stays finite
 *
 * Build + run (via run_offline_voices_test.sh or):
 *   g++ -std=c++17 -I emscripten/tests/emscripten_stub \
 *       emscripten/tests/tb303_highfid_offline_test.cpp -o /tmp/hf_test
 *   /tmp/hf_test
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "../highfid303_wrapper.cpp"

namespace {

constexpr float  SAMPLE_RATE = 44100.0f;
constexpr int    BLOCK       = 128;
constexpr int    STEP_BLOCKS = 52;
constexpr float  ACCENT_VEL  = 120.0f;
constexpr float  NORMAL_VEL  = 90.0f;

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
    { 36, true,  true  },
    { 39, false, false },
    { 43, true,  true  },
};

std::vector<float> renderCanonical(int oversample)
{
    uintptr_t h = highfid303_create();
    highfid303_init(h, SAMPLE_RATE, BLOCK);
    highfid303_set_oversample(h, oversample);

    highfid303_set_param(h, P_WAVEFORM,  0.0f);
    highfid303_set_param(h, P_CUTOFF,    0.35f);
    highfid303_set_param(h, P_RESONANCE, 0.70f);
    highfid303_set_param(h, P_ENVMOD,    0.55f);
    highfid303_set_param(h, P_DECAY,     0.50f);
    highfid303_set_param(h, P_ACCENT,    0.70f);
    highfid303_set_param(h, P_VOLUME,    0.80f);

    std::vector<float> out;
    out.reserve(sizeof(kPattern) / sizeof(kPattern[0]) * STEP_BLOCKS * BLOCK);
    float block[BLOCK];

    int prevNote = -1;
    for (const Step& s : kPattern) {
        if (!s.legato && prevNote >= 0) highfid303_note_off(h, prevNote);
        highfid303_note_on(h, s.note, s.accent ? ACCENT_VEL : NORMAL_VEL);
        prevNote = s.note;
        for (int b = 0; b < STEP_BLOCKS; ++b) {
            std::memset(block, 0, sizeof(block));
            highfid303_process(h, reinterpret_cast<uintptr_t>(block), BLOCK);
            out.insert(out.end(), block, block + BLOCK);
        }
    }
    highfid303_destroy(h);
    return out;
}

bool allFinite(const std::vector<float>& v)
{
    for (float x : v) if (!std::isfinite(x)) return false;
    return true;
}

double maxAbsDiff(const std::vector<float>& a, const std::vector<float>& b)
{
    double m = 0.0;
    const size_t n = std::min(a.size(), b.size());
    for (size_t i = 0; i < n; ++i) {
        m = std::max(m, std::fabs(static_cast<double>(a[i]) - b[i]));
    }
    return m;
}

int g_failures = 0;
void check(bool cond, const char* msg)
{
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", msg);
    if (!cond) ++g_failures;
}

}  // namespace

int main()
{
    std::printf("TB-303 highfid-cpu offline test (Phase-2)\n");
    std::printf("========================================\n");

    const char* id = highfid303_engine_id();
    check(id && std::strcmp(id, "highfid-cpu") == 0, "engine id is highfid-cpu");

    const std::vector<float> a = renderCanonical(1);
    const std::vector<float> b = renderCanonical(1);
    check(!a.empty(), "canonical render produced samples");
    check(allFinite(a), "canonical 1× output is finite");
    check(maxAbsDiff(a, b) == 0.0, "canonical 1× is deterministic");

    const std::vector<float> x4 = renderCanonical(4);
    check(x4.size() == a.size(), "4× oversample frame count matches 1×");
    check(allFinite(x4), "canonical 4× output is finite");

    // Fuzzed param sweep — every knob corner / mid grid
    {
        uintptr_t h = highfid303_create();
        highfid303_init(h, SAMPLE_RATE, BLOCK);
        highfid303_set_oversample(h, 2);
        float block[BLOCK];
        bool finite = true;
        const float grid[] = { 0.0f, 0.25f, 0.5f, 0.75f, 1.0f };
        for (float cut : grid) {
            for (float res : grid) {
                for (float env : grid) {
                    for (float dec : grid) {
                        highfid303_set_param(h, P_CUTOFF, cut);
                        highfid303_set_param(h, P_RESONANCE, res);
                        highfid303_set_param(h, P_ENVMOD, env);
                        highfid303_set_param(h, P_DECAY, dec);
                        highfid303_set_param(h, P_ACCENT, res);
                        highfid303_set_param(h, P_VOLUME, 0.8f);
                        highfid303_note_on(h, 36, ACCENT_VEL);
                        for (int b = 0; b < 4; ++b) {
                            std::memset(block, 0, sizeof(block));
                            highfid303_process(h, reinterpret_cast<uintptr_t>(block), BLOCK);
                            for (float x : block) if (!std::isfinite(x)) finite = false;
                        }
                        highfid303_note_off(h, 36);
                        highfid303_all_notes_off(h);
                    }
                }
            }
        }
        highfid303_destroy(h);
        check(finite, "fuzzed param sweep stays finite (no NaN)");
    }

    // Extreme resonance self-osc
    {
        uintptr_t h = highfid303_create();
        highfid303_init(h, SAMPLE_RATE, BLOCK);
        highfid303_set_param(h, P_CUTOFF, 0.9f);
        highfid303_set_param(h, P_RESONANCE, 1.0f);
        highfid303_set_param(h, P_ENVMOD, 1.0f);
        highfid303_set_param(h, P_VOLUME, 1.0f);
        highfid303_note_on(h, 60, ACCENT_VEL);
        float block[BLOCK];
        bool finite = true;
        for (int b = 0; b < 100; ++b) {
            highfid303_process(h, reinterpret_cast<uintptr_t>(block), BLOCK);
            for (float x : block) if (!std::isfinite(x)) finite = false;
        }
        highfid303_destroy(h);
        check(finite, "extreme resonance self-osc stays finite");
    }

    std::printf("\n%s (%d failure%s)\n",
                g_failures == 0 ? "ALL PASSED" : "FAILED",
                g_failures, g_failures == 1 ? "" : "s");
    return g_failures == 0 ? 0 : 1;
}
