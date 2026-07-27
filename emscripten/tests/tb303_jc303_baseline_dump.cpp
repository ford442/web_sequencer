/**
 * tb303_jc303_baseline_dump.cpp
 *
 * Phase-0 (#973) soft-oracle renderer for the authentic jc303 / rosic engine.
 * Renders the same canonical pattern as tb303_baseline_dump.cpp /
 * tb303_voices_offline_test.cpp at 48 kHz and writes a 24-bit mono PCM WAV.
 *
 * Build via scripts/generate_303_baselines.sh (host g++ + emscripten stubs +
 * jc303_wasm/src/dsp/open303/*.cpp). Manual one-liner is documented there.
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

#include "../jc303_wrapper.cpp"

namespace {

constexpr float SAMPLE_RATE = 48000.0f;
constexpr int   BLOCK       = 128;
constexpr int   STEP_BLOCKS = 57;
constexpr float ACCENT_VEL  = 120.0f;
constexpr float NORMAL_VEL  = 90.0f;

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

std::vector<float> renderJc303() {
    uintptr_t h = jc303_create();
    if (!jc303_init_handle(h, SAMPLE_RATE, BLOCK)) {
        jc303_destroy(h);
        return {};
    }

    jc303_set_param(h, P_WAVEFORM,  0.0f);
    jc303_set_param(h, P_CUTOFF,    0.35f);
    jc303_set_param(h, P_RESONANCE, 0.70f);
    jc303_set_param(h, P_ENVMOD,    0.55f);
    jc303_set_param(h, P_DECAY,     0.50f);
    jc303_set_param(h, P_ACCENT,    0.70f);
    jc303_set_param(h, P_VOLUME,    0.80f);

    std::vector<float> out;
    out.reserve(sizeof(kPattern) / sizeof(kPattern[0]) * STEP_BLOCKS * BLOCK);

    int prevNote = -1;
    for (const Step& s : kPattern) {
        if (!s.legato && prevNote >= 0) jc303_note_off(h, prevNote);
        jc303_note_on(h, s.note, s.accent ? ACCENT_VEL : NORMAL_VEL);
        prevNote = s.note;
        for (int b = 0; b < STEP_BLOCKS; ++b) {
            uintptr_t ptr = jc303_process_handle(h, BLOCK);
            if (!ptr) {
                jc303_destroy(h);
                return {};
            }
            const float* block = reinterpret_cast<const float*>(ptr);
            out.insert(out.end(), block, block + BLOCK);
        }
    }

    jc303_destroy(h);
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
    writeU16(1);
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
    std::printf("TB-303 Phase-0 jc303 soft-oracle dump → %s\n", outDir.c_str());

    const std::vector<float> buf = renderJc303();
    if (buf.empty()) {
        std::printf("  [FAIL] jc303 — empty render\n");
        return 1;
    }
    for (float x : buf) {
        if (!std::isfinite(x)) {
            std::printf("  [FAIL] jc303 — non-finite sample\n");
            return 1;
        }
    }

    const std::string filename = "jc303_canonical.wav";
    const auto path = outDir / filename;
    writeWav24(path, buf, static_cast<int>(SAMPLE_RATE));
    std::printf("  [OK] jc303 samples=%zu rms=%.6f peak=%.6f → %s\n",
                buf.size(), rms(buf), peakAbs(buf), filename.c_str());
    std::printf("  note: jc303_canonical.wav is the Phase-0 soft oracle until "
                "hardware-tb303_canonical.wav lands\n");

    {
        const auto manifestPath = outDir / "jc303_baseline_manifest.txt";
        std::ofstream mf(manifestPath);
        mf << "# Phase-0 jc303 soft-oracle baseline render\n";
        mf << "sample_rate_hz=" << static_cast<int>(SAMPLE_RATE) << "\n";
        mf << "bit_depth=24\n";
        mf << "channels=1\n";
        mf << "block_size=" << BLOCK << "\n";
        mf << "step_blocks=" << STEP_BLOCKS << "\n";
        mf << "pattern=MIDI 36,36,39,43 accent on 2+4 legato on 2+4\n";
        mf << "params=cutoff=0.35 resonance=0.70 envMod=0.55 decay=0.50 accent=0.70 volume=0.80 waveform=saw\n";
        mf << "voice=jc303\n";
        mf << "role=soft-oracle (provisional until hardware-tb303_canonical.wav)\n";
        mf << "source=emscripten/tests/tb303_jc303_baseline_dump.cpp\n";
        mf << "engine=rosic Open303 via emscripten/jc303_wrapper.cpp\n";
    }

    return 0;
}
