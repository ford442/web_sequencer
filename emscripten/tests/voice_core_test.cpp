/**
 * Host test for the shared voice core (emscripten/core/voice.h, issue #1344 P2).
 *
 * Asserts:
 *   - renderSplit lands every event on its exact frame, in frame order, with
 *     same-frame events in push order; late events land on frame 0
 *   - a drum hit and a 303 note scheduled on one frame start on the same
 *     sample, whatever the block alignment (the #1344 acceptance, core level)
 *   - EventRing is FIFO, refuses rather than overwrites when full, and holds
 *     up under a real two-thread producer/consumer
 *   - VoiceSlots handles resolve in O(1) and go stale on destroy, even after
 *     the slot is reused
 *   - NativeVoice::process neither allocates nor grows its buffer
 *   - Smoothed follows the RC curve and settles exactly; flushDenormal keeps
 *     feedback state out of the subnormal range
 *
 * Built with -fno-exceptions -fno-rtti, the flags the core promises to accept.
 * Usage (via emscripten/tests/run_offline_voices_test.sh):
 *   g++ -std=c++17 -fno-exceptions -fno-rtti -pthread \
 *       emscripten/tests/voice_core_test.cpp -o /tmp/voice_core_test
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <thread>

#include "../core/voice.h"

using namespace hyphon;

// ── Allocation counter ──────────────────────────────────────────────────────
// Interposes the glibc allocator so "process does not allocate" is measured,
// not assumed. operator new goes through malloc, so this catches it too.
// Skipped under a sanitizer (which owns the allocator) and off glibc.

#if defined(__GLIBC__) && !defined(__SANITIZE_ADDRESS__) && !defined(__SANITIZE_THREAD__)
#define VOICE_CORE_COUNT_ALLOCS 1
static volatile bool g_countAllocs = false;
static volatile unsigned long g_allocs = 0;

extern "C" {
void* __libc_malloc(size_t);
void* __libc_calloc(size_t, size_t);
void* __libc_realloc(void*, size_t);
void* __libc_memalign(size_t, size_t);

void* malloc(size_t n) {
    if (g_countAllocs) g_allocs = g_allocs + 1;
    return __libc_malloc(n);
}
void* calloc(size_t n, size_t size) {
    if (g_countAllocs) g_allocs = g_allocs + 1;
    return __libc_calloc(n, size);
}
void* realloc(void* p, size_t n) {
    if (g_countAllocs) g_allocs = g_allocs + 1;
    return __libc_realloc(p, n);
}
void* aligned_alloc(size_t align, size_t n) {
    if (g_countAllocs) g_allocs = g_allocs + 1;
    return __libc_memalign(align, n);
}
int posix_memalign(void** out, size_t align, size_t n) {
    if (g_countAllocs) g_allocs = g_allocs + 1;
    void* p = __libc_memalign(align, n);
    if (!p) return 12;  // ENOMEM
    *out = p;
    return 0;
}
}
#endif

namespace {

constexpr int BLOCK = 128;

int g_failures = 0;

void check(bool cond, const char* msg) {
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", msg);
    if (!cond) ++g_failures;
}

/**
 * Test engine: writes 1.0 on the first sample after a noteOn / trigger and
 * 0.0 elsewhere, and logs what it applied with the frame it was applied at.
 * Its frame counter starts at whatever block the test renders first.
 */
struct ProbeEngine {
    static constexpr int kLog = 64;
    int64_t frame = 0;
    float level = 0.0f;  // param 0
    bool impulse = false;
    int count = 0;
    int64_t atFrame[kLog]{};
    uint16_t type[kLog]{};
    float levelAt[kLog]{};

    bool init(float, int) { return true; }

    void apply(const Event& e) {
        if (e.type == kParam && e.target == 0) level = e.value;
        if (e.type == kNoteOn || e.type == kTrigger) impulse = true;
        if (count < kLog) {
            atFrame[count] = frame;
            type[count] = e.type;
            levelAt[count] = level;
            ++count;
        }
    }

    void render(float* out, int frames) {
        for (int i = 0; i < frames; ++i) {
            out[i] = impulse ? 1.0f : 0.0f;
            impulse = false;
            ++frame;
        }
    }
};

