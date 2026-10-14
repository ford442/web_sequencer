/**
 * Event-API checks shared by the 303 host tests (issue #1344 P3).
 *
 * For an engine ported onto the voice core, the event path
 * (prefix_push_event + prefix_render) must be the immediate API applied on
 * the event's exact frame — no more, no less:
 *   - block-aligned events render bit-identical to the immediate API
 *   - mid-block events render bit-identical to the immediate API with the
 *     block split by hand at those frames
 *   - prefix_cancel_notes drops pending notes; params still land
 *   - an oversize block and a destroyed handle are refused, not crashed on
 *
 * `Api` adapts one engine's C API (see the callers); `check` is the calling
 * test's reporter.
 */
#pragma once

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "../core/voice.h"

namespace event_api_checks {

struct Ev {
    int64_t at;  // frame relative to the render start
    uint16_t type;
    int target;
    float value;
};

template <class Api>
void applyImmediate(Api& api, uintptr_t h, const Ev& e) {
    if (e.type == hyphon::kNoteOn) api.noteOn(h, e.target, e.value);
    else if (e.type == hyphon::kNoteOff) api.noteOff(h, e.target);
    else if (e.type == hyphon::kParam) api.setParam(h, e.target, e.value);
}

/** Immediate API, block split by hand at each event's frame. */
template <class Api>
std::vector<float> renderImmediate(Api& api, const std::vector<Ev>& evs, int total, int block) {
    const uintptr_t h = api.create();
    api.init(h, block);
    std::vector<float> out;
    int64_t pos = 0;
    auto renderTo = [&](int64_t end) {
        while (pos < end) {
            // Never cross a block boundary, so the split matches renderSplit's.
            const int64_t blockEnd = (pos / block + 1) * block;
            const int n = static_cast<int>(std::min(end, blockEnd) - pos);
            const float* buf = api.process(h, n);
            out.insert(out.end(), buf, buf + n);
            pos += n;
        }
    };
    for (const Ev& e : evs) {
        renderTo(e.at);
        applyImmediate(api, h, e);
    }
    renderTo(total);
    api.destroy(h);
    return out;
}

/** Event API: push everything up front, render whole blocks. */
template <class Api>
std::vector<float> renderEvents(Api& api, const std::vector<Ev>& evs, int total, int block, int64_t start) {
    const uintptr_t h = api.create();
    api.init(h, block);
    for (const Ev& e : evs) api.push(h, start + e.at, e.type, e.target, e.value);
    std::vector<float> out;
    for (int64_t b = 0; b * block < total; ++b) {
        const float* buf = api.render(h, start + b * block, block);
        if (!buf) break;
        out.insert(out.end(), buf, buf + block);
    }
    api.destroy(h);
    return out;
}

template <class Api>
void checkEventApi(const char* engine, Api& api, void (*check)(bool, const char*)) {
    std::printf("%s event API (#1344)\n", engine);
    constexpr int kBlock = 128;
    constexpr int kTotal = kBlock * 40;
    const int64_t start = 48000;  // one second into the context

    // Block-aligned: notes, an accent, a slide (noteOn over an open gate), params.
    const std::vector<Ev> aligned = {
        {0, hyphon::kParam, 2, 0.3f},
        {0, hyphon::kNoteOn, 36, 90.0f},
        {kBlock * 6, hyphon::kNoteOff, 36, 0.0f},
        {kBlock * 8, hyphon::kNoteOn, 48, 127.0f},
        {kBlock * 12, hyphon::kNoteOn, 43, 90.0f},
        {kBlock * 12, hyphon::kParam, 3, 0.8f},
        {kBlock * 20, hyphon::kNoteOff, 43, 0.0f},
        {kBlock * 20, hyphon::kNoteOff, 48, 0.0f},
    };
    check(renderEvents(api, aligned, kTotal, kBlock, start) == renderImmediate(api, aligned, kTotal, kBlock),
          "block-aligned events render bit-identical to the immediate API");

    // Mid-block, including a block's first and last frame and two events on one frame.
    const std::vector<Ev> mid = {
        {37, hyphon::kNoteOn, 36, 90.0f},
        {255, hyphon::kParam, 2, 0.6f},
        {255, hyphon::kNoteOn, 41, 127.0f},
        {769, hyphon::kParam, 4, 0.2f},
        {1024, hyphon::kNoteOff, 41, 0.0f},
        {1100, hyphon::kNoteOff, 36, 0.0f},
        {2000, hyphon::kNoteOn, 39, 100.0f},
        {3071, hyphon::kNoteOff, 39, 0.0f},
    };
    const auto evented = renderEvents(api, mid, kTotal, kBlock, start);
    const auto manual = renderImmediate(api, mid, kTotal, kBlock);
    check(evented.size() == static_cast<size_t>(kTotal) && evented == manual,
          "mid-block events render bit-identical to the immediate API split at those frames");

    // And they genuinely moved: rendering them at block starts sounds different.
    std::vector<Ev> snapped = mid;
    for (Ev& e : snapped) e.at = e.at / kBlock * kBlock;
    check(renderImmediate(api, snapped, kTotal, kBlock) != manual, "(control) the same events at block starts render differently");

    // Stop: a pending note is dropped, a pending param still lands.
    {
        const uintptr_t h = api.create();
        api.init(h, kBlock);
        api.push(h, start + 300, hyphon::kNoteOn, 36, 127.0f);
        api.push(h, start + 300, hyphon::kParam, 2, 0.9f);
        api.cancelNotes(h);
        std::vector<float> cancelled;
        for (int b = 0; b < 8; ++b) {
            const float* buf = api.render(h, start + int64_t{b} * kBlock, kBlock);
            if (!buf) break;  // the comparison below then fails on length
            cancelled.insert(cancelled.end(), buf, buf + kBlock);
        }
        api.destroy(h);
        const std::vector<Ev> paramOnly = {{300, hyphon::kParam, 2, 0.9f}};
        check(cancelled == renderImmediate(api, paramOnly, kBlock * 8, kBlock),
              "cancel_notes drops the pending note and keeps the pending param");
    }

    // Refusals.
    {
        const uintptr_t h = api.create();
        api.init(h, kBlock);
        check(api.render(h, start, kBlock * 4) == nullptr, "render refuses a block larger than init reserved");
        api.destroy(h);
        check(api.render(h, start, kBlock) == nullptr && api.push(h, start, hyphon::kNoteOn, 36, 90.0f) == 0,
              "a destroyed handle resolves to nothing");
    }
}

}  // namespace event_api_checks
