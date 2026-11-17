/**
 * Denormal tail test (#1596 follow-up P4).
 *
 * WebAssembly has no flush-to-zero mode. A filter or envelope ringing down after a
 * note decays into subnormal floats, and on x86 every operation that reads one
 * costs a ~100-cycle microcode assist: the block after a note can cost 10-100x the
 * block during it. The wrappers zero their recursive state below 1e-15 (-300 dBFS)
 * with hyphon::flushDenormal; this test proves it, per engine.
 *
 * One source, compiled once per engine (-DDT_ENGINE_<NAME>) by
 * run_offline_voices_test.sh, twice each: with the guards
 * (HYPHON_DENORMAL_GUARD=1, what ships) and without (=0, flushDenormal is the
 * identity). The x86 MXCSR "denormal operand" flag (DE) is read after every block
 * — the hardware's own record that a subnormal was consumed. It is the exact
 * thing that costs CPU, and deterministic where a timing threshold is not.
 *
 *   denormal_tail_test --dump <dir>      render, write <dir>/<engine>.f32, report
 *   denormal_tail_test --compare <dir>   guarded build only: also require the
 *                                         render to equal the unguarded one
 *                                         bit for bit until the tail
 *
 * Scenario: a note (or every drum hit) at frame 0, released at 0.5 s, then 60 s
 * of silence, in 128-frame blocks at 48 kHz. 60 s, not 10: rosic (jc303) keeps
 * its state in double, whose release tail only reaches the double subnormal range
 * ~35 s after note-off. (Its float OUTPUT went subnormal at ~4 s.)
 *
 * Asserted for the guarded build:
 *   - no block of the 60 s silent tail consumes a subnormal (DE stays clear);
 *   - per-block CPU through the tail stays flat: its mean is no more than 2x the
 *     sounding blocks' (loose — it guards against the 10-100x of a denormal tail,
 *     not scheduler noise);
 *   - with --compare: output is bit-identical to the unguarded build up to the
 *     tail — after the last sample whose unguarded magnitude reaches 2^-40
 *     (~ -240 dBFS) — and inside it the two never differ by more than 1e-9.
 * The unguarded build only reports, so the test log shows what each guard buys.
 */

#include <xmmintrin.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#if defined(DT_ENGINE_OPEN303)
#include "../open303_wrapper.cpp"
#define ENGINE open303
#define ENGINE_NAME "open303"
#elif defined(DT_ENGINE_JC303)
#include "../jc303_wrapper.cpp"
#define ENGINE jc303
#define ENGINE_NAME "jc303"
#elif defined(DT_ENGINE_HIGHFID303)
#include "../highfid303_wrapper.cpp"
#define ENGINE highfid303
#define ENGINE_NAME "highfid303"
#elif defined(DT_ENGINE_PROPHECY)
#include "../prophecy_wrapper.cpp"
#define ENGINE prophecy
#define ENGINE_NAME "prophecy"
#elif defined(DT_ENGINE_DRUMKIT)
#include "../drumkit_wrapper.cpp"
#define ENGINE drumkit
#define ENGINE_NAME "drumkit"
#else
#error "define one of DT_ENGINE_OPEN303 / _JC303 / _HIGHFID303 / _PROPHECY / _DRUMKIT"
#endif

#ifndef HYPHON_DENORMAL_GUARD
#error "build with -DHYPHON_DENORMAL_GUARD=0 or =1"
#endif

#define CAT2(a, b) a##b
#define CAT(a, b) CAT2(a, b)
#define API(suffix) CAT(ENGINE, suffix)

