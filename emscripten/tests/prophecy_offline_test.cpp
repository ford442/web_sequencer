/**
 * Offline host test for the Prophecy formant voice on the shared voice core
 * (issue #1344 P3).
 *
 * Compiles prophecy_wrapper.cpp with host g++ (emscripten stubs) and asserts:
 *   - every waveform renders non-silent and finite
 *   - block-aligned events render bit-identical to the immediate API
 *   - mid-block events render bit-identical to the immediate API split by hand
 *     at the same frames, i.e. a note starts and releases on its own frame
 *   - prophecy_process grows for an oversize block instead of truncating it
 *
 * Usage (via emscripten/tests/run_offline_voices_test.sh):
 *   g++ -std=c++17 -I emscripten/tests/emscripten_stub \
 *       emscripten/tests/prophecy_offline_test.cpp -o /tmp/prophecy_offline
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "../prophecy_wrapper.cpp"

namespace {

constexpr float SAMPLE_RATE = 48000.0f;
constexpr int BLOCK = 128;

int g_failures = 0;

void check(bool cond, const char* msg) {
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", msg);
    if (!cond) ++g_failures;
}

float rms(const std::vector<float>& buf) {
    if (buf.empty()) return 0.0f;
    double acc = 0.0;
    for (float s : buf) acc += static_cast<double>(s) * s;
    return static_cast<float>(std::sqrt(acc / static_cast<double>(buf.size())));
}

bool allFinite(const std::vector<float>& buf) {
    for (float s : buf) {
        if (!std::isfinite(s)) return false;
    }
    return true;
}

uintptr_t makeVoice(int waveform) {
    const uintptr_t h = prophecy_create();
    prophecy_init(h, SAMPLE_RATE, BLOCK);
    prophecy_set_param(h, PROPHECY_WAVEFORM, static_cast<float>(waveform));
    prophecy_set_param(h, PROPHECY_ATTACK, 0.002f);
    prophecy_set_param(h, PROPHECY_RELEASE, 0.05f);
    return h;
}

void append(std::vector<float>& out, uintptr_t ptr, int n) {
    const float* buf = reinterpret_cast<const float*>(ptr);
    if (!buf) {
        check(false, "render returned non-null");
        return;
    }
    out.insert(out.end(), buf, buf + n);
}

int pushNote(uintptr_t h, int64_t frame, uint16_t type, int note, float velocity = 100.0f) {
    return prophecy_push_event(h, static_cast<double>(frame), type, note, velocity, 0, 0, 0, 0);
}

}  // namespace

int main() {
    std::printf("prophecy_offline_test\n");
    const int64_t start = 48000;

    // Every waveform sounds.
    {
        bool ok = true;
        for (int wf = 0; wf < 4; ++wf) {
            const uintptr_t h = makeVoice(wf);
            prophecy_note_on(h, 57, 100.0f);
            std::vector<float> out;
            for (int b = 0; b < 40; ++b) append(out, prophecy_process(h, BLOCK), BLOCK);
            ok = ok && allFinite(out) && rms(out) > 0.01f;
            prophecy_destroy(h);
        }
        check(ok, "saw / square / triangle / pulse render non-silent and finite");
    }

    // Block-aligned events reproduce the immediate API exactly.
    {
        const uintptr_t immediate = makeVoice(0);
        const uintptr_t events = makeVoice(0);
        std::vector<float> a, b;
        for (int blk = 0; blk < 96; ++blk) {
            const int64_t frame = start + int64_t{blk} * BLOCK;
            const int note = 48 + (blk / 12) % 12;
            if (blk % 12 == 0) {
                prophecy_note_on(immediate, note, 100.0f);
                pushNote(events, frame, hyphon::kNoteOn, note);
            }
            if (blk % 12 == 8) {
                prophecy_note_off(immediate, note);
                pushNote(events, frame, hyphon::kNoteOff, note);
            }
            if (blk == 40) {
                prophecy_set_param(immediate, PROPHECY_VOWEL, 0.7f);
                prophecy_push_event(events, static_cast<double>(frame), hyphon::kParam, PROPHECY_VOWEL, 0.7f, 0, 0, 0, 0);
            }
            append(a, prophecy_process(immediate, BLOCK), BLOCK);
            append(b, prophecy_render(events, static_cast<double>(frame), BLOCK), BLOCK);
        }
        check(a == b && rms(a) > 0.01f, "block-aligned events render bit-identical to the immediate API");
        prophecy_destroy(immediate);
        prophecy_destroy(events);
    }

    // Mid-block events = the immediate API split by hand at the same frames.
    {
        // Frames relative to `start`: noteOn mid-block, a second voice on the
        // last frame of a block, param mid-block, noteOff on frame 1 of a block.
        struct Ev { int64_t at; uint16_t type; int target; float value; };
        const Ev evs[] = {
            {37, hyphon::kNoteOn, 52, 100.0f},
            {255, hyphon::kNoteOn, 59, 80.0f},
            {700, hyphon::kParam, PROPHECY_FORMANT_SHIFT, 0.6f},
            {1025, hyphon::kNoteOff, 52, 0.0f},
            {1500, hyphon::kNoteOff, 59, 0.0f},
        };
        const int total = BLOCK * 24;

        const uintptr_t ref = makeVoice(1);
        std::vector<float> manual;
        int64_t pos = 0;
        for (const Ev& e : evs) {
            while (pos < e.at) {  // render up to the event in chunks no longer than a block
                const int n = static_cast<int>(std::min<int64_t>(BLOCK, e.at - pos));
                append(manual, prophecy_process(ref, n), n);
                pos += n;
            }
            if (e.type == hyphon::kNoteOn) prophecy_note_on(ref, e.target, e.value);
            else if (e.type == hyphon::kNoteOff) prophecy_note_off(ref, e.target);
            else prophecy_set_param(ref, e.target, e.value);
        }
        while (pos < total) {
            const int n = static_cast<int>(std::min<int64_t>(BLOCK, total - pos));
            append(manual, prophecy_process(ref, n), n);
            pos += n;
        }

        const uintptr_t live = makeVoice(1);
        for (const Ev& e : evs) {
            prophecy_push_event(live, static_cast<double>(start + e.at), e.type, e.target, e.value, 0, 0, 0, 0);
        }
        std::vector<float> rendered;
        for (int b = 0; b < total / BLOCK; ++b) {
            append(rendered, prophecy_render(live, static_cast<double>(start + int64_t{b} * BLOCK), BLOCK), BLOCK);
        }

        bool silentBefore = true;
        for (int i = 0; i < 37; ++i) silentBefore = silentBefore && rendered[i] == 0.0f;
        check(silentBefore && rendered[37] != 0.0f, "a noteOn pushed for frame 37 starts on frame 37");
        check(rendered == manual, "mid-block events render bit-identical to the immediate API split at those frames");
        prophecy_destroy(ref);
        prophecy_destroy(live);
    }

    // Oversize block: grown, not truncated.
    {
        const uintptr_t h = makeVoice(0);
        prophecy_note_on(h, 60, 100.0f);
        const float* buf = reinterpret_cast<const float*>(prophecy_process(h, BLOCK * 4));
        bool tailRendered = buf != nullptr;
        if (buf) {
            float acc = 0.0f;
            for (int i = BLOCK; i < BLOCK * 4; ++i) acc += std::fabs(buf[i]);
            tailRendered = acc > 0.0f;
        }
        check(tailRendered, "prophecy_process renders every frame of a block larger than init reserved");
        check(prophecy_render(h, 0.0, BLOCK * 8) == 0, "prophecy_render refuses one larger than the buffer");
        prophecy_destroy(h);
    }

    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all checks passed\n");
    return 0;
}
