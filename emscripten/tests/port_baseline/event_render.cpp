/**
 * Event-script renderer for the 303 voice comparison harness (#1543).
 *
 * Plays a timestamped note / param script through one native 303 engine, via
 * the same immediate C API the port-baseline dumps use, and writes raw mono
 * float32. The comparison tool (scripts/compare-303-voices.ts) renders the
 * same script through every other backend, so a voice's output differs only
 * by its DSP.
 *
 *   Build (see src/audio/offline/compare303/nativeRender.ts):
 *     g++ -std=c++17 -O2 -w -DEVENT_RENDER_OPEN303 -I tests/emscripten_stub -I . \
 *         tests/port_baseline/event_render.cpp -o event_render_open303
 *     g++ ... -DEVENT_RENDER_JC303 ... + the jc303_wasm rosic sources ... -o event_render_jc303
 *
 *   Run:   event_render <model-id> <events.txt> <out.f32>
 *
 * events.txt (one record per line, frames ascending, '#' comments allowed):
 *   sr <sampleRate>
 *   frames <totalFrames>
 *   e <frame> on <note> <velocity>
 *   e <frame> off <note>
 *   e <frame> param <paramId> <value>
 *   e <frame> alloff
 *
 * <model-id> picks a k303Models[] row for the open303 engine; the jc303 engine
 * has a single DSP, so it ignores the id. Blocks are at most 128 frames and
 * are cut at each event, so every event lands on its exact frame.
 */

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#if defined(EVENT_RENDER_JC303)
#include "jc303_wrapper.cpp"
#elif defined(EVENT_RENDER_OPEN303)
#include "open303_wrapper.cpp"
#else
#error "define EVENT_RENDER_OPEN303 or EVENT_RENDER_JC303"
#endif

namespace {

struct Event {
    int64_t frame = 0;
    enum Kind { On, Off, Param, AllOff } kind = On;
    int a = 0;
    float b = 0.0f;
};

constexpr int kMaxBlock = 128;

}  // namespace

int main(int argc, char** argv) {
    if (argc < 4) {
        std::fprintf(stderr, "usage: event_render <model-id> <events.txt> <out.f32>\n");
        return 2;
    }
    const std::string modelId = argv[1];
    std::ifstream in(argv[2]);
    if (!in) {
        std::fprintf(stderr, "cannot read %s\n", argv[2]);
        return 2;
    }

    float sampleRate = 44100.0f;
    int64_t totalFrames = 0;
    std::vector<Event> events;
    std::string line;
    while (std::getline(in, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::istringstream ss(line);
        std::string tag;
        ss >> tag;
        if (tag == "sr") {
            ss >> sampleRate;
        } else if (tag == "frames") {
            ss >> totalFrames;
        } else if (tag == "e") {
            Event e;
            std::string kind;
            ss >> e.frame >> kind;
            if (kind == "on") { e.kind = Event::On; ss >> e.a >> e.b; }
            else if (kind == "off") { e.kind = Event::Off; ss >> e.a; }
            else if (kind == "param") { e.kind = Event::Param; ss >> e.a >> e.b; }
            else if (kind == "alloff") { e.kind = Event::AllOff; }
            else { std::fprintf(stderr, "bad event kind: %s\n", kind.c_str()); return 2; }
            events.push_back(e);
        }
    }
    std::stable_sort(events.begin(), events.end(),
                     [](const Event& x, const Event& y) { return x.frame < y.frame; });

#if defined(EVENT_RENDER_JC303)
    const uintptr_t h = jc303_create();
    jc303_init_handle(h, sampleRate, kMaxBlock);
    auto noteOn = [&](int n, float v) { jc303_note_on(h, n, v); };
    auto noteOff = [&](int n) { jc303_note_off(h, n); };
    auto allOff = [&]() { jc303_all_notes_off(h); };
    auto setParam = [&](int id, float v) { jc303_set_param(h, id, v); };
    auto render = [&](int n, std::vector<float>& out) {
        const float* buf = reinterpret_cast<const float*>(jc303_process_handle(h, n));
        if (!buf) { std::fprintf(stderr, "jc303_process_handle returned 0\n"); std::exit(2); }
        out.insert(out.end(), buf, buf + n);
    };
#else
    const uintptr_t h = open303_create();
    open303_init(h, sampleRate, kMaxBlock);
    if (open303_set_model_by_id(h, modelId.c_str()) != 1) {
        std::fprintf(stderr, "open303 has no model '%s'\n", modelId.c_str());
        return 3;
    }
    std::vector<float> block(kMaxBlock);
    auto noteOn = [&](int n, float v) { open303_note_on(h, n, v); };
    auto noteOff = [&](int n) { open303_note_off(h, n); };
    auto allOff = [&]() { open303_all_notes_off(h); };
    auto setParam = [&](int id, float v) { open303_set_param(h, id, v); };
    auto render = [&](int n, std::vector<float>& out) {
        open303_process(h, reinterpret_cast<uintptr_t>(block.data()), n);
        out.insert(out.end(), block.begin(), block.begin() + n);
    };
#endif

    std::vector<float> out;
    out.reserve(static_cast<size_t>(totalFrames));
    int64_t pos = 0;
    auto renderTo = [&](int64_t target) {
        while (pos < target) {
            const int n = static_cast<int>(std::min<int64_t>(kMaxBlock, target - pos));
            render(n, out);
            pos += n;
        }
    };
    for (const Event& e : events) {
        renderTo(std::min(e.frame, totalFrames));
        switch (e.kind) {
            case Event::On: noteOn(e.a, e.b); break;
            case Event::Off: noteOff(e.a); break;
            case Event::Param: setParam(e.a, e.b); break;
            case Event::AllOff: allOff(); break;
        }
    }
    renderTo(totalFrames);

#if defined(EVENT_RENDER_JC303)
    jc303_destroy(h);
#else
    open303_destroy(h);
#endif

    std::FILE* f = std::fopen(argv[3], "wb");
    if (!f) return 2;
    std::fwrite(out.data(), sizeof(float), out.size(), f);
    std::fclose(f);
    std::printf("%zu samples\n", out.size());
    return 0;
}
