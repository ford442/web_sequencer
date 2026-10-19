/**
 * Offline host test for the analog 808/909 drum kit (issue #1234).
 *
 * Compiles drumkit_wrapper.cpp with host g++ (emscripten stubs) and asserts:
 *   - kick / snare / closed hat / open hat are non-silent on both kits
 *   - 808 kick has a longer RMS tail than 909; 909 snare is brighter
 *   - closed hat chokes open hat on the sample clock
 *
 * Usage (via emscripten/tests/run_offline_voices_test.sh):
 *   g++ -std=c++17 -I emscripten/tests/emscripten_stub \
 *       emscripten/tests/drumkit_offline_test.cpp -o /tmp/drumkit_offline
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "../drumkit_wrapper.cpp"

namespace {

constexpr float SAMPLE_RATE = 44100.0f;
constexpr int BLOCK = 128;

int g_failures = 0;

void check(bool cond, const std::string& msg) {
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", msg.c_str());
    if (!cond) ++g_failures;
}

float rms(const std::vector<float>& buf, size_t start, size_t end) {
    if (end <= start || end > buf.size()) return 0.0f;
    double acc = 0.0;
    for (size_t i = start; i < end; ++i) acc += static_cast<double>(buf[i]) * buf[i];
    return static_cast<float>(std::sqrt(acc / static_cast<double>(end - start)));
}

float highbandEnergy(const std::vector<float>& buf) {
    // Cheap brightness proxy: mean absolute first difference.
    if (buf.size() < 2) return 0.0f;
    double acc = 0.0;
    for (size_t i = 1; i < buf.size(); ++i) {
        acc += std::fabs(buf[i] - buf[i - 1]);
    }
    return static_cast<float>(acc / static_cast<double>(buf.size() - 1));
}

bool allFinite(const std::vector<float>& buf) {
    for (float s : buf) {
        if (!std::isfinite(s)) return false;
    }
    return true;
}

std::vector<float> renderVoice(int kit, int voice, float a, float b, float c, float d, float seconds) {
    uintptr_t h = drumkit_create();
    check(drumkit_init(h, SAMPLE_RATE, BLOCK) == 1, "drumkit_init");
    drumkit_set_kit(h, kit);
    drumkit_trigger(h, voice, 1.0f, a, b, c, d);

    const int total = static_cast<int>(seconds * SAMPLE_RATE);
    std::vector<float> out;
    out.reserve(static_cast<size_t>(total));
    int remaining = total;
    while (remaining > 0) {
        const int n = remaining < BLOCK ? remaining : BLOCK;
        uintptr_t ptr = drumkit_process(h, n);
        if (ptr == 0) {
            check(false, "drumkit_process non-null");
            drumkit_destroy(h);
            return out;
        }
        const float* buf = reinterpret_cast<const float*>(ptr);
        out.insert(out.end(), buf, buf + n);
        remaining -= n;
    }
    drumkit_destroy(h);
    return out;
}

// ── Event API (#1344): push_event + render on the AudioContext frame clock ──

int pushTrigger(uintptr_t h, int64_t frame, int voice, float a, float b, float c, float d) {
    return drumkit_push_event(h, static_cast<double>(frame), hyphon::kTrigger, voice, 1.0f, a, b, c, d);
}

/** Index of the first non-zero sample, or -1. */
long firstSound(const std::vector<float>& buf) {
    for (size_t i = 0; i < buf.size(); ++i) {
        if (buf[i] != 0.0f) return static_cast<long>(i);
    }
    return -1;
}

std::vector<float> renderEvents(uintptr_t h, int64_t start, int blocks) {
    std::vector<float> out;
    for (int b = 0; b < blocks; ++b) {
        const uintptr_t ptr = drumkit_render(h, static_cast<double>(start + int64_t{b} * BLOCK), BLOCK);
        if (!ptr) {
            check(false, "drumkit_render non-null");
            return out;
        }
        const float* buf = reinterpret_cast<const float*>(ptr);
        out.insert(out.end(), buf, buf + BLOCK);
    }
    return out;
}