using ProbeVoice = NativeVoice<ProbeEngine, 64>;

Event noteOn(int64_t frame, uint16_t note = 36) {
    Event e;
    e.frame = frame;
    e.type = kNoteOn;
    e.target = note;
    e.value = 1.0f;
    return e;
}

Event noteOff(int64_t frame, uint16_t note = 36) {
    Event e;
    e.frame = frame;
    e.type = kNoteOff;
    e.target = note;
    return e;
}

Event param(int64_t frame, float value) {
    Event e;
    e.frame = frame;
    e.type = kParam;
    e.target = 0;
    e.value = value;
    return e;
}

Event trigger(int64_t frame) {
    Event e;
    e.frame = frame;
    e.type = kTrigger;
    e.value = 1.0f;
    return e;
}

/** Renders [start, start + blocks * blockSize) and returns the frames that carried an impulse. */
template <int N>
int renderOnsets(ProbeVoice& v, int64_t start, int blocks, int blockSize, int64_t (&onsets)[N]) {
    int n = 0;
    v.engine.frame = start;
    for (int b = 0; b < blocks; ++b) {
        const int64_t blockStart = start + static_cast<int64_t>(b) * blockSize;
        float* out = v.process(blockStart, blockSize);
        if (!out) return -1;
        for (int i = 0; i < blockSize; ++i) {
            if (out[i] != 0.0f && n < N) onsets[n++] = blockStart + i;
        }
    }
    return n;
}

void testSampleAccurateOnsets() {
    std::printf("renderSplit: sample-accurate onsets\n");
    ProbeVoice v;
    check(v.init(48000.0f, BLOCK), "init");

    // One second into the context, pushed out of order on purpose.
    const int64_t s = 48000;
    const int64_t frames[] = {s + 1000, s + 0, s + 127, s + 256, s + 1, s + 128, s + 255, s + 200};
    for (int64_t f : frames) v.push(noteOn(f));

    int64_t onsets[16];
    const int n = renderOnsets(v, s, 10, BLOCK, onsets);
    const int64_t expected[] = {s + 0, s + 1, s + 127, s + 128, s + 200, s + 255, s + 256, s + 1000};
    bool exact = n == 8;
    for (int i = 0; exact && i < 8; ++i) exact = onsets[i] == expected[i];
    check(exact, "every noteOn sounds on its own frame (block edges, mid-block, frame 0)");
    check(v.stats.applied == 8 && v.stats.late == 0, "8 applied, none late");
    check(v.schedule.size() == 0, "schedule drained");
}

void testEventOrder() {
    std::printf("renderSplit: ordering\n");
    ProbeVoice v;
    v.init(48000.0f, BLOCK);
    v.engine.frame = 0;

    // playSynth posts a long note's noteOff before the next step's noteOn.
    v.push(noteOn(10));
    v.push(noteOff(300));
    v.push(noteOn(150));
    // Same frame: param then noteOn — the note sees the new level.
    v.push(param(400, 0.25f));
    v.push(noteOn(400));
    // Same frame: noteOn then param — the note sees the old level.
    v.push(noteOn(500));
    v.push(param(500, 0.75f));
    // Exactly on a block boundary: belongs to the next block, not late.
    v.push(noteOn(512));

    int64_t onsets[16];
    renderOnsets(v, 0, 6, BLOCK, onsets);

    const ProbeEngine& e = v.engine;
    const int64_t wantFrame[] = {10, 150, 300, 400, 400, 500, 500, 512};
    const uint16_t wantType[] = {kNoteOn, kNoteOn, kNoteOff, kParam, kNoteOn, kNoteOn, kParam, kNoteOn};
    bool ok = e.count == 8;
    for (int i = 0; ok && i < 8; ++i) ok = e.atFrame[i] == wantFrame[i] && e.type[i] == wantType[i];
    check(ok, "applied in frame order despite out-of-order pushes; ties keep push order");
    check(e.levelAt[4] == 0.25f, "param pushed before a same-frame noteOn is in effect for it");
    check(e.levelAt[5] == 0.25f, "param pushed after a same-frame noteOn is not");
    check(v.stats.late == 0, "an event on the block boundary is not late");
}

