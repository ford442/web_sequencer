/**
 * emscripten/core/voice.h — the shared voice contract for hyphon_native (#1344).
 *
 * Header-only C++17. No embind, no exceptions, no RTTI, and no allocation once
 * an instance is initialised. open303, jc303, highfid303, prophecy and drumkit
 * each re-implemented handle maps, output buffers and event timing by hand;
 * this header is the one copy they port onto (#1344 P3).
 *
 *   Event              one timed message: frame, type, target, value, 4 args
 *   EventRing          SPSC transport, preallocated; the producer may live on
 *                      another thread
 *   EventSchedule      frame-sorted pending events: producers post out of
 *                      order (a note's noteOff goes out before the next note)
 *   renderSplit        renders a block, splitting it at each event's frame
 *   BlockBuffer        one owned, 16-byte-aligned output buffer per instance
 *   VoiceSlots         fixed slot array; handle = index + generation, O(1)
 *   NativeVoice<E>     everything one handle owns: engine + ring + schedule +
 *                      buffer + stats
 *   Smoothed           one-pole parameter smoother
 *   flushDenormal      zero tiny recursive state (wasm can't set FTZ)
 *
 * Timing. The worklet converts audioTime to an absolute frame on the
 * AudioContext clock, frameAt(audioTime, sampleRate), and passes each block's
 * first frame (currentTime * sampleRate, exact) to process. An event lands on
 * its own frame inside the block. One whose frame has already passed lands on
 * frame 0 and is counted late. Events on the same frame apply in push order,
 * so a param pushed before a noteOn is in effect for that note.
 *
 * Engine concept (what NativeVoice<Engine> calls; none of it may allocate
 * except init):
 *   bool init(float sampleRate, int maxFrames);
 *   void render(float* out, int frames);    // mono; any frames >= 1
 *   void apply(const hyphon::Event& e);
 *
 * Denormals. WebAssembly has no flush-to-zero mode and -ffast-math is not an
 * option for recursive filters (docs/wasm/BUILD_NOTES.md#fast-math), so
 * feedback paths clamp their state with flushDenormal().
 */
#pragma once

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <new>
#include <type_traits>
#include <utility>

namespace hyphon {

// ── Events ──────────────────────────────────────────────────────────────────

enum EventType : uint16_t {
    kNoteOn      = 1,  // target = MIDI note, value = velocity (engine's scale)
    kNoteOff     = 2,  // target = MIDI note
    kAllNotesOff = 3,
    kParam       = 4,  // target = engine param id, value = new value
    kTrigger     = 5,  // target = pad / voice, value = velocity, args engine-defined
    kEngine      = 0x100,  // first engine-private type (e.g. a hat choke)
};

struct Event {
    int64_t  frame  = 0;  // absolute frame on the AudioContext clock
    uint16_t type   = 0;  // EventType
    uint16_t target = 0;
    float    value  = 0.0f;
    float    args[4] = {0.0f, 0.0f, 0.0f, 0.0f};
};
static_assert(sizeof(Event) == 32, "Event layout is shared with the JS side");
static_assert(std::is_trivially_copyable<Event>::value, "Event is copied by value through the ring");

/** True for events a stop / mute cancels: anything that starts or ends a sound. */
inline bool isNoteEvent(const Event& e) {
    return e.type == kNoteOn || e.type == kNoteOff || e.type == kTrigger;
}

/** audioTime (seconds) → absolute frame. Exact for times a worklet produces. */
inline int64_t frameAt(double seconds, double sampleRate) {
    return static_cast<int64_t>(std::llround(seconds * sampleRate));
}

// ── EventRing: single producer, single consumer ─────────────────────────────

/**
 * Lock-free FIFO with a fixed power-of-two capacity. push() is the producer
 * side, pop() the consumer (audio) side; each side may run on its own thread.
 * A full ring refuses the push and counts it — it never overwrites.
 */
template <uint32_t Capacity>
class EventRing {
    static_assert(Capacity >= 2 && (Capacity & (Capacity - 1)) == 0, "capacity must be a power of two");

public:
    bool push(const Event& e) {
        const uint32_t w = write_.load(std::memory_order_relaxed);
        const uint32_t r = read_.load(std::memory_order_acquire);
        if (w - r == Capacity) {
            dropped_.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        slots_[w & (Capacity - 1)] = e;
        write_.store(w + 1, std::memory_order_release);
        return true;
    }

    bool pop(Event& out) {
        const uint32_t r = read_.load(std::memory_order_relaxed);
        const uint32_t w = write_.load(std::memory_order_acquire);
        if (r == w) return false;
        out = slots_[r & (Capacity - 1)];
        read_.store(r + 1, std::memory_order_release);
        return true;
    }

    uint32_t size() const {
        return write_.load(std::memory_order_acquire) - read_.load(std::memory_order_acquire);
    }

    uint32_t dropped() const { return dropped_.load(std::memory_order_relaxed); }

private:
    Event slots_[Capacity];
    alignas(64) std::atomic<uint32_t> write_{0};
    alignas(64) std::atomic<uint32_t> read_{0};
    std::atomic<uint32_t> dropped_{0};
};

// ── EventSchedule: pending events in frame order ────────────────────────────

/**
 * Audio-thread side. Holds events until their frame, sorted by frame and
 * stable — events on one frame keep their push order. Insertion scans from
 * the back, so the usual nearly-in-order stream costs O(1) per event.
 */
template <uint32_t Capacity>
class EventSchedule {
public:
    bool insert(const Event& e) {
        if (count_ == Capacity) {
            ++dropped_;
            return false;
        }
        uint32_t i = count_;
        while (i > 0 && events_[i - 1].frame > e.frame) {
            events_[i] = events_[i - 1];
            --i;
        }
        events_[i] = e;
        ++count_;
        return true;
    }