namespace {

constexpr float kSampleRate = 48000.0f;
constexpr int kBlock = 128;
constexpr int kNoteBlocks = static_cast<int>(0.5f * kSampleRate / kBlock);   // 187
constexpr int kTailBlocks = static_cast<int>(60.0f * kSampleRate / kBlock);  // 22500
constexpr unsigned kMxcsrDenormalFlag = 0x0002u;  // DE: an operand was subnormal
constexpr unsigned kMxcsrFlags = 0x003Fu;

int g_failures = 0;

void check(bool cond, const std::string& msg) {
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", msg.c_str());
    if (!cond) ++g_failures;
}

struct Render {
    std::vector<float> out;          // every channel of every block, in order
    std::vector<bool> denormalBlock; // DE set while rendering block b
    std::vector<double> blockNs;
    int channels = 1;
};

void scenario(uintptr_t h) {
#if defined(DT_ENGINE_DRUMKIT)
    // Every pad of both kits, at the parameters drumkit_offline_test uses.
    struct Hit { int kit, pad; float a, b, c, d; };
    const Hit hits[] = {
        {0, 0, 50.0f, 0.6f, 0.6f, 1.0f},     {1, 0, 65.0f, 0.35f, 0.8f, 1.0f},
        {0, 1, 200.0f, 0.3f, 2000.0f, 0.9f}, {1, 1, 300.0f, 0.2f, 4000.0f, 0.9f},
        {0, 2, 8000.0f, 0.05f, 0.7f, 0.0f},  {0, 3, 6500.0f, 0.5f, 0.7f, 0.0f},
    };
    double frame = 0;
    for (const Hit& hit : hits) {
        drumkit_push_event(h, frame, kDrumkitSetKit, hit.kit, 0, 0, 0, 0, 0);
        drumkit_push_event(h, frame, hyphon::kTrigger, hit.pad, 1.0f, hit.a, hit.b, hit.c, hit.d);
        frame += 0.05 * kSampleRate;
    }
#elif defined(DT_ENGINE_PROPHECY)
    prophecy_push_event(h, 0, hyphon::kNoteOn, 48, 1.0f, 0, 0, 0, 0);
    prophecy_push_event(h, kNoteBlocks * kBlock, hyphon::kNoteOff, 48, 0, 0, 0, 0, 0);
#else
    API(_push_event)(h, 0, hyphon::kNoteOn, 36, 120.0f, 0, 0, 0, 0);
    API(_push_event)(h, kNoteBlocks * kBlock, hyphon::kNoteOff, 36, 0, 0, 0, 0, 0);
#endif
}

Render render() {
    Render r;
    const uintptr_t h = API(_create)();
    check(h != 0 && API(_init)(h, kSampleRate, kBlock) == 1, ENGINE_NAME "_create + _init");
#if defined(DT_ENGINE_DRUMKIT)
    r.channels = 2;
#endif
    scenario(h);
    const int blocks = kNoteBlocks + kTailBlocks;
    r.out.reserve(static_cast<size_t>(blocks) * kBlock * r.channels);
    for (int b = 0; b < blocks; ++b) {
        _mm_setcsr(_mm_getcsr() & ~kMxcsrFlags);
        const auto t0 = std::chrono::steady_clock::now();
        const float* out = reinterpret_cast<const float*>(API(_render)(h, static_cast<double>(b) * kBlock, kBlock));
        const auto t1 = std::chrono::steady_clock::now();
        r.denormalBlock.push_back((_mm_getcsr() & kMxcsrDenormalFlag) != 0);
        r.blockNs.push_back(std::chrono::duration<double, std::nano>(t1 - t0).count());
        if (!out) {
            check(false, "render returned null");
            break;
        }
        r.out.insert(r.out.end(), out, out + kBlock * r.channels);
    }
    API(_destroy)(h);
    return r;
}

double mean(const std::vector<double>& v, size_t from, size_t to) {
    double s = 0;
    for (size_t i = from; i < to; ++i) s += v[i];
    return to > from ? s / static_cast<double>(to - from) : 0.0;
}

}  // namespace