void testLateEvents() {
    std::printf("renderSplit: late events\n");
    ProbeVoice v;
    v.init(48000.0f, BLOCK);
    int64_t onsets[4];
    renderOnsets(v, 0, 2, BLOCK, onsets);

    // Arrives after its frame has been rendered.
    v.push(noteOn(50));
    float* out = v.process(256, BLOCK);
    check(out && out[0] == 1.0f, "a late noteOn sounds on the next block's first frame");
    check(v.stats.late == 1, "and is counted late");
}

void testDrumAnd303OnOneFrame() {
    std::printf("acceptance: drum + 303 on one frame\n");
    // Same frame, every alignment against the block grid, including block sizes
    // other than 128 (renderSizeHint). Both voices must start on the same sample.
    bool aligned = true;
    const int blockSizes[] = {128, 256, 96};
    for (int bs : blockSizes) {
        for (int offset = 0; offset < bs && aligned; offset += 7) {
            ProbeVoice drum;
            ProbeVoice bass;
            drum.init(44100.0f, bs);
            bass.init(44100.0f, bs);
            const int64_t start = 441000;
            const int64_t at = start + bs + offset;
            drum.push(trigger(at));
            bass.push(param(at, 0.5f));
            bass.push(noteOn(at));
            int64_t d[4], b[4];
            const int nd = renderOnsets(drum, start, 4, bs, d);
            const int nb = renderOnsets(bass, start, 4, bs, b);
            aligned = nd == 1 && nb == 1 && d[0] == at && b[0] == at;
        }
    }
    check(aligned, "onset delta 0 frames at every in-block offset (block sizes 128/256/96)");
}

void testCancelPendingNotes() {
    std::printf("NativeVoice: cancelPendingNotes\n");
    ProbeVoice v;
    v.init(48000.0f, BLOCK);
    v.push(noteOn(10));
    v.push(param(20, 0.5f));
    v.push(noteOff(30));
    v.push(trigger(40));
    v.cancelPendingNotes();
    int64_t onsets[4];
    const int n = renderOnsets(v, 0, 1, BLOCK, onsets);
    check(n == 0, "no note or trigger sounds after a stop");
    check(v.engine.count == 1 && v.engine.type[0] == kParam && v.engine.level == 0.5f,
          "the scheduled param still lands");
}

void testFlush() {
    std::printf("NativeVoice: flush\n");
    ProbeVoice v;
    v.init(48000.0f, BLOCK);
    v.engine.frame = 0;
    v.push(param(1000, 0.25f));
    v.push(noteOn(500));
    v.push(param(2000, 0.75f));
    v.flush();
    const ProbeEngine& e = v.engine;
    check(e.count == 3 && e.type[0] == kNoteOn && e.type[1] == kParam && e.type[2] == kParam,
          "applies every pending event now, in frame order");
    check(e.level == 0.75f && v.schedule.size() == 0, "leaves the latest value and an empty schedule");
}

void testMonoNoteEngine() {
    std::printf("MonoNoteEngine\n");
    using MonoVoice = NativeVoice<MonoNoteEngine<ProbeEngine>, 64>;
    const float sr = 1000.0f;  // 8 s max hold = 8000 frames
    MonoVoice v;
    v.init(sr, BLOCK);
    v.engine.inner.frame = 0;
    const ProbeEngine& e = v.engine.inner;
    auto render = [&](int blocks, int64_t start) {
        for (int b = 0; b < blocks; ++b) v.process(start + int64_t{b} * BLOCK, BLOCK);
    };

    v.push(noteOn(10, 36));
    v.push(noteOff(300, 36));   // superseded below
    v.push(noteOn(200, 43));    // over the held 36
    v.push(noteOff(400, 43));
    render(4, 0);
    bool ok = e.count == 4 &&
              e.type[0] == kNoteOn && e.atFrame[0] == 10 &&
              e.type[1] == kNoteOff && e.atFrame[1] == 200 &&  // 36 released on 43's frame
              e.type[2] == kNoteOn && e.atFrame[2] == 200 &&
              e.type[3] == kNoteOff && e.atFrame[3] == 400;    // 36's own noteOff at 300 dropped
    check(ok, "a noteOn over a held note releases it first; the stale noteOff is dropped");

    Event all;
    all.type = kAllNotesOff;
    all.frame = 600;
    v.push(noteOn(520, 40));
    v.push(all);
    render(2, 512);
    check(e.count == 6 && e.type[5] == kNoteOff && e.atFrame[5] == 600, "kAllNotesOff releases the held note on its frame");

    v.push(noteOn(1000, 45));  // never released by the stream
    render(80, 768);           // through frame 10'008
    check(e.count == 8 && e.type[7] == kNoteOff && e.atFrame[7] == 1000 + 8000,
          "a note held for 8 s is released on exactly that frame");

    // Blocks above were contiguous from frame 0, so the probe's frame counter
    // is the absolute frame; carry on from 11'008.
    v.push(noteOn(11100, 47));
    render(1, 11008);
    v.engine.forget();  // what an immediate all-notes-off does to the wrapper
    v.push(noteOff(11300, 47));
    render(3, 11136);
    check(e.count == 9, "after forget(), a late noteOff for the dropped note is ignored");
}