    /** Moves everything the ring holds into the schedule. Consumer side. */
    template <uint32_t RingCapacity>
    void absorb(EventRing<RingCapacity>& ring) {
        Event e;
        while (ring.pop(e)) insert(e);
    }

    uint32_t size() const { return count_; }
    const Event& operator[](uint32_t i) const { return events_[i]; }

    /** Drops the first n events (the ones a block just applied). */
    void erasePrefix(uint32_t n) {
        if (n == 0) return;
        if (n >= count_) {
            count_ = 0;
            return;
        }
        std::memmove(events_, events_ + n, (count_ - n) * sizeof(Event));
        count_ -= n;
    }

    template <class Pred>
    void removeIf(Pred pred) {
        uint32_t kept = 0;
        for (uint32_t i = 0; i < count_; ++i) {
            if (!pred(events_[i])) events_[kept++] = events_[i];
        }
        count_ = kept;
    }

    void clear() { count_ = 0; }
    uint32_t dropped() const { return dropped_; }

private:
    Event events_[Capacity];
    uint32_t count_ = 0;
    uint32_t dropped_ = 0;
};

// ── renderSplit ─────────────────────────────────────────────────────────────

struct VoiceStats {
    uint32_t applied  = 0;  // events applied
    uint32_t late     = 0;  // events whose frame had passed; landed on frame 0
    uint32_t splits   = 0;  // extra render calls caused by mid-block events
    uint32_t overruns = 0;  // process() asked for more frames than were reserved
};

/**
 * Renders `frames` samples of `engine` into `out`, starting at absolute frame
 * `blockStart`, and applies every scheduled event due inside the block on its
 * own frame: render up to the event, apply it, continue. Events due at or
 * after the block's end stay scheduled. Returns the number applied.
 */
template <class Engine, uint32_t Capacity>
uint32_t renderSplit(Engine& engine, EventSchedule<Capacity>& schedule, int64_t blockStart,
                     float* out, int frames, VoiceStats* stats = nullptr) {
    const int64_t blockEnd = blockStart + frames;
    const uint32_t pending = schedule.size();
    int pos = 0;
    uint32_t i = 0;
    for (; i < pending; ++i) {
        const Event& e = schedule[i];
        if (e.frame >= blockEnd) break;
        int at = 0;
        if (e.frame > blockStart) {
            at = static_cast<int>(e.frame - blockStart);
        } else if (e.frame < blockStart && stats) {
            ++stats->late;
        }
        if (at > pos) {
            engine.render(out + pos, at - pos);
            pos = at;
            if (stats) ++stats->splits;
        }
        engine.apply(e);
    }
    schedule.erasePrefix(i);
    if (pos < frames) engine.render(out + pos, frames - pos);
    if (stats) stats->applied += i;
    return i;
}

// ── BlockBuffer ─────────────────────────────────────────────────────────────

/**
 * One owned output buffer per instance, 16-byte aligned for simd128. Sized
 * once at init; the audio thread only ever acquires it. Replaces the four
 * hand-written malloc'd outBuf + grow-in-process copies.
 */
class BlockBuffer {
public:
    static constexpr size_t kAlign = 16;

