/**
 * Offline host test for the macro (Plaits) voice on the shared voice core.
 *
 * Compiles macro_wrapper.cpp + the vendored plaits/stmlib sources with host
 * g++ (emscripten stubs) and asserts:
 *   - every one of the 24 engines renders non-silent, finite, unclipped audio
 *   - note 69 is 440 Hz at 48 kHz (the 47872 Hz tuning compensation) and
 *     stays 440 Hz through the 44.1 / 96 kHz resampler
 *   - block-aligned events render bit-identical to the immediate API, and a
 *     mid-block note starts on the next 48 kHz control-block boundary
 *   - 8-voice polyphony, voice stealing, mono legato, sleep after release
 *   - stereo: no spread → L == R; spread → width that cancels in mono
 *   - the denormal guards hold: on x86, no engine runs more than 2x (and
 *     30 us / quantum) slower with flush-to-zero off than on (wasm has no
 *     FTZ at all)
 * and prints CPU per engine for 8 held voices (host build — the wasm figure
 * comes from `tools/render_hyphon_native_parity.mjs macro-cpu`).
 *
 * MACRO_WAV_DIR=<dir> also writes one 48 kHz stereo WAV per engine there.
 *
 * Usage (via emscripten/tests/run_offline_voices_test.sh):
 *   g++ -std=c++17 -O2 -DTEST -I emscripten/tests/emscripten_stub \
 *       -I third_party/eurorack -I third_party \
 *       emscripten/tests/macro_offline_test.cpp <plaits + stmlib .cc> -o /tmp/macro_offline
 */

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#if defined(__SSE__) || defined(__x86_64__)
#include <xmmintrin.h>
#endif

#include "../macro_wrapper.cpp"