void testRing() {
    std::printf("EventRing\n");
    EventRing<8> ring;
    bool fifo = true;
    for (int round = 0; round < 5; ++round) {  // wraps the indices several times
        for (int i = 0; i < 8; ++i) fifo = fifo && ring.push(noteOn(round * 100 + i));
        Event e;
        for (int i = 0; i < 8; ++i) fifo = fifo && ring.pop(e) && e.frame == round * 100 + i;
        fifo = fifo && !ring.pop(e);
    }
    check(fifo, "FIFO across index wrap-around");

    for (int i = 0; i < 8; ++i) ring.push(noteOn(i));
    check(!ring.push(noteOn(99)), "a full ring refuses the push");
    check(ring.dropped() == 1, "and counts it");
    Event e;
    ring.pop(e);
    check(e.frame == 0, "without overwriting the oldest event");

    EventSchedule<4> sched;
    for (int i = 0; i < 5; ++i) sched.insert(noteOn(i));
    check(sched.size() == 4 && sched.dropped() == 1, "a full schedule refuses and counts");
}

void testRingThreads() {
    std::printf("EventRing: two threads\n");
    static EventRing<256> ring;
    constexpr int64_t kEvents = 200000;
    std::thread producer([] {
        for (int64_t i = 0; i < kEvents;) {
            if (ring.push(noteOn(i))) ++i;
            else std::this_thread::yield();
        }
    });
    int64_t expect = 0;
    bool inOrder = true;
    Event e;
    while (expect < kEvents) {
        if (ring.pop(e)) {
            inOrder = inOrder && e.frame == expect && e.type == kNoteOn;
            ++expect;
        } else {
            std::this_thread::yield();
        }
    }
    producer.join();
    check(inOrder, "200k events arrive complete and in order (refused pushes retried)");
}

struct Tagged {
    int id;
    static int destroyed;
    explicit Tagged(int i) : id(i) {}
    ~Tagged() { ++destroyed; }
};
int Tagged::destroyed = 0;

void testSlots() {
    std::printf("VoiceSlots\n");
    VoiceSlots<Tagged, 3> slots;
    const uintptr_t a = slots.create(1);
    const uintptr_t b = slots.create(2);
    const uintptr_t c = slots.create(3);
    check(a && b && c && a != b && b != c, "distinct non-zero handles");
    check(slots.create(4) == 0, "0 when full");
    check(slots.get(a)->id == 1 && slots.get(b)->id == 2 && slots.get(c)->id == 3, "each handle resolves to its instance");
    check(slots.get(0) == nullptr && slots.get(0xFF) == nullptr, "0 and an out-of-range index resolve to nothing");

    slots.destroy(b);
    check(Tagged::destroyed == 1 && slots.get(b) == nullptr, "destroy runs the destructor and invalidates the handle");
    const uintptr_t d = slots.create(5);
    check(d != 0 && d != b, "a reused slot hands out a new handle");
    check(slots.get(b) == nullptr && slots.get(d)->id == 5, "the stale handle stays dead after reuse");
    slots.destroy(b);
    check(slots.get(d) != nullptr && slots.liveCount() == 3, "destroying a stale handle is a no-op");
}

