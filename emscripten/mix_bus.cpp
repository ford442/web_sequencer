/**
 * Offline stereo mix bus (#1341).
 *
 * Built by emscripten/build_mix_bus.sh into public/mix_bus.wasm — its OWN
 * module, never linked into hyphon_native. It runs in a dedicated worker
 * (src/workers/mixBus.worker.ts) for stem export, so an offline mix can never
 * grow, share, or stall the live 303 voice heap.
 *
 * Shape: two fixed scratch blocks in static memory and nothing else. The
 * worker streams each stem through them a block at a time, which keeps the
 * module's memory a constant few MB however long the song is (no
 * ALLOW_MEMORY_GROWTH, no malloc, zero imports). The accumulator for a whole
 * stem lives in the worker's JS heap, not here.
 *
 * This is the one -ffast-math translation unit in the native build. That is
 * safe here and nowhere near a voice: there is no recursive filter state, the
 * accumulate is a single multiply-add per element (so reassociation cannot
 * reorder anything across samples), and the peak is a max-reduction written
 * with explicit f32x4.pmax (see mix_bus_peak). With gain == 1 the result is
 * bit-identical to the JS `dst[i] += src[i]` fallback.
 * See docs/wasm/BUILD_NOTES.md#mix-bus.
 *
 * No OpenMP: block mixing is memory-bound, and the worker is not CPU-bound
 * (the benchmark is in BUILD_NOTES). Add threads only with a measurement.
 */

#include <emscripten/emscripten.h>
#include <wasm_simd128.h>

namespace {

/** Bump when an export's meaning changes; the worker refuses a mismatch. */
constexpr int kAbiVersion = 1;

/** Frames per scratch block. 2 x 256 KiB. Kept in step with nothing else:
 *  the worker asks for it via mix_bus_block_frames(). */
constexpr int kBlockFrames = 65536;

alignas(16) float g_in[kBlockFrames];
alignas(16) float g_acc[kBlockFrames];

inline int clampFrames(int n) {
    if (n < 0) return 0;
    return n > kBlockFrames ? kBlockFrames : n;
}

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int mix_bus_abi_version() { return kAbiVersion; }

EMSCRIPTEN_KEEPALIVE int mix_bus_block_frames() { return kBlockFrames; }

/** Byte offset of the input scratch block in the module's memory. */
EMSCRIPTEN_KEEPALIVE float* mix_bus_in_ptr() { return g_in; }

/** Byte offset of the accumulator scratch block in the module's memory. */
EMSCRIPTEN_KEEPALIVE float* mix_bus_acc_ptr() { return g_acc; }

/** acc[i] += in[i] * gain, for the first n frames of the block. */
EMSCRIPTEN_KEEPALIVE void mix_bus_accumulate(int n, float gain) {
    const int frames = clampFrames(n);
    for (int i = 0; i < frames; i++) {
        g_acc[i] += g_in[i] * gain;
    }
}

/**
 * max |acc[i]| over the first n frames of the block.
 *
 * Written with f32x4.pmax, which is exactly the JS reference's
 * `if (a > peak) peak = a` (a NaN sample is skipped) and lowers to one maxps.
 * Left to the compiler, -ffast-math turns the comparison into f32x4.max, whose
 * NaN-propagating lowering made the -O3 -flto build ~30 % slower than the old
 * scalar loop (BUILD_NOTES#mix-bus).
 */
EMSCRIPTEN_KEEPALIVE float mix_bus_peak(int n) {
    const int frames = clampFrames(n);
    v128_t peak = wasm_f32x4_splat(0.0f);
    int i = 0;
    for (; i + 4 <= frames; i += 4) {
        peak = wasm_f32x4_pmax(peak, wasm_f32x4_abs(wasm_v128_load(&g_acc[i])));
    }
    for (; i < frames; i++) {
        peak = wasm_f32x4_pmax(peak, wasm_f32x4_abs(wasm_f32x4_splat(g_acc[i])));
    }
    peak = wasm_f32x4_pmax(peak, wasm_i32x4_shuffle(peak, peak, 2, 3, 0, 1));
    peak = wasm_f32x4_pmax(peak, wasm_i32x4_shuffle(peak, peak, 1, 0, 3, 2));
    return wasm_f32x4_extract_lane(peak, 0);
}

} // extern "C"