void testEventApi() {
    std::printf("event API\n");
    const int64_t start = 44100;  // one second into the context

    // Block-aligned events reproduce the immediate API exactly.
    {
        uintptr_t immediate = drumkit_create();
        uintptr_t events = drumkit_create();
        drumkit_init(immediate, SAMPLE_RATE, BLOCK);
        drumkit_init(events, SAMPLE_RATE, BLOCK);
        std::vector<float> a, b;
        for (int blk = 0; blk < 64; ++blk) {
            if (blk % 8 == 0) {
                drumkit_trigger(immediate, 0, 1.0f, 50.0f, 0.6f, 0.6f, 1.0f);
                pushTrigger(events, start + int64_t{blk} * BLOCK, 0, 50.0f, 0.6f, 0.6f, 1.0f);
            }
            if (blk % 8 == 4) {
                drumkit_trigger(immediate, 2, 1.0f, 8000.0f, 0.05f, 0.7f, 0.0f);
                pushTrigger(events, start + int64_t{blk} * BLOCK, 2, 8000.0f, 0.05f, 0.7f, 0.0f);
            }
            const float* x = reinterpret_cast<const float*>(drumkit_process(immediate, BLOCK));
            const float* y = reinterpret_cast<const float*>(
                drumkit_render(events, static_cast<double>(start + int64_t{blk} * BLOCK), BLOCK));
            a.insert(a.end(), x, x + BLOCK);
            b.insert(b.end(), y, y + BLOCK);
        }
        check(a == b && rms(a, 0, a.size()) > 0.01f, "block-aligned events render bit-identical to trigger + process");
        drumkit_destroy(immediate);
        drumkit_destroy(events);
    }

    // A mid-block trigger starts on its own frame, not the block's.
    {
        bool exact = true;
        for (int offset : {1, 37, 64, 127}) {
            uintptr_t h = drumkit_create();
            drumkit_init(h, SAMPLE_RATE, BLOCK);
            pushTrigger(h, start + BLOCK + offset, 0, 50.0f, 0.6f, 0.6f, 1.0f);
            const auto out = renderEvents(h, start, 4);
            exact = exact && firstSound(out) == BLOCK + offset;
            drumkit_destroy(h);
        }
        check(exact, "a trigger pushed for a mid-block frame sounds on exactly that frame");
    }

    // Choke and kit switch are events too.
    {
        uintptr_t h = drumkit_create();
        drumkit_init(h, SAMPLE_RATE, BLOCK);
        pushTrigger(h, start, 3, 6500.0f, 0.5f, 0.7f, 0.0f);
        drumkit_push_event(h, static_cast<double>(start + 40 * BLOCK + 17), kDrumkitChokeOpenHat, 0, 0, 0, 0, 0, 0);
        const auto out = renderEvents(h, start, 80);
        const size_t choke = 40 * BLOCK + 17 + static_cast<size_t>(0.003f * SAMPLE_RATE);
        check(rms(out, 0, 40 * BLOCK) > 0.001f && rms(out, choke, out.size()) == 0.0f,
              "a choke event silences the open hat 2 ms after its frame");
        drumkit_destroy(h);
    }

    // Per-hit pan (planar stereo, right at ptr + BLOCK): a pan event latches on
    // the voice's next trigger; centre is the mono kit on both channels.
    {
        auto renderPanned = [&](float pan, std::vector<float>& left, std::vector<float>& right) {
            uintptr_t h = drumkit_create();
            drumkit_init(h, SAMPLE_RATE, BLOCK);
            drumkit_push_event(h, static_cast<double>(start + 37), kDrumkitSetPan, 1, pan, 0, 0, 0, 0);
            drumkit_push_event(h, static_cast<double>(start + 37), hyphon::kTrigger, 1, 1.0f, 200.0f, 0.3f, 2000.0f, 0.9f);
            for (int b = 0; b < 40; ++b) {
                const float* buf = reinterpret_cast<const float*>(
                    drumkit_render(h, static_cast<double>(start + int64_t{b} * BLOCK), BLOCK));
                left.insert(left.end(), buf, buf + BLOCK);
                right.insert(right.end(), buf + BLOCK, buf + 2 * BLOCK);
            }
            drumkit_destroy(h);
        };
        std::vector<float> cl, cr, hl, hr, ql, qr;
        renderPanned(0.0f, cl, cr);
        renderPanned(-1.0f, hl, hr);
        renderPanned(0.5f, ql, qr);
        const float c = rms(cl, 0, cl.size());
        check(c > 0.01f && cl == cr, "a centred hit is identical on both channels");
        check(rms(hr, 0, hr.size()) < 1e-6f && std::fabs(rms(hl, 0, hl.size()) / c - std::sqrt(2.0f)) < 1e-3f,
              "hard left: silent right, +3 dB left");
        const float lq = rms(ql, 0, ql.size());
        const float rq = rms(qr, 0, qr.size());
        check(rq > lq && std::fabs((lq * lq + rq * rq) / (2.0f * c * c) - 1.0f) < 1e-3f,
              "half right: louder right, constant power");
    }

    // Stop: pending triggers are dropped.
    {
        uintptr_t h = drumkit_create();
        drumkit_init(h, SAMPLE_RATE, BLOCK);
        pushTrigger(h, start + 300, 0, 50.0f, 0.6f, 0.6f, 1.0f);
        drumkit_cancel_notes(h);
        check(firstSound(renderEvents(h, start, 8)) == -1, "drumkit_cancel_notes drops a pending trigger");
        drumkit_destroy(h);
    }

    // The strict path refuses an oversize block; stale handles resolve to nothing.
    {
        uintptr_t h = drumkit_create();
        drumkit_init(h, SAMPLE_RATE, BLOCK);
        check(drumkit_render(h, 0.0, BLOCK * 4) == 0, "drumkit_render refuses a block larger than init reserved");
        check(drumkit_process(h, BLOCK * 4) == 0, "drumkit_process refuses one too: the right channel sits a stride in");
        drumkit_destroy(h);
        check(drumkit_render(h, 0.0, BLOCK) == 0 && drumkit_push_event(h, 0.0, hyphon::kTrigger, 0, 1, 0, 0, 0, 0) == 0,
              "a destroyed handle resolves to nothing");
        drumkit_trigger(h, 0, 1.0f, 50.0f, 0.6f, 0.6f, 1.0f);  // must not crash
    }
}

}  // namespace

