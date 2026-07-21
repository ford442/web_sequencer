/**
 * tb303_factory_smoke_test.cpp
 *
 * Smoke test for the C++ 303 model factory / registry surface (issue #901).
 * Exercises the exported WASM API offline (host g++, no emsdk) to cover the
 * acceptance criteria:
 *
 *   - getAvailable303Models() returns valid JSON containing at least
 *     stock-open303 and jc303, each with the right engine family.
 *   - open303_get_model_count / _id / _engine agree with the JSON.
 *   - Every open303-family model can be created, selected (by index AND by
 *     string id — the two are equivalent) and renders finite, non-silent audio.
 *   - open303_find_model_index / open303_set_model_by_id resolve stable ids;
 *     unknown ids and the jc303-family model are rejected (0 / -1).
 *   - Switching model mid-session (index and by-id) does not crash and keeps
 *     producing finite audio.
 *
 * Build + run (see run_offline_voices_test.sh, which runs this too):
 *   g++ -std=c++17 -I emscripten/tests/emscripten_stub \
 *       emscripten/tests/tb303_factory_smoke_test.cpp -o /tmp/tb303_factory
 *   /tmp/tb303_factory
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "../open303_wrapper.cpp"

namespace {

constexpr float SAMPLE_RATE = 44100.0f;
constexpr int   BLOCK       = 128;

int g_failures = 0;
void check(bool cond, const std::string& msg) {
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", msg.c_str());
    if (!cond) ++g_failures;
}

/** Render a short note through a fresh instance on @p modelIndex.
 *  Returns false if the instance could not host the model (e.g. jc303). */
bool renderShort(int modelIndex, std::vector<float>& out, bool useStringId) {
    uintptr_t h = open303_create();
    open303_init(h, SAMPLE_RATE, BLOCK);

    int applied;
    if (useStringId) {
        applied = open303_set_model_by_id(h, open303_get_model_id(modelIndex));
    } else {
        applied = open303_set_model(h, modelIndex);
    }
    if (applied != 1) { open303_destroy(h); return false; }

    open303_set_param(h, 2 /*CUTOFF*/,    0.4f);
    open303_set_param(h, 3 /*RESONANCE*/, 0.7f);
    open303_set_param(h, 5 /*DECAY*/,     0.5f);
    open303_set_param(h, 7 /*VOLUME*/,    0.8f);
    open303_note_on(h, 40, 110.0f);

    out.clear();
    float block[BLOCK];
    for (int b = 0; b < 40; ++b) {          // ~0.12 s
        std::memset(block, 0, sizeof(block));
        open303_process(h, reinterpret_cast<uintptr_t>(block), BLOCK);
        out.insert(out.end(), block, block + BLOCK);
    }
    open303_destroy(h);
    return true;
}

bool finiteNonSilent(const std::vector<float>& v) {
    double peak = 0.0;
    for (float x : v) {
        if (!std::isfinite(x)) return false;
        peak = std::max(peak, std::fabs(static_cast<double>(x)));
    }
    return peak > 1.0e-4;   // clearly audible, not silence
}

bool jsonHas(const std::string& json, const std::string& id, const std::string& engine) {
    const std::string needleId = "\"id\":\"" + id + "\"";
    const size_t p = json.find(needleId);
    if (p == std::string::npos) return false;
    // The engine tag should appear in the same object (before the next '}').
    const size_t end = json.find('}', p);
    const std::string obj = json.substr(p, end - p);
    return obj.find("\"engine\":\"" + engine + "\"") != std::string::npos;
}

}  // namespace

int main() {
    std::printf("TB-303 factory / registry smoke test\n");
    std::printf("====================================\n");

    const int count = open303_get_model_count();
    check(count >= 2, "registry has at least 2 models");

    // getAvailable303Models() JSON — the dynamic UI discovery surface.
    const std::string json = getAvailable303Models();
    std::printf("getAvailable303Models() = %s\n", json.c_str());
    check(jsonHas(json, "stock-open303", "open303"), "JSON lists stock-open303 (open303)");
    check(jsonHas(json, "jc303", "jc303"),           "JSON lists jc303 (jc303)");

    // JSON count matches the exported count (one object per model).
    size_t objCount = 0;
    for (size_t p = json.find("\"id\":"); p != std::string::npos; p = json.find("\"id\":", p + 1)) {
        ++objCount;
    }
    check(static_cast<int>(objCount) == count, "JSON object count matches open303_get_model_count()");

    // Per-model: id/engine round-trip + open303-family models render audio.
    for (int i = 0; i < count; ++i) {
        const char* id = open303_get_model_id(i);
        const int   eng = open303_get_model_engine(i);
        check(id != nullptr, "model " + std::to_string(i) + " has an id");
        if (!id) continue;

        // Stable-id lookup round-trips to the same index.
        check(open303_find_model_index(id) == i,
              std::string("find_model_index(\"") + id + "\") round-trips");

        std::vector<float> byIndex, byId;
        const bool okIndex = renderShort(i, byIndex, /*useStringId=*/false);
        const bool okId    = renderShort(i, byId,    /*useStringId=*/true);

        if (eng == ENGINE_OPEN303) {
            check(okIndex && finiteNonSilent(byIndex),
                  std::string(id) + " renders finite, non-silent audio");
            check(okId, std::string(id) + " selectable by string id");
            // Index and string-id selection must be equivalent.
            bool equal = byIndex.size() == byId.size();
            for (size_t k = 0; equal && k < byIndex.size(); ++k) equal = (byIndex[k] == byId[k]);
            check(equal, std::string(id) + " by-index and by-id selection are identical");
        } else {
            // jc303-family: the open303 DSP does not host it (rosic does).
            check(!okIndex && !okId,
                  std::string(id) + " (jc303 family) rejected by the open303 instance");
        }
    }

    // Unknown ids are rejected everywhere.
    check(open303_find_model_index("no-such-voice") == -1, "unknown id → index -1");
    check(open303_find_model_index(nullptr) == -1,          "null id → index -1");
    {
        uintptr_t h = open303_create();
        open303_init(h, SAMPLE_RATE, BLOCK);
        check(open303_set_model_by_id(h, "no-such-voice") == 0, "set_model_by_id(unknown) → 0");
        check(open303_set_model_by_id(h, nullptr) == 0,          "set_model_by_id(null) → 0");
        open303_destroy(h);
    }

    // Mid-session switching (index + by-id) stays alive and finite.
    {
        uintptr_t h = open303_create();
        open303_init(h, SAMPLE_RATE, BLOCK);
        open303_note_on(h, 40, 110.0f);
        float block[BLOCK];
        bool finite = true;
        for (int b = 0; b < 120; ++b) {
            if (b % 2 == 0) open303_set_model(h, b % count);
            else            open303_set_model_by_id(h, open303_get_model_id(b % count));
            std::memset(block, 0, sizeof(block));
            open303_process(h, reinterpret_cast<uintptr_t>(block), BLOCK);
            for (float x : block) if (!std::isfinite(x)) finite = false;
        }
        open303_destroy(h);
        check(finite, "mid-session model switching (index + id) stays finite");
    }

    std::printf("\n%s (%d failure%s)\n",
                g_failures == 0 ? "ALL PASSED" : "FAILED",
                g_failures, g_failures == 1 ? "" : "s");
    return g_failures == 0 ? 0 : 1;
}
