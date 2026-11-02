/**
 * emscripten/core/voice_exports.h — the generic C API every engine exports (#1344).
 *
 * HYPHON_EXPORT_VOICE(prefix, VoiceType, Slots) defines one VoiceSlots table
 * for `VoiceType` (a hyphon::NativeVoice<Engine, N>) and these exports:
 *
 *   uintptr_t prefix_create()
 *   void      prefix_destroy(uintptr_t h)
 *   int       prefix_init(uintptr_t h, float sampleRate, int maxFrames)       1 = ok
 *   int       prefix_push_event(uintptr_t h, double frame, int type, int target,
 *                               float value, float a0, float a1, float a2, float a3)
 *                                                                              1 = queued
 *   uintptr_t prefix_render(uintptr_t h, double blockStartFrame, int frames)  float*, 0 on error
 *   void      prefix_cancel_notes(uintptr_t h)
 *   void      prefix_flush(uintptr_t h)                                       apply all pending now
 *   uintptr_t prefix_event_inbox(uintptr_t h)                                 the voice's inbox ring, 0 on error
 *
 * plus `prefix_voice(h)`, a static accessor the engine's own exports use.
 * Frames cross the JS boundary as doubles (exact to 2^53): an int64 would be a
 * BigInt under WASM_BIGINT.
 *
 * prefix_event_inbox (#1497 P2) is the address of NativeVoice::inbox, an
 * EventRing laid out as src/shared/rt/eventRing.ts expects. On the pthread
 * build the worklet hands it, with the shared memory, to the main thread,
 * whose EventBus route then writes records into it in place; render, cancel
 * and flush take them from there. The address is fixed for the handle's life
 * (slots live in static storage), so close the route before destroying it.
 *
 * Every name above must be listed in emscripten/wasm_export_manifest.json;
 * src/__tests__/wasmExportManifest.voices.test.ts checks that for each use
 * of the macro, and build.sh exports exactly what the manifest lists.
 */
#pragma once

#include <emscripten.h>

#include <cstdint>

#include "voice.h"

#define HYPHON_EXPORT_VOICE(prefix, VoiceType, Slots)                                         \
    static hyphon::VoiceSlots<VoiceType, Slots> prefix##_slots;                               \
    static inline VoiceType* prefix##_voice(uintptr_t h) { return prefix##_slots.get(h); }    \
    extern "C" {                                                                              \
    EMSCRIPTEN_KEEPALIVE uintptr_t prefix##_create() { return prefix##_slots.create(); }      \
    EMSCRIPTEN_KEEPALIVE void prefix##_destroy(uintptr_t h) { prefix##_slots.destroy(h); }    \
    EMSCRIPTEN_KEEPALIVE int prefix##_init(uintptr_t h, float sampleRate, int maxFrames) {    \
        VoiceType* v = prefix##_voice(h);                                                     \
        if (!v) return 0;                                                                     \
        return v->init(sampleRate, maxFrames > 0 ? maxFrames : 128) ? 1 : 0;                  \
    }                                                                                         \
    EMSCRIPTEN_KEEPALIVE int prefix##_push_event(uintptr_t h, double frame, int type,         \
                                                 int target, float value, float a0, float a1, \
                                                 float a2, float a3) {                        \
        VoiceType* v = prefix##_voice(h);                                                     \
        if (!v) return 0;                                                                     \
        hyphon::Event e;                                                                      \
        e.frame = static_cast<int64_t>(frame);                                                \
        e.type = static_cast<uint16_t>(type);                                                 \
        e.target = static_cast<uint16_t>(target);                                             \
        e.value = value;                                                                      \
        e.args[0] = a0;                                                                       \
        e.args[1] = a1;                                                                       \
        e.args[2] = a2;                                                                       \
        e.args[3] = a3;                                                                       \
        return v->push(e) ? 1 : 0;                                                            \
    }                                                                                         \
    EMSCRIPTEN_KEEPALIVE uintptr_t prefix##_render(uintptr_t h, double blockStartFrame,       \
                                                   int frames) {                              \
        VoiceType* v = prefix##_voice(h);                                                     \
        if (!v) return 0;                                                                     \
        return reinterpret_cast<uintptr_t>(                                                   \
            v->process(static_cast<int64_t>(blockStartFrame), frames));                       \
    }                                                                                         \
    EMSCRIPTEN_KEEPALIVE void prefix##_cancel_notes(uintptr_t h) {                            \
        if (VoiceType* v = prefix##_voice(h)) v->cancelPendingNotes();                        \
    }                                                                                         \
    EMSCRIPTEN_KEEPALIVE void prefix##_flush(uintptr_t h) {                                   \
        if (VoiceType* v = prefix##_voice(h)) v->flush();                                     \
    }                                                                                         \
    EMSCRIPTEN_KEEPALIVE uintptr_t prefix##_event_inbox(uintptr_t h) {                        \
        VoiceType* v = prefix##_voice(h);                                                     \
        return v ? reinterpret_cast<uintptr_t>(v->inbox.data()) : 0;                          \
    }                                                                                         \
    }  // extern "C"
