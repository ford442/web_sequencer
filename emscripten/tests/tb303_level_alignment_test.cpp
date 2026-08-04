/**
 * tb303_level_alignment_test.cpp
 *
 * Output-level alignment gate for the realtime-selectable 303 voices.
 *
 * Every realtime 303 voice (the open303 model family + the authentic rosic
 * jc303 engine) must treat LEVEL (P_VOLUME, 0-1) as a *linear* amplitude
 * control and land on the same reference level, so switching voices at a fixed
 * track LEVEL does not change how loud the track sits in the mix.
 *
 * This guards the regression fixed alongside it: jc303 used to map LEVEL onto
 * rosic's master level in *decibels* (linToLin(v, 0, 1, -60, 0)), leaving it
 * 14-18 dB below every other oscillator at the default track LEVELs (0.40-0.50)
 * while overshooting to +7.9 dBFS — hard clipping — at LEVEL=1.0. The linear and
 * dB laws happen to cross near LEVEL≈0.80, which is exactly where the canonical
 * baselines in docs/audio-engine/303-baseline/ are rendered, so the mismatch was
 * invisible there. Sweeping LEVEL is what makes it visible.
 *
 * highfid-cpu is deliberately not covered: it is an offline-only reference
 * engine (no AudioWorklet path), so it never participates in the realtime mix.
 * See docs/audio-engine/303-voices.md for its known level offset.
 *
 * Build: bash emscripten/tests/run_offline_voices_test.sh
 *        (requires the jc303_wasm submodule for the rosic sources)
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "../open303_wrapper.cpp"
#include "tb303_level_alignment_pattern.h"

extern "C" int tb303_render_jc303(float volume, float* out);

namespace {

int g_failures = 0;

void check(bool cond, const std::string& what) {
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", what.c_str());
    if (!cond) ++g_failures;
}

float peakOf(const float* v, int n) {
    float p = 0.0f;
    for (int i = 0; i < n; ++i) p = std::max(p, std::fabs(v[i]));
    return p;
}

float toDb(float v) { return v > 1e-12f ? 20.0f * std::log10(v) : -999.0f; }

/** Registry index of an open303-*family* model, or -1.
 *
 *  open303_get_model_count() also enumerates jc303-family entries, which
 *  open303_set_model() deliberately rejects (they are rendered by the rosic
 *  engine instead). Selecting one silently leaves the instance on its previous
 *  profile, so filtering here keeps a rejected id from being measured — and
 *  reported — as if it were its own voice. */
int findOpen303FamilyModel(const char* modelId) {
    for (int i = 0; i < open303_get_model_count(); ++i) {
        if (open303_get_model_engine(i) != ENGINE_OPEN303) continue;
        const char* mid = open303_get_model_id(i);
        if (mid && std::strcmp(mid, modelId) == 0) return i;
    }
    return -1;
}

/** Renders @p modelId, or returns 0 frames when it is not a selectable
 *  open303-family model (callers treat that as a failure, never as silence). */
int renderOpen303(const char* modelId, float volume, float* out) {
    const int index = findOpen303FamilyModel(modelId);
    if (index < 0) return 0;

    uintptr_t h = open303_create();
    open303_init(h, TB303_SAMPLE_RATE, TB303_BLOCK);
    if (open303_set_model(h, index) != 1) {
        open303_destroy(h);
        return 0;
    }
    open303_set_param(h, TB303_P_WAVEFORM,  0.0f);
    open303_set_param(h, TB303_P_CUTOFF,    0.35f);
    open303_set_param(h, TB303_P_RESONANCE, 0.70f);
    open303_set_param(h, TB303_P_ENVMOD,    0.55f);
    open303_set_param(h, TB303_P_DECAY,     0.50f);
    open303_set_param(h, TB303_P_ACCENT,    0.70f);
    open303_set_param(h, TB303_P_VOLUME,    volume);

    int n = 0;
    float blk[TB303_BLOCK];
    int prevNote = -1;
    for (int s = 0; s < TB303_NUM_STEPS; ++s) {
        if (!kTb303Pattern[s].legato && prevNote >= 0) open303_note_off(h, prevNote);
        open303_note_on(h, kTb303Pattern[s].note,
                        kTb303Pattern[s].accent ? TB303_ACCENT_VEL : TB303_NORMAL_VEL);
        prevNote = kTb303Pattern[s].note;
        for (int b = 0; b < TB303_STEP_BLOCKS; ++b) {
            std::memset(blk, 0, sizeof(blk));
            open303_process(h, reinterpret_cast<uintptr_t>(blk), TB303_BLOCK);
            for (int i = 0; i < TB303_BLOCK; ++i) out[n++] = blk[i];
        }
    }
    open303_destroy(h);
    return n;
}

/** Reference peak at LEVEL=1.0 under the canonical pattern (open303 family). */
constexpr float kReferencePeak = 0.822f;
/** Catalog spread allowance. Model voicings legitimately differ a little. */
constexpr float kToleranceDb = 1.5f;
/** LEVEL values to sweep; covers the three track defaults (0.40/0.45/0.50). */
const float kLevels[] = { 0.10f, 0.25f, 0.40f, 0.45f, 0.50f, 0.60f, 0.80f, 1.00f };

} // namespace