void testBufferAndOverrun() {
    std::printf("BlockBuffer\n");
    ProbeVoice v;
    v.init(48000.0f, BLOCK);
    check((reinterpret_cast<uintptr_t>(v.buffer.data()) % 16) == 0, "16-byte aligned");
    float* const before = v.buffer.data();
    check(v.process(0, BLOCK * 2) == nullptr, "a block larger than reserved is refused");
    check(v.stats.overruns == 1 && v.buffer.data() == before && v.buffer.capacity() == BLOCK,
          "counted, and the buffer was not regrown on the audio thread");
    check(v.process(0, 64) == before, "smaller blocks reuse the same buffer");
}

void testNoAllocation() {
    std::printf("real-time hygiene\n");
#ifdef VOICE_CORE_COUNT_ALLOCS
    static ProbeVoice v;  // static: the voice itself is not what we are measuring
    v.init(48000.0f, BLOCK);
    g_allocs = 0;
    g_countAllocs = true;
    for (int b = 0; b < 10000; ++b) {
        const int64_t start = static_cast<int64_t>(b) * BLOCK;
        v.push(param(start + 3, 0.1f));
        v.push(noteOn(start + 64));
        v.push(noteOff(start + 300));
        if (b % 97 == 0) v.cancelPendingNotes();
        v.process(start, BLOCK);
    }
    g_countAllocs = false;
    check(g_allocs == 0, "10k blocks of push + process + cancel: 0 heap allocations");

    // The counter itself works.
    g_countAllocs = true;
    void* p = std::malloc(16);
    g_countAllocs = false;
    std::free(p);
    check(g_allocs == 1, "allocation counter sees a malloc");
#else
    std::printf("  [SKIP] allocation counting needs glibc without a sanitizer\n");
#endif
}

void testSmoothed() {
    std::printf("Smoothed\n");
    const float sr = 48000.0f;
    Smoothed s;
    s.setTime(0.01f, sr);
    s.reset(0.0f);
    s.set(1.0f);
    for (int i = 0; i < 480; ++i) s.next();
    check(std::fabs(s.cur - (1.0f - std::exp(-1.0f))) < 2e-3f, "63% of a step after one time constant");

    Smoothed a, b;
    a.setTime(0.005f, sr);
    b.setTime(0.005f, sr);
    a.reset(200.0f);
    b.reset(200.0f);
    a.set(8000.0f);
    b.set(8000.0f);
    for (int i = 0; i < 64; ++i) a.next();
    b.advance(64);
    check(std::fabs(a.cur - b.cur) <= 1e-3f * 8000.0f, "advance(64) matches 64 next() steps");

    for (int i = 0; i < 48000 && !a.settled(); ++i) a.next();
    check(a.settled() && a.cur == 8000.0f, "settles exactly on target");

    Smoothed instant;
    instant.reset(0.0f);
    instant.set(0.5f);
    check(instant.next() == 0.5f, "unset time constant jumps straight to target");
}

void testDenormals() {
    std::printf("flushDenormal\n");
    float raw = 1.0f;
    bool rawWentSubnormal = false;
    float guarded = 1.0f;
    bool guardedWentSubnormal = false;
    for (int i = 0; i < 400; ++i) {
        raw *= 0.5f;
        guarded = flushDenormal(guarded * 0.5f);
        rawWentSubnormal = rawWentSubnormal || std::fpclassify(raw) == FP_SUBNORMAL;
        guardedWentSubnormal = guardedWentSubnormal || std::fpclassify(guarded) == FP_SUBNORMAL;
    }
    check(rawWentSubnormal, "(control) an unguarded decay passes through the subnormal range");
    check(!guardedWentSubnormal && guarded == 0.0f, "a guarded decay never does and reaches exactly 0");
}

}  // namespace

int main() {
    testSampleAccurateOnsets();
    testEventOrder();
    testLateEvents();
    testDrumAnd303OnOneFrame();
    testCancelPendingNotes();
    testFlush();
    testMonoNoteEngine();
    testRing();
    testRingThreads();
    testSlots();
    testBufferAndOverrun();
    testNoAllocation();
    testSmoothed();
    testDenormals();

    if (g_failures) {
        std::printf("\nvoice_core_test: %d check(s) FAILED\n", g_failures);
        return 1;
    }
    std::printf("\nvoice_core_test: all checks passed\n");
    return 0;
}
