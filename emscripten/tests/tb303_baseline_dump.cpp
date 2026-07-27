/**
 * tb303_baseline_dump.cpp
 *
 * Phase-0 (#973) baseline renderer for open303-family 303 voices.
 * Renders the same canonical pattern as tb303_voices_offline_test.cpp
 * at 48 kHz and writes 24-bit mono PCM WAVs under an output directory.
 *
 * Usage:
 *   g++ -std=c++17 -O2 -I emscripten/tests/emscripten_stub \
 *       emscripten/tests/tb303_baseline_dump.cpp -o /tmp/tb303_baseline_dump
 *   /tmp/tb303_baseline_dump docs/audio-engine/303-baseline
 *
 * Note: jc303-family voices are rejected by open303_set_model and are not
 * dumped here — see docs/audio-engine/303-baseline/README.md.
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "../open303_wrapper.cpp"

namespace {

constexpr float  SAMPLE_RATE = 48000.0f;
constexpr int    BLOCK       = 128;
// Match ~0.151 s/step from the 44.1 kHz offline test (52 blocks @ 128).
constexpr int    STEP_BLOCKS = 57;
constexpr float  ACCENT_VEL  = 120.0f;
constexpr float  NORMAL_VEL  = 90.0f;

constexpr int P_WAVEFORM  = 0;
constexpr int P_CUTOFF    = 2;
constexpr int P_RESONANCE = 3;
constexpr int P_ENVMOD    = 4;
constexpr int P_DECAY     = 5;
constexpr int P_ACCENT    = 6;
constexpr int P_VOLUME    = 7;

struct Step { int note; bool accent; bool legato; };
const Step kPattern[] = {
    { 36, false, false },
    { 36, true,  true  },
    { 39, false, false },
    { 43, true,  true  },
};

int findModelIndex(const char* id) {
    for (int i = 0; i < open303_get_model_count(); ++i) {
        const char* mid = open303_get_model_id(i);
        if (mid && std::strcmp(mid, id) == 0) return i;
    }
    return -1;
}

std::vector<float> renderVoice(int modelIndex) {
    uintptr_t h = open303_create();
    open303_init(h, SAMPLE_RATE, BLOCK);
    if (open303_set_model(h, modelIndex) == 0) {
        open303_destroy(h);
        return {};
    }

    open303_set_param(h, P_WAVEFORM,  0.0f);
    open303_set_param(h, P_CUTOFF,    0.35f);
    open303_set_param(h, P_RESONANCE, 0.70f);
    open303_set_param(h, P_ENVMOD,    0.55f);
    open303_set_param(h, P_DECAY,     0.50f);
    open303_set_param(h, P_ACCENT,    0.70f);
    open303_set_param(h, P_VOLUME,    0.80f);

    std::vector<float> out;
    out.reserve(sizeof(kPattern) / sizeof(kPattern[0]) * STEP_BLOCKS * BLOCK);
    float block[BLOCK];

    int prevNote = -1;
    for (const Step& s : kPattern) {
        if (!s.legato && prevNote >= 0) open303_note_off(h, prevNote);
        open303_note_on(h, s.note, s.accent ? ACCENT_VEL : NORMAL_VEL);
        prevNote = s.note;
        for (int b = 0; b < STEP_BLOCKS; ++b) {
            std::memset(block, 0, sizeof(block));
            open303_process(h, reinterpret_cast<uintptr_t>(block), BLOCK);
            out.insert(out.end(), block, block + BLOCK);
        }
    }

    open303_destroy(h);
    return out;
}

void writeWav24(const std::filesystem::path& path, const std::vector<float>& samples, int sampleRate) {
    const uint32_t numSamples = static_cast<uint32_t>(samples.size());
    const uint16_t numChannels = 1;
    const uint16_t bitsPerSample = 24;
    const uint16_t blockAlign = numChannels * (bitsPerSample / 8);
    const uint32_t byteRate = static_cast<uint32_t>(sampleRate) * blockAlign;
    const uint32_t dataBytes = numSamples * blockAlign;
    const uint32_t riffSize = 36 + dataBytes;

    std::ofstream f(path, std::ios::binary);
    if (!f) {
        throw std::runtime_error("failed to open " + path.string());
    }

    auto writeU16 = [&](uint16_t v) {
        char b[2] = { static_cast<char>(v & 0xff), static_cast<char>((v >> 8) & 0xff) };
        f.write(b, 2);
    };
    auto writeU32 = [&](uint32_t v) {
        char b[4] = {
            static_cast<char>(v & 0xff),
            static_cast<char>((v >> 8) & 0xff),
            static_cast<char>((v >> 16) & 0xff),
            static_cast<char>((v >> 24) & 0xff),
        };
        f.write(b, 4);
    };

    f.write("RIFF", 4);
    writeU32(riffSize);
    f.write("WAVE", 4);
    f.write("fmt ", 4);
    writeU32(16);
    writeU16(1); // PCM
    writeU16(numChannels);
    writeU32(static_cast<uint32_t>(sampleRate));
    writeU32(byteRate);
    writeU16(blockAlign);
    writeU16(bitsPerSample);
    f.write("data", 4);
    writeU32(dataBytes);

    for (float x : samples) {
        float clamped = std::max(-1.0f, std::min(1.0f, x));
        int32_t s = static_cast<int32_t>(std::lrint(clamped * 8388607.0f));
        if (s > 8388607) s = 8388607;
        if (s < -8388608) s = -8388608;
        char b[3] = {
            static_cast<char>(s & 0xff),
            static_cast<char>((s >> 8) & 0xff),
            static_cast<char>((s >> 16) & 0xff),
        };
        f.write(b, 3);
    }
}

double rms(const std::vector<float>& v) {
    double acc = 0.0;
    for (float x : v) acc += static_cast<double>(x) * x;
    return v.empty() ? 0.0 : std::sqrt(acc / static_cast<double>(v.size()));
}

float peakAbs(const std::vector<float>& v) {
    float m = 0.0f;
    for (float x : v) m = std::max(m, std::fabs(x));
    return m;
}

}  // namespace

int main(int argc, char** argv) {
    const std::filesystem::path outDir =
        (argc > 1) ? std::filesystem::path(argv[1])
                   : std::filesystem::path("docs/audio-engine/303-baseline");

    std::filesystem::create_directories(outDir);
    std::printf("TB-303 Phase-0 baseline dump → %s\n", outDir.c_str());
    std::printf("Sample rate: %.0f Hz, step blocks: %d, pattern steps: %zu\n",
                SAMPLE_RATE, STEP_BLOCKS, sizeof(kPattern) / sizeof(kPattern[0]));

    const char* voiceIds[] = {
        "stock-open303",
        "1ink303-v1",
        "experimental-01",
        "rebirth-338-1.5",
        "rebirth-2.0",
        "mb33-mkii",
        "raveolution",
    };

    int written = 0;
    int skipped = 0;
    for (const char* id : voiceIds) {
        const int idx = findModelIndex(id);
        if (idx < 0) {
            std::printf("  [SKIP] %s — not in registry\n", id);
            ++skipped;
            continue;
        }
        if (open303_get_model_engine(idx) != ENGINE_OPEN303) {
            std::printf("  [SKIP] %s — not open303-family (needs separate renderer)\n", id);
            ++skipped;
            continue;
        }

        const std::vector<float> buf = renderVoice(idx);
        if (buf.empty()) {
            std::printf("  [FAIL] %s — empty render\n", id);
            return 1;
        }
        for (float x : buf) {
            if (!std::isfinite(x)) {
                std::printf("  [FAIL] %s — non-finite sample\n", id);
                return 1;
            }
        }

        const std::string filename = std::string(id) + "_canonical.wav";
        const auto path = outDir / filename;
        writeWav24(path, buf, static_cast<int>(SAMPLE_RATE));
        std::printf("  [OK] %-20s samples=%zu rms=%.6f peak=%.6f → %s\n",
                    id, buf.size(), rms(buf), peakAbs(buf), filename.c_str());
        ++written;
    }

    // Sidecar manifest for regenerators / Phase-5 harnesses.
    {
        const auto manifestPath = outDir / "baseline_manifest.txt";
        std::ofstream mf(manifestPath);
        mf << "# Phase-0 open303-family baseline renders\n";
        mf << "sample_rate_hz=" << static_cast<int>(SAMPLE_RATE) << "\n";
        mf << "bit_depth=24\n";
        mf << "channels=1\n";
        mf << "block_size=" << BLOCK << "\n";
        mf << "step_blocks=" << STEP_BLOCKS << "\n";
        mf << "pattern=MIDI 36,36,39,43 accent on 2+4 legato on 2+4\n";
        mf << "params=cutoff=0.35 resonance=0.70 envMod=0.55 decay=0.50 accent=0.70 volume=0.80 waveform=saw\n";
        mf << "voices_written=" << written << "\n";
        mf << "voices_skipped=" << skipped << "\n";
        mf << "source=emscripten/tests/tb303_baseline_dump.cpp\n";
        mf << "related_test=emscripten/tests/tb303_voices_offline_test.cpp\n";
    }

    std::printf("Wrote %d WAV(s), skipped %d.\n", written, skipped);
    return written > 0 ? 0 : 1;
}