    BlockBuffer() = default;
    BlockBuffer(const BlockBuffer&) = delete;
    BlockBuffer& operator=(const BlockBuffer&) = delete;
    ~BlockBuffer() { std::free(data_); }

    /** Init path only. Grows (never shrinks); false if the allocation failed. */
    bool reserve(int frames) {
        if (frames <= capacity_) return true;
        const size_t bytes = (static_cast<size_t>(frames) * sizeof(float) + kAlign - 1) & ~(kAlign - 1);
        void* p = std::aligned_alloc(kAlign, bytes);
        if (!p) return false;
        std::memset(p, 0, bytes);
        std::free(data_);
        data_ = static_cast<float*>(p);
        capacity_ = frames;
        return true;
    }

    /** Audio thread: the buffer for a block of `frames`, or nullptr if it was reserved smaller. */
    float* acquire(int frames) { return (frames > 0 && frames <= capacity_) ? data_ : nullptr; }

    float* data() { return data_; }
    int capacity() const { return capacity_; }

private:
    float* data_ = nullptr;
    int capacity_ = 0;
};

// ── VoiceSlots: handle → instance without hashing ───────────────────────────

/**
 * Fixed array of in-place instances. A handle packs the slot index (low 8
 * bits, +1 so 0 stays invalid) with the slot's generation (the rest), so a
 * handle that outlives its instance stops resolving even after the slot is
 * reused. Lookup is a mask, a bounds check and a compare.
 */
template <class T, uint32_t Capacity>
class VoiceSlots {
    static_assert(Capacity >= 1 && Capacity <= 255, "the index field is 8 bits");

public:
    using Handle = uintptr_t;

    VoiceSlots() = default;
    VoiceSlots(const VoiceSlots&) = delete;
    VoiceSlots& operator=(const VoiceSlots&) = delete;
    ~VoiceSlots() {
        for (uint32_t i = 0; i < Capacity; ++i) {
            if (slots_[i].live) instance(slots_[i])->~T();
        }
    }

    /** Constructs a T in a free slot (setup path). 0 when every slot is taken. */
    template <class... Args>
    Handle create(Args&&... args) {
        for (uint32_t i = 0; i < Capacity; ++i) {
            Slot& s = slots_[i];
            if (s.live) continue;
            ::new (static_cast<void*>(s.storage)) T(std::forward<Args>(args)...);
            s.live = true;
            return (static_cast<Handle>(s.generation) << kIndexBits) | static_cast<Handle>(i + 1);
        }
        return 0;
    }

    void destroy(Handle h) {
        Slot* s = resolve(h);
        if (!s) return;
        instance(*s)->~T();
        s->live = false;
        s->generation = (s->generation + 1) & kGenerationMask;
    }

    T* get(Handle h) {
        Slot* s = resolve(h);
        return s ? instance(*s) : nullptr;
    }

    uint32_t liveCount() const {
        uint32_t n = 0;
        for (uint32_t i = 0; i < Capacity; ++i) n += slots_[i].live ? 1u : 0u;
        return n;
    }

private:
    static constexpr unsigned kIndexBits = 8;
    static constexpr Handle kIndexMask = 0xFF;
    // Generation fits the rest of a 32-bit handle (wasm32's uintptr_t).
    static constexpr uint32_t kGenerationMask = 0xFFFFFF;

