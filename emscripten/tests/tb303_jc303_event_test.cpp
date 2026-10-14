/**
 * Event-API host test for the rosic jc303 voice on the shared voice core
 * (issue #1344 P3). The checks live in event_api_checks.h; this TU supplies
 * the jc303 adapter and needs the jc303_wasm rosic sources (see
 * run_offline_voices_test.sh).
 */

#include <cstdint>
#include <cstdio>
#include <vector>

#include "../jc303_wrapper.cpp"
#include "event_api_checks.h"

namespace {

int g_failures = 0;

void check(bool cond, const char* msg) {
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", msg);
    if (!cond) ++g_failures;
}

/** jc303's C API for event_api_checks.h. */
struct EventApi {
    static constexpr bool kMono = true;  // MonoNoteEngine-wrapped
    uintptr_t create() { return jc303_create(); }
    void init(uintptr_t h, int block) { jc303_init_handle(h, 48000.0f, block); }
    void destroy(uintptr_t h) { jc303_destroy(h); }
    void noteOn(uintptr_t h, int note, float vel) { jc303_note_on(h, note, vel); }
    void noteOff(uintptr_t h, int note) { jc303_note_off(h, note); }
    void setParam(uintptr_t h, int id, float v) { jc303_set_param(h, id, v); }
    const float* process(uintptr_t h, int n) {
        return reinterpret_cast<const float*>(jc303_process_handle(h, n));
    }
    int push(uintptr_t h, int64_t frame, uint16_t type, int target, float value) {
        return jc303_push_event(h, static_cast<double>(frame), type, target, value, 0, 0, 0, 0);
    }
    const float* render(uintptr_t h, int64_t blockStart, int n) {
        return reinterpret_cast<const float*>(jc303_render(h, static_cast<double>(blockStart), n));
    }
    void cancelNotes(uintptr_t h) { jc303_cancel_notes(h); }
};

}  // namespace

int main() {
    EventApi api;
    event_api_checks::checkEventApi("jc303", api, &check);
    std::printf("\n%s (%d failure%s)\n",
                g_failures == 0 ? "ALL PASSED" : "FAILED",
                g_failures, g_failures == 1 ? "" : "s");
    return g_failures == 0 ? 0 : 1;
}