namespace {

constexpr int BLOCK = 128;

const char* const kEngineNames[macro::kNumEngines] = {
    "va-vcf", "phase-distortion", "six-op-1", "six-op-2", "six-op-3", "wave-terrain",
    "string-machine", "chiptune", "virtual-analog", "waveshaper", "fm", "grain",
    "additive", "wavetable", "chords", "speech", "swarm", "noise", "particle",
    "string", "modal", "bass-drum", "snare-drum", "hi-hat",
};

int g_failures = 0;

void check(bool cond, const char* msg) {
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", msg);
    if (!cond) ++g_failures;
}

struct Stereo {
    std::vector<float> l, r;
};

uintptr_t makeVoice(float sampleRate, int engine) {
    const uintptr_t h = macro_create();
    macro_init(h, sampleRate, BLOCK);
    macro_set_param(h, MACRO_ENGINE, static_cast<float>(engine));
    return h;
}

void append(Stereo& out, uintptr_t ptr, uintptr_t h, int n) {
    const float* buf = reinterpret_cast<const float*>(ptr);
    if (!buf) {
        check(false, "render returned non-null");
        return;
    }
    const int stride = macro_stride(h);
    out.l.insert(out.l.end(), buf, buf + n);
    out.r.insert(out.r.end(), buf + stride, buf + stride + n);
}

/** Immediate API: render `seconds` in BLOCK-frame chunks. */
void renderImmediate(uintptr_t h, Stereo& out, float sampleRate, float seconds) {
    const int blocks = static_cast<int>(seconds * sampleRate / BLOCK);
    for (int b = 0; b < blocks; ++b) append(out, macro_process(h, BLOCK), h, BLOCK);
}

float rms(const std::vector<float>& buf, size_t from = 0, size_t to = SIZE_MAX) {
    to = std::min(to, buf.size());
    if (to <= from) return 0.0f;
    double acc = 0.0;
    for (size_t i = from; i < to; ++i) acc += static_cast<double>(buf[i]) * buf[i];
    return static_cast<float>(std::sqrt(acc / static_cast<double>(to - from)));
}

float peak(const std::vector<float>& buf) {
    float p = 0.0f;
    for (float s : buf) p = std::max(p, std::fabs(s));
    return p;
}

bool allFinite(const std::vector<float>& buf) {
    for (float s : buf) {
        if (!std::isfinite(s)) return false;
    }
    return true;
}

/** Fundamental by autocorrelation (parabolic peak), searched in [lo, hi] Hz. */
double estimatePitch(const std::vector<float>& x, size_t from, size_t len, float sampleRate, double lo, double hi) {
    const int minLag = static_cast<int>(sampleRate / hi);
    const int maxLag = static_cast<int>(sampleRate / lo) + 2;
    std::vector<double> ac(maxLag + 2, 0.0);
    for (int lag = minLag - 1; lag <= maxLag + 1; ++lag) {
        double acc = 0.0;
        for (size_t i = 0; i < len; ++i) acc += static_cast<double>(x[from + i]) * x[from + i + lag];
        ac[lag] = acc;
    }
    int best = minLag;
    for (int lag = minLag; lag <= maxLag; ++lag) {
        if (ac[lag] > ac[best]) best = lag;
    }
    const double a = ac[best - 1], b = ac[best], c = ac[best + 1];
    const double denom = a - 2.0 * b + c;
    const double shift = std::fabs(denom) > 1e-12 ? 0.5 * (a - c) / denom : 0.0;
    return sampleRate / (best + shift);
}

double cents(double f, double ref) { return 1200.0 * std::log2(f / ref); }

void writeWav(const std::string& path, const Stereo& s, int sampleRate) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return;
    const uint32_t frames = static_cast<uint32_t>(s.l.size());
    const uint32_t dataBytes = frames * 2 * 2;
    auto u32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); };
    auto u16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f); u32(36 + dataBytes); std::fwrite("WAVE", 1, 4, f);
    std::fwrite("fmt ", 1, 4, f); u32(16); u16(1); u16(2); u32(sampleRate); u32(sampleRate * 4); u16(4); u16(16);
    std::fwrite("data", 1, 4, f); u32(dataBytes);
    for (uint32_t i = 0; i < frames; ++i) {
        for (float v : {s.l[i], s.r[i]}) {
            const int16_t q = static_cast<int16_t>(std::lround(macro::clampf(v, -1.0f, 1.0f) * 32767.0f));
            std::fwrite(&q, 2, 1, f);
        }
    }
    std::fclose(f);
}

}  // namespace

