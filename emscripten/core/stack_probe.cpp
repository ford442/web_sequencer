// Stack high-water probe for hyphon_native (#1596 follow-up, P1).
//
// Compiled into the DEBUG profile only (emscripten/build.sh adds it, and
// tools/hyphon_native_exports.mjs --profile debug adds the `debug` bucket of
// emscripten/wasm_export_manifest.json). It exists to size STACK_SIZE in
// emscripten/wasm_memory_budget.json from a measurement instead of a guess:
//
//   node tools/render_hyphon_native_parity.mjs stack \
//       --wasm public/hyphon_native.wasm --map public/hyphon_wasm_export_map.json
//
// How: hyphon_stack_paint() fills the unused part of the main stack with a
// pattern, the caller runs the worst-case voice set, and
// hyphon_stack_high_water() scans up from the stack limit for the first word
// that is no longer the pattern. The debug build is -O1, whose frames are at
// least as large as the -O3 release build's, so its number is an upper bound.
//
// The bounds come from the linker symbols, not emscripten_stack_get_end():
// the worklets instantiate the module by hand and never run
// emscripten_stack_init() / emscripten_stack_set_limits(), so the TLS limits
// those helpers read are zero on the pthread profile.

#include <emscripten/emscripten.h>
#include <emscripten/stack.h>
#include <stdint.h>

extern "C" {

extern char __stack_low[];
extern char __stack_high[];

static const uint32_t kStackPaint = 0xA5C3F00Du;
// Bytes below the current stack pointer left alone while painting: this
// function's own frame and anything a compiler-inserted prologue spills.
static const uintptr_t kPaintGuardBytes = 256;

/** Total main-stack reservation in bytes (STACK_SIZE). */
EMSCRIPTEN_KEEPALIVE uint32_t hyphon_stack_size(void) {
    return (uint32_t)(__stack_high - __stack_low);
}

/** Bytes between the current stack pointer and the stack limit. */
EMSCRIPTEN_KEEPALIVE uint32_t hyphon_stack_free(void) {
    return (uint32_t)(emscripten_stack_get_current() - (uintptr_t)__stack_low);
}

/** Paint the free stack so hyphon_stack_high_water() can find the deepest use. */
EMSCRIPTEN_KEEPALIVE void hyphon_stack_paint(void) {
    uintptr_t low = ((uintptr_t)__stack_low + 3u) & ~(uintptr_t)3u;
    uintptr_t top = (emscripten_stack_get_current() - kPaintGuardBytes) & ~(uintptr_t)3u;
    for (volatile uint32_t* p = (volatile uint32_t*)low; (uintptr_t)p < top; ++p) {
        *p = kStackPaint;
    }
}

/** Deepest stack use since the last paint, in bytes below the stack base. */
EMSCRIPTEN_KEEPALIVE uint32_t hyphon_stack_high_water(void) {
    uintptr_t low = ((uintptr_t)__stack_low + 3u) & ~(uintptr_t)3u;
    uintptr_t high = (uintptr_t)__stack_high;
    const volatile uint32_t* p = (const volatile uint32_t*)low;
    while ((uintptr_t)p < high && *p == kStackPaint) ++p;
    return (uint32_t)(high - (uintptr_t)p);
}

}  // extern "C"