int main() {
    std::printf("drumkit_offline_test\n");

    // TR-808 / TR-909 default song params (DrumKitPresets.ts).
    auto kick808 = renderVoice(0, 0, 50.0f, 0.6f, 0.6f, 1.0f, 0.8f);
    auto kick909 = renderVoice(1, 0, 65.0f, 0.35f, 0.8f, 1.0f, 0.8f);
    auto snare808 = renderVoice(0, 1, 200.0f, 0.3f, 2000.0f, 0.9f, 0.5f);
    auto snare909 = renderVoice(1, 1, 300.0f, 0.2f, 4000.0f, 0.9f, 0.5f);
    auto ch808 = renderVoice(0, 2, 8000.0f, 0.05f, 0.7f, 0.0f, 0.2f);
    auto oh808 = renderVoice(0, 3, 6500.0f, 0.5f, 0.7f, 0.0f, 0.6f);
    auto ch909 = renderVoice(1, 2, 10000.0f, 0.04f, 0.7f, 0.0f, 0.2f);
    auto oh909 = renderVoice(1, 3, 8000.0f, 0.35f, 0.7f, 0.0f, 0.5f);

    check(allFinite(kick808) && rms(kick808, 0, kick808.size()) > 0.01f, "808 kick non-silent finite");
    check(allFinite(kick909) && rms(kick909, 0, kick909.size()) > 0.01f, "909 kick non-silent finite");
    check(allFinite(snare808) && rms(snare808, 0, snare808.size()) > 0.005f, "808 snare non-silent finite");
    check(allFinite(snare909) && rms(snare909, 0, snare909.size()) > 0.005f, "909 snare non-silent finite");
    check(allFinite(ch808) && rms(ch808, 0, ch808.size()) > 0.001f, "808 closed hat non-silent");
    check(allFinite(oh808) && rms(oh808, 0, oh808.size()) > 0.001f, "808 open hat non-silent");
    check(allFinite(ch909) && rms(ch909, 0, ch909.size()) > 0.001f, "909 closed hat non-silent");
    check(allFinite(oh909) && rms(oh909, 0, oh909.size()) > 0.001f, "909 open hat non-silent");

    const size_t tailStart = static_cast<size_t>(0.35f * SAMPLE_RATE);
    const float kick808Tail = rms(kick808, tailStart, kick808.size());
    const float kick909Tail = rms(kick909, tailStart, kick909.size());
    check(kick808Tail > kick909Tail * 1.3f, "808 kick boom lasts longer than 909");

    const float snare808Hi = highbandEnergy(snare808);
    const float snare909Hi = highbandEnergy(snare909);
    check(snare909Hi > snare808Hi * 1.05f, "909 snare brighter (higher spectral flux) than 808");

    const float oh808Tail = rms(oh808, static_cast<size_t>(0.15f * SAMPLE_RATE), oh808.size());
    const float ch808Tail = rms(ch808, static_cast<size_t>(0.08f * SAMPLE_RATE), ch808.size());
    check(oh808Tail > ch808Tail * 2.0f, "open hat sustains longer than closed hat");

    // Retrigger: second kick is still audible.
    {
        uintptr_t h = drumkit_create();
        drumkit_init(h, SAMPLE_RATE, BLOCK);
        drumkit_set_kit(h, 0);
        drumkit_trigger(h, 0, 1.0f, 50.0f, 0.6f, 0.6f, 1.0f);
        int skip = static_cast<int>(0.05f * SAMPLE_RATE);
        while (skip > 0) {
            const int n = skip < BLOCK ? skip : BLOCK;
            drumkit_process(h, n);
            skip -= n;
        }
        drumkit_trigger(h, 0, 1.0f, 50.0f, 0.6f, 0.6f, 1.0f);
        std::vector<float> retrigger;
        int frames = BLOCK * 8;
        while (frames > 0) {
            uintptr_t ptr = drumkit_process(h, BLOCK);
            const float* buf = reinterpret_cast<const float*>(ptr);
            retrigger.insert(retrigger.end(), buf, buf + BLOCK);
            frames -= BLOCK;
        }
        check(rms(retrigger, 0, retrigger.size()) > 0.01f, "retriggered kick non-silent");
        drumkit_destroy(h);
    }

    // Choke: open hat then closed hat — tail after choke is near silent vs unchoked OH.
    {
        uintptr_t h = drumkit_create();
        drumkit_init(h, SAMPLE_RATE, BLOCK);
        drumkit_set_kit(h, 0);
        drumkit_trigger(h, 3, 1.0f, 6500.0f, 0.5f, 0.7f, 0.0f);

        int untilChoke = static_cast<int>(0.04f * SAMPLE_RATE);
        while (untilChoke > 0) {
            const int n = untilChoke < BLOCK ? untilChoke : BLOCK;
            drumkit_process(h, n);
            untilChoke -= n;
        }
        drumkit_trigger(h, 2, 1.0f, 8000.0f, 0.05f, 0.7f, 0.0f);

        std::vector<float> after;
        int remain = static_cast<int>(0.25f * SAMPLE_RATE);
        while (remain > 0) {
            const int n = remain < BLOCK ? remain : BLOCK;
            uintptr_t ptr = drumkit_process(h, n);
            const float* buf = reinterpret_cast<const float*>(ptr);
            after.insert(after.end(), buf, buf + n);
            remain -= n;
        }
        // Skip the closed-hat body (~50ms) then the open hat should be choked.
        const size_t postHat = static_cast<size_t>(0.08f * SAMPLE_RATE);
        const float chokedTail = rms(after, postHat, after.size());
        const float freeOhTail = rms(oh808, static_cast<size_t>(0.12f * SAMPLE_RATE), oh808.size());
        check(chokedTail < freeOhTail * 0.35f, "closed hat chokes open hat on the audio clock");
        drumkit_destroy(h);
    }

    testEventApi();

    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all checks passed\n");
    return 0;
}