    struct Slot {
        alignas(T) unsigned char storage[sizeof(T)];
        uint32_t generation = 0;
        bool live = false;
    };

    static T* instance(Slot& s) { return std::launder(reinterpret_cast<T*>(s.storage)); }

    Slot* resolve(Handle h) {
        const Handle index1 = h & kIndexMask;
        if (index1 == 0 || index1 > Capacity) return nullptr;
        Slot& s = slots_[index1 - 1];
        if (!s.live || (h >> kIndexBits) != s.generation) return nullptr;
        return &s;
    }

    Slot slots_[Capacity];
};

// ── NativeVoice: what one handle owns ───────────────────────────────────────

template <class Engine, uint32_t EventCapacity = 256>
struct NativeVoice {
    Engine engine;
    EventRing<EventCapacity> ring;
    EventSchedule<EventCapacity> schedule;
    BlockBuffer buffer;
    VoiceStats stats;

    /** Setup path: the only place a voice allocates. */
    bool init(float sampleRate, int maxFrames) {
        return buffer.reserve(maxFrames) && engine.init(sampleRate, maxFrames);
    }

    /** Producer side. False (and counted in ring.dropped()) when the ring is full. */
    bool push(const Event& e) { return ring.push(e); }

    /**
     * Audio thread: render the block that starts at absolute frame `blockStart`.
     * nullptr when `frames` exceeds what init reserved — the caller outputs
     * silence; growing here would allocate on the audio thread.
     */
    float* process(int64_t blockStart, int frames) {
        float* out = buffer.acquire(frames);
        if (!out) {
            ++stats.overruns;
            return nullptr;
        }
        schedule.absorb(ring);
        renderSplit(engine, schedule, blockStart, out, frames, &stats);
        return out;
    }

    /** Stop / mute (consumer side): cancel every pending note and trigger; params still land. */
    void cancelPendingNotes() {
        schedule.absorb(ring);
        schedule.removeIf(isNoteEvent);
    }
};

// ── Smoothed: one-pole parameter smoothing ──────────────────────────────────

/**
 * cur moves toward target by `coeff` of the gap per sample. setTime(tau)
 * gives the usual RC response — 63% of a step after tau seconds. Settles
 * exactly onto target instead of creeping toward it in the float noise.
 */
struct Smoothed {
    float cur = 0.0f;
    float target = 0.0f;
    float coeff = 1.0f;  // 1 = jump straight to target

    void setTime(float seconds, float sampleRate) {
        coeff = (seconds > 0.0f && sampleRate > 0.0f)
            ? 1.0f - std::exp(-1.0f / (seconds * sampleRate))
            : 1.0f;
    }

    void reset(float v) { cur = target = v; }
    void set(float v) { target = v; }
    bool settled() const { return cur == target; }

    /** Per-sample step. */
    float next() {
        const float stepped = cur + coeff * (target - cur);
        // Near a large target the step drops below one float ulp and cur
        // would stall short of it for good — snap instead.
        cur = (stepped == cur) ? target : stepped;
        settle();
        return cur;
    }

    /** `frames` steps at once, for engines that update per sub-block. */
    float advance(int frames) {
        if (frames <= 0 || settled()) return cur;
        const float keep = std::pow(1.0f - coeff, static_cast<float>(frames));
        cur = target + (cur - target) * keep;
        settle();
        return cur;
    }

private:
    void settle() {
        const float scale = std::fabs(target) > 1.0f ? std::fabs(target) : 1.0f;
        if (std::fabs(target - cur) <= 1.0e-6f * scale) cur = target;
    }
};

// ── Denormal guard ──────────────────────────────────────────────────────────

/**
 * Zero a value too small to hear (< -300 dBFS) before it goes subnormal.
 * Use on IIR / feedback state, once per sample or per block.
 */
inline float flushDenormal(float x) {
    return std::fabs(x) < 1.0e-15f ? 0.0f : x;
}

}  // namespace hyphon