int main(int argc, char** argv) {
    std::string dumpDir;
    std::string compareDir;
    for (int i = 1; i + 1 < argc; ++i) {
        if (std::strcmp(argv[i], "--dump") == 0) dumpDir = argv[++i];
        else if (std::strcmp(argv[i], "--compare") == 0) compareDir = argv[++i];
    }
    std::printf("denormal_tail_test [%s, guards %s]\n", ENGINE_NAME, HYPHON_DENORMAL_GUARD ? "on" : "off");

    // Best of three for the timing (the flags are deterministic).
    Render r = render();
    for (int pass = 0; pass < 2; ++pass) {
        Render again = render();
        for (size_t b = 0; b < r.blockNs.size() && b < again.blockNs.size(); ++b) {
            r.blockNs[b] = std::min(r.blockNs[b], again.blockNs[b]);
        }
    }

    int noteDenormal = 0;
    int tailDenormal = 0;
    int firstTail = -1;
    for (size_t b = 0; b < r.denormalBlock.size(); ++b) {
        if (!r.denormalBlock[b]) continue;
        if (static_cast<int>(b) < kNoteBlocks) ++noteDenormal;
        else {
            ++tailDenormal;
            if (firstTail < 0) firstTail = static_cast<int>(b - kNoteBlocks);
        }
    }
    const double noteNs = mean(r.blockNs, 0, kNoteBlocks);
    const double tailNs = mean(r.blockNs, kNoteBlocks, r.blockNs.size());
    std::printf("  blocks consuming subnormals: %d of %d sounding, %d of %d silent", noteDenormal, kNoteBlocks,
                tailDenormal, kTailBlocks);
    if (firstTail >= 0) std::printf(" (first %.2f s into the tail)", firstTail * kBlock / kSampleRate);
    std::printf("\n  mean block: %.0f ns sounding, %.0f ns tail (%.2fx)\n", noteNs, tailNs, tailNs / noteNs);

    if (!dumpDir.empty()) {
        const std::string path = dumpDir + "/" + ENGINE_NAME + ".f32";
        if (FILE* f = std::fopen(path.c_str(), "wb")) {
            std::fwrite(r.out.data(), sizeof(float), r.out.size(), f);
            std::fclose(f);
        }
    }

#if HYPHON_DENORMAL_GUARD
    check(tailDenormal == 0, "no silent-tail block consumes a subnormal (MXCSR DE clear)");
    check(tailNs <= 2.0 * noteNs, "per-block CPU stays flat through the 60 s tail (mean <= 2x sounding)");
    if (!compareDir.empty()) {
        std::vector<float> ref(r.out.size());
        const std::string path = compareDir + "/" + ENGINE_NAME + ".f32";
        FILE* f = std::fopen(path.c_str(), "rb");
        const size_t got = f ? std::fread(ref.data(), sizeof(float), ref.size(), f) : 0;
        if (f) std::fclose(f);
        check(got == ref.size(), "read the unguarded render");
        // The tail: everything after the last sample at or above 2^-40.
        size_t tail = 0;
        for (size_t i = ref.size(); i-- > 0;) {
            if (std::fabs(ref[i]) >= 0x1p-40f) {
                tail = i + 1;
                break;
            }
        }
        size_t firstDiff = ref.size();
        float maxDiff = 0.0f;
        for (size_t i = 0; i < ref.size(); ++i) {
            const float d = std::fabs(ref[i] - r.out[i]);
            if (d != 0.0f && firstDiff == ref.size()) firstDiff = i;
            maxDiff = std::max(maxDiff, d);
        }
        std::printf("  vs unguarded: first difference at sample %zu, tail (|x| < 2^-40 for good) from %zu, max |diff| %.3g\n",
                    firstDiff, tail, static_cast<double>(maxDiff));
        check(firstDiff >= tail, "bit-identical to the unguarded build until the tail");
        check(maxDiff <= 1.0e-9f, "never more than 1e-9 apart after it (-180 dBFS)");
    }
#endif
    std::printf("%s\n", g_failures ? "denormal_tail_test: FAILED" : "denormal_tail_test: all passed");
    return g_failures ? 1 : 0;
}