int main() {
    std::printf("TB-303 realtime voice level alignment\n");
    std::printf("=====================================\n");

    std::vector<float> buf(TB303_TOTAL_FRAMES + TB303_BLOCK);

    // ── 1. Every voice lands on the reference level at LEVEL=1.0 ─────────────
    std::printf("\nReference level at LEVEL=1.0 (target %.3f, +/- %.1f dB):\n",
                kReferencePeak, kToleranceDb);
    const float refDb = toDb(kReferencePeak);

    for (int i = 0; i < open303_get_model_count(); ++i) {
        // jc303-family entries are rendered by the rosic engine, checked below.
        if (open303_get_model_engine(i) != ENGINE_OPEN303) continue;
        const char* id = open303_get_model_id(i);
        if (!id) continue;
        const int n = renderOpen303(id, 1.0f, buf.data());
        const float pk = peakOf(buf.data(), n);
        char msg[192];
        std::snprintf(msg, sizeof(msg), "%-18s peak %.4f (%+.2f dB vs reference)",
                      id, pk, toDb(pk) - refDb);
        check(n > 0 && std::fabs(toDb(pk) - refDb) <= kToleranceDb, msg);
    }
    {
        const int n = tb303_render_jc303(1.0f, buf.data());
        const float pk = peakOf(buf.data(), n);
        char msg[192];
        std::snprintf(msg, sizeof(msg), "%-18s peak %.4f (%+.2f dB vs reference)",
                      "jc303(rosic)", pk, toDb(pk) - refDb);
        check(std::fabs(toDb(pk) - refDb) <= kToleranceDb, msg);
    }

    // ── 2. No voice clips at maximum LEVEL ───────────────────────────────────
    std::printf("\nNo clipping at LEVEL=1.0:\n");
    for (int i = 0; i < open303_get_model_count(); ++i) {
        if (open303_get_model_engine(i) != ENGINE_OPEN303) continue;
        const char* id = open303_get_model_id(i);
        if (!id) continue;
        const int n = renderOpen303(id, 1.0f, buf.data());
        const float pk = peakOf(buf.data(), n);
        char msg[192];
        std::snprintf(msg, sizeof(msg), "%-18s peak %.4f <= 1.0", id, pk);
        check(n > 0 && pk <= 1.0f, msg);
    }
    {
        const int n = tb303_render_jc303(1.0f, buf.data());
        const float pk = peakOf(buf.data(), n);
        char msg[192];
        std::snprintf(msg, sizeof(msg), "%-18s peak %.4f <= 1.0", "jc303(rosic)", pk);
        check(pk <= 1.0f, msg);
    }

    // ── 3. jc303 tracks the open303 family across the whole LEVEL range ──────
    // A single makeup constant cannot fix a law mismatch, so sweeping LEVEL is
    // what actually pins the control law rather than one operating point.
    std::printf("\njc303 tracks stock-open303 across the LEVEL range:\n");
    for (float lv : kLevels) {
        const int nStock = renderOpen303("stock-open303", lv, buf.data());
        const float stockPk = peakOf(buf.data(), nStock);
        const int nJc = tb303_render_jc303(lv, buf.data());
        const float jcPk = peakOf(buf.data(), nJc);
        const float deltaDb = toDb(jcPk) - toDb(stockPk);
        char msg[192];
        std::snprintf(msg, sizeof(msg),
                      "LEVEL %.2f  stock %.4f  jc303 %.4f  (%+.2f dB)",
                      lv, stockPk, jcPk, deltaDb);
        check(std::fabs(deltaDb) <= kToleranceDb, msg);
    }

    // ── 4. LEVEL is a linear amplitude control ───────────────────────────────
    // Halving LEVEL must halve amplitude (-6.02 dB), for every engine.
    std::printf("\nLEVEL scales linearly (halving LEVEL = -6.02 dB):\n");
    {
        const int nFull = renderOpen303("stock-open303", 0.8f, buf.data());
        const float full = peakOf(buf.data(), nFull);
        const int nHalf = renderOpen303("stock-open303", 0.4f, buf.data());
        const float half = peakOf(buf.data(), nHalf);
        char msg[192];
        std::snprintf(msg, sizeof(msg), "stock-open303 0.8->0.4 = %+.2f dB",
                      toDb(half) - toDb(full));
        check(std::fabs((toDb(half) - toDb(full)) + 6.02f) <= 0.5f, msg);
    }
    {
        const int nFull = tb303_render_jc303(0.8f, buf.data());
        const float full = peakOf(buf.data(), nFull);
        const int nHalf = tb303_render_jc303(0.4f, buf.data());
        const float half = peakOf(buf.data(), nHalf);
        char msg[192];
        std::snprintf(msg, sizeof(msg), "jc303(rosic)  0.8->0.4 = %+.2f dB",
                      toDb(half) - toDb(full));
        check(std::fabs((toDb(half) - toDb(full)) + 6.02f) <= 0.5f, msg);
    }

    // ── 5. LEVEL=0 is silent ─────────────────────────────────────────────────
    std::printf("\nLEVEL=0 is silent:\n");
    {
        const int n = renderOpen303("stock-open303", 0.0f, buf.data());
        check(peakOf(buf.data(), n) == 0.0f, "stock-open303 silent at LEVEL=0");
    }
    {
        const int n = tb303_render_jc303(0.0f, buf.data());
        check(peakOf(buf.data(), n) == 0.0f, "jc303(rosic) silent at LEVEL=0");
    }

    std::printf("\n%s (%d failure%s)\n",
                g_failures == 0 ? "ALL PASSED" : "FAILURES",
                g_failures, g_failures == 1 ? "" : "s");
    return g_failures == 0 ? 0 : 1;
}