int main() {
    std::printf("macro_offline_test\n");
    const char* wavDir = std::getenv("MACRO_WAV_DIR");
    check(macro_engine_count() == 24, "macro_engine_count() == 24");

    // ── Every engine sounds ────────────────────────────────────────────────
    std::printf(" engines (C3 + E3 + G3 chord held 0.6 s, released, 0.4 s tail):\n");
    {
        bool allSound = true, allFiniteOk = true, noneClip = true;
        for (int e = 0; e < macro::kNumEngines; ++e) {
            const uintptr_t h = makeVoice(48000.0f, e);
            macro_set_param(h, MACRO_DECAY, 0.6f);
            for (int n : {48, 52, 55}) macro_note_on(h, n, 0.8f);
            Stereo out;
            renderImmediate(h, out, 48000.0f, 0.6f);
            for (int n : {48, 52, 55}) macro_note_off(h, n);
            renderImmediate(h, out, 48000.0f, 0.4f);
            const float level = rms(out.l, 0, 28800);
            const float pk = std::max(peak(out.l), peak(out.r));
            const bool sounds = level > 1.0e-3f;
            const bool finite = allFinite(out.l) && allFinite(out.r);
            allSound = allSound && sounds;
            allFiniteOk = allFiniteOk && finite;
            noneClip = noneClip && pk < 1.5f;
            std::printf("    %2d %-17s rms %.4f  peak %.3f%s\n", e, kEngineNames[e], level, pk,
                        sounds ? "" : "  <-- SILENT");
            if (wavDir) writeWav(std::string(wavDir) + "/macro-" + kEngineNames[e] + ".wav", out, 48000);
            macro_destroy(h);
        }
        check(allSound, "all 24 engines render audible output");
        check(allFiniteOk, "all 24 engines render finite samples");
        check(noneClip, "no engine exceeds 1.5 full scale with a 3-note chord");
    }

    // ── Tuning ─────────────────────────────────────────────────────────────
    for (float rate : {48000.0f, 44100.0f, 96000.0f}) {
        const uintptr_t h = makeVoice(rate, 13);  // wavetable: a clean periodic tone
        macro_set_param(h, MACRO_HARMONICS, 0.0f);
        macro_set_param(h, MACRO_TIMBRE, 0.0f);
        macro_set_param(h, MACRO_MORPH, 0.0f);
        macro_set_param(h, MACRO_SPREAD, 0.0f);
        macro_note_on(h, 69, 1.0f);
        Stereo out;
        renderImmediate(h, out, rate, 0.5f);
        const size_t from = static_cast<size_t>(0.2f * rate);
        const double f = estimatePitch(out.l, from, static_cast<size_t>(0.1f * rate), rate, 300.0, 600.0);
        char msg[160];
        std::snprintf(msg, sizeof msg, "note 69 at %.0f Hz context = %.2f Hz (%+.2f cents, |err| < 2)", rate, f, cents(f, 440.0));
        check(std::fabs(cents(f, 440.0)) < 2.0, msg);
        macro_destroy(h);
    }

    // ── Event path == immediate API (block-aligned) ────────────────────────
    {
        const int64_t start = 48000;
        const uintptr_t a = makeVoice(48000.0f, 8);
        const uintptr_t b = makeVoice(48000.0f, 8);
        Stereo ia, eb;
        // Immediate: note on at block 0, off at block 40.
        for (int blk = 0; blk < 120; ++blk) {
            if (blk == 0) macro_note_on(a, 60, 0.9f);
            if (blk == 40) macro_note_off(a, 60);
            append(ia, macro_process(a, BLOCK), a, BLOCK);
        }
        macro_push_event(b, static_cast<double>(start), hyphon::kNoteOn, 60, 0.9f, 0, 0, 0, 0);
        macro_push_event(b, static_cast<double>(start + 40 * BLOCK), hyphon::kNoteOff, 60, 0, 0, 0, 0, 0);
        for (int blk = 0; blk < 120; ++blk) append(eb, macro_render(b, static_cast<double>(start + blk * BLOCK), BLOCK), b, BLOCK);
        bool same = ia.l.size() == eb.l.size();
        for (size_t i = 0; same && i < ia.l.size(); ++i) same = ia.l[i] == eb.l[i] && ia.r[i] == eb.r[i];
        check(same, "block-aligned events render bit-identical to the immediate API");
        macro_destroy(a);
        macro_destroy(b);
    }

    // ── A mid-block note starts on the control block that holds its frame ─
    {
        const int64_t start = 0;
        const int at = 1000;  // inside block 7, control block 83
        const uintptr_t h = makeVoice(48000.0f, 8);
        macro_set_param(h, MACRO_LPG_COLOUR, 0.0f);
        macro_push_event(h, static_cast<double>(start + at), hyphon::kNoteOn, 60, 1.0f, 0, 0, 0, 0);
        Stereo out;
        for (int blk = 0; blk < 16; ++blk) append(out, macro_render(h, static_cast<double>(start + blk * BLOCK), BLOCK), h, BLOCK);
        int first = -1;
        for (size_t i = 0; i < out.l.size(); ++i) {
            if (std::fabs(out.l[i]) > 1.0e-6f) { first = static_cast<int>(i); break; }
        }
        // The control block in progress at frame `at` was rendered already;
        // the note takes the next 12-sample boundary.
        const int boundary = (at + macro::kBlock - 1) / macro::kBlock * macro::kBlock;
        char msg[160];
        std::snprintf(msg, sizeof msg, "note pushed for frame %d starts at frame %d (next control-block boundary %d)", at, first, boundary);
        check(first >= boundary && first < boundary + 4, msg);
        macro_destroy(h);
    }

    // ── Polyphony, stealing, mono legato, sleep ────────────────────────────
    {
        const uintptr_t h = makeVoice(48000.0f, 8);
        Stereo out;
        for (int n = 0; n < 8; ++n) macro_note_on(h, 48 + n, 0.8f);
        renderImmediate(h, out, 48000.0f, 0.05f);
        check(macro_active_voices(h) == 8, "8 held notes sound on 8 voices");
        macro_note_on(h, 70, 0.8f);
        renderImmediate(h, out, 48000.0f, 0.05f);
        check(macro_active_voices(h) == 8, "a 9th note steals a voice (still 8 active)");
        for (int n = 0; n < 8; ++n) macro_note_off(h, 48 + n);
        macro_note_off(h, 70);
        macro_set_param(h, MACRO_DECAY, 0.2f);
        renderImmediate(h, out, 48000.0f, 2.0f);
        check(macro_active_voices(h) == 0, "released voices go to sleep once silent");
        check(allFinite(out.l), "poly render stays finite");

        macro_set_param(h, MACRO_POLYPHONY, 1.0f);
        macro_note_on(h, 60, 0.8f);
        macro_note_on(h, 64, 0.8f);
        renderImmediate(h, out, 48000.0f, 0.05f);
        check(macro_active_voices(h) == 1, "polyphony 1: a second note retriggers the one voice");
        macro_destroy(h);
    }
    {
        // Mono legato slide: the second note glides with no retrigger, so the
        // internal decay envelope (here on TIMBRE) is not restarted.
        const uintptr_t h = makeVoice(48000.0f, 13);
        macro_set_param(h, MACRO_POLYPHONY, 1.0f);
        macro_set_param(h, MACRO_SPREAD, 0.0f);
        macro_set_param(h, MACRO_HARMONICS, 0.0f);
        macro_set_param(h, MACRO_TIMBRE, 0.0f);
        macro_set_param(h, MACRO_MORPH, 0.0f);
        macro_set_param(h, MACRO_GLIDE, 0.3f);
        macro_push_event(h, 0, hyphon::kNoteOn, 57, 1.0f, 0, 0, 0, 0);
        macro_push_event(h, 48000, hyphon::kNoteOn, 69, 1.0f, 0, 1, 0, 0);  // slide
        Stereo out;
        for (int blk = 0; blk < 1500; ++blk) append(out, macro_render(h, blk * BLOCK, BLOCK), h, BLOCK);
        const double before = estimatePitch(out.l, 30000, 4800, 48000.0f, 150.0, 600.0);
        const double after = estimatePitch(out.l, 48000 * 3, 4800, 48000.0f, 150.0, 600.0);
        char msg[160];
        std::snprintf(msg, sizeof msg, "mono slide: A3 %.1f Hz → A4 %.1f Hz", before, after);
        check(std::fabs(cents(before, 220.0)) < 3.0 && std::fabs(cents(after, 440.0)) < 3.0, msg);
        // Mid-glide (20 ms after the slide) the pitch sits between the two.
        const double mid = estimatePitch(out.l, 48000 + 960, 960, 48000.0f, 150.0, 600.0);
        std::snprintf(msg, sizeof msg, "glide passes through %.1f Hz on its way", mid);
        check(mid > 225.0 && mid < 435.0, msg);
        macro_destroy(h);
    }

    {
        // The sequencer's slide: the previous note's noteOff and the slid
        // note's noteOn share a frame (noteOff pushed first). Mono legato
        // must still hold — no new rising edge (a 6-op patch would restart
        // its envelopes).
        const uintptr_t h = makeVoice(48000.0f, 2);
        macro_set_param(h, MACRO_POLYPHONY, 1.0f);
        macro_push_event(h, 0, hyphon::kNoteOn, 57, 1.0f, 0, 0, 0, 0);
        macro_push_event(h, 24000, hyphon::kNoteOff, 57, 0, 0, 0, 0, 0);
        macro_push_event(h, 24000, hyphon::kNoteOn, 64, 1.0f, 0, 1, 0, 0);  // slide
        macro_push_event(h, 48000, hyphon::kNoteOff, 64, 0, 0, 0, 0, 0);
        macro_push_event(h, 48000, hyphon::kNoteOn, 67, 1.0f, 0, 0, 0, 0);  // no slide
        Stereo out;
        for (int blk = 0; blk < 500; ++blk) append(out, macro_render(h, blk * BLOCK, BLOCK), h, BLOCK);
        const uint32_t triggers = macro_voice(h)->engine.triggers();
        char msg[160];
        std::snprintf(msg, sizeof msg, "slide on the noteOff frame stays legato: %u rising edges for 3 notes (want 2)", triggers);
        check(triggers == 2, msg);
        macro_destroy(h);
    }

    {
        // A knob move overrides a value a note queued ahead of time.
        const uintptr_t h = makeVoice(48000.0f, 8);
        macro_push_event(h, 4800, hyphon::kParam, MACRO_POLYPHONY, 3.0f, 0, 0, 0, 0);
        macro_push_event(h, 9600, hyphon::kParam, MACRO_POLYPHONY, 2.0f, 0, 0, 0, 0);
        macro_render(h, 0, BLOCK);
        macro_set_param_now(h, MACRO_POLYPHONY, 1.0f);
        for (int blk = 1; blk < 120; ++blk) macro_render(h, blk * BLOCK, BLOCK);
        for (int n : {60, 64, 67}) macro_note_on(h, n, 0.8f);
        macro_render(h, 120 * BLOCK, BLOCK);
        check(macro_active_voices(h) == 1, "set_param_now drops the param's scheduled events (polyphony stays 1)");
        macro_destroy(h);
    }

    // ── Stereo ─────────────────────────────────────────────────────────────
    {
        const uintptr_t h = makeVoice(48000.0f, 8);
        macro_set_param(h, MACRO_SPREAD, 0.0f);
        macro_note_on(h, 60, 0.8f);
        Stereo dry;
        renderImmediate(h, dry, 48000.0f, 0.2f);
        bool mono = true;
        for (size_t i = 0; i < dry.l.size(); ++i) mono = mono && dry.l[i] == dry.r[i];
        check(mono, "spread 0: left == right");
        macro_set_param(h, MACRO_SPREAD, 1.0f);
        Stereo wide;
        renderImmediate(h, wide, 48000.0f, 0.2f);
        double side = 0.0;
        for (size_t i = 0; i < wide.l.size(); ++i) side += std::fabs(wide.l[i] - wide.r[i]);
        check(side > 1.0, "spread 1: AUX widens the image");
        macro_destroy(h);
    }

    // ── Hard stop ──────────────────────────────────────────────────────────
    {
        const uintptr_t h = makeVoice(44100.0f, 6);  // string machine: a sustained pad
        for (int n : {60, 64, 67}) macro_note_on(h, n, 0.8f);
        Stereo out;
        renderImmediate(h, out, 44100.0f, 0.3f);
        macro_all_notes_off(h);
        Stereo tail;
        renderImmediate(h, tail, 44100.0f, 0.05f);
        check(macro_active_voices(h) == 0, "all_notes_off: every voice asleep after the 2 ms fade");
        check(rms(tail.l, tail.l.size() / 2) < 1.0e-5f, "all_notes_off: silent within 50 ms");
        macro_destroy(h);
    }

    // ── Oversize immediate block is refused, not overrun ───────────────────
    {
        const uintptr_t h = makeVoice(48000.0f, 8);
        check(macro_process(h, BLOCK * 2) == 0, "macro_process refuses a block past the planar stride");
        check(macro_render(h, 0, BLOCK * 2) == 0, "macro_render refuses a block past the planar stride");
        macro_destroy(h);
    }

    // ── CPU per voice + the denormal guards (host build) ───────────────────
    // wasm has no flush-to-zero, so the staged sources carry denormal guards
    // (tools/plaits_wasm_patches.mjs). On x86 the same cost shows up with
    // FTZ/DAZ off: an engine whose state rings down into subnormals runs
    // several times slower than with FTZ on (8 held modal voices were 10x
    // before the guards). An engine fails when it is both over 2x its FTZ time
    // and more than 30 us per quantum slower — the absolute floor keeps
    // timer noise on the ~20 us engines from flaking the gate.
    std::printf(" CPU, 8 voices held, 48 kHz, 128-frame quantum (budget 2667 us):\n");
    double worst = 0.0;
    double worstRatio = 0.0;
    int worstRatioEngine = -1;
    int denormalBound = -1;
    auto timeEngine = [](int e, bool ftz) {
        double best = 1e30;
        for (int run = 0; run < 2; ++run) {
#if defined(__SSE__) || defined(__x86_64__)
            const unsigned csr = _mm_getcsr();
            _mm_setcsr(ftz ? (csr | 0x8040u) : (csr & ~0x8040u));
#else
            (void)ftz;
#endif
            const uintptr_t h = makeVoice(48000.0f, e);
            for (int n = 0; n < 8; ++n) macro_note_on(h, 48 + 3 * n, 0.8f);
            const int quanta = 750;  // 2 s
            const auto t0 = std::chrono::steady_clock::now();
            float sink = 0.0f;
            for (int q = 0; q < quanta; ++q) {
                const float* buf = reinterpret_cast<const float*>(macro_process(h, BLOCK));
                sink += buf[0];
            }
            const auto t1 = std::chrono::steady_clock::now();
            if (!std::isfinite(sink)) std::printf("    (non-finite output)\n");
            best = std::min(best, std::chrono::duration<double, std::micro>(t1 - t0).count() / quanta);
            macro_destroy(h);
#if defined(__SSE__) || defined(__x86_64__)
            _mm_setcsr(csr);
#endif
        }
        return best;
    };
    for (int e = 0; e < macro::kNumEngines; ++e) {
        const double us = timeEngine(e, false);
#if defined(__SSE__) || defined(__x86_64__)
        const double ftzUs = timeEngine(e, true);
#else
        const double ftzUs = us;
#endif
        const double ratio = us / ftzUs;
        if (ratio > 2.0 && us - ftzUs > 30.0 && denormalBound < 0) denormalBound = e;
        worst = std::max(worst, us);
        if (ratio > worstRatio) {
            worstRatio = ratio;
            worstRatioEngine = e;
        }
        std::printf("    %2d %-17s %7.1f us / quantum (%5.2f %% for 8 voices)  no-FTZ / FTZ %.2f\n", e,
                    kEngineNames[e], us, 100.0 * us / 2666.7, ratio);
    }
    std::printf("    worst engine: %.1f us / quantum = %.2f %% of the quantum\n", worst, 100.0 * worst / 2666.7);
    {
        char msg[160];
        std::snprintf(msg, sizeof msg, "denormal guards: no engine >2x and >30 us slower without FTZ (worst ratio %.2f, %s)",
                      worstRatio, worstRatioEngine >= 0 ? kEngineNames[worstRatioEngine] : "-");
        check(denormalBound < 0, msg);
    }

    if (g_failures) {
        std::printf("macro_offline_test: %d FAILED\n", g_failures);
        return 1;
    }
    std::printf("macro_offline_test: all passed\n");
    return 0;
}
