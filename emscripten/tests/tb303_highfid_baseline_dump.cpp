/**
 * tb303_highfid_baseline_dump.cpp
 *
 * Phase-2 (#975): render the canonical pattern through highfid-cpu at 48 kHz /
 * 24-bit mono and write highfid-cpu_canonical.wav for spectrogram vs soft oracle.
 *
 * Usage:
 *   g++ -std=c++17 -O2 -I emscripten/tests/emscripten_stub \
 *       emscripten/tests/tb303_highfid_baseline_dump.cpp -o /tmp/hf_dump
 *   /tmp/hf_dump docs/audio-engine/303-baseline
 */

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "../highfid303_wrapper.cpp"

namespace {

constexpr float  SAMPLE_RATE = 48000.0f;
constexpr int    BLOCK       = 128;
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

std::vector<float> render(int oversample)
{
    uintptr_t h = highfid303_create();
    highfid303_init(h, SAMPLE_RATE, BLOCK);
    highfid303_set_oversample(h, oversample);
    highfid303_set_param(h, P_WAVEFORM,  0.0f);
    highfid303_set_param(h, P_CUTOFF,    0.35f);
    highfid303_set_param(h, P_RESONANCE, 0.70f);
    highfid303_set_param(h, P_ENVMOD,    0.55f);
    highfid303_set_param(h, P_DECAY,     0.50f);
    highfid303_set_param(h, P_ACCENT,    0.70f);
    highfid303_set_param(h, P_VOLUME,    0.80f);

    std::vector<float> out;
    out.reserve(4 * STEP_BLOCKS * BLOCK);
    float block[BLOCK];
    int prevNote = -1;
    for (const Step& s : kPattern) {
        if (!s.legato && prevNote >= 0) highfid303_note_off(h, prevNote);
        highfid303_note_on(h, s.note, s.accent ? ACCENT_VEL : NORMAL_VEL);
        prevNote = s.note;
        for (int b = 0; b < STEP_BLOCKS; ++b) {
            std::memset(block, 0, sizeof(block));
            highfid303_process(h, reinterpret_cast<uintptr_t>(block), BLOCK);
            out.insert(out.end(), block, block + BLOCK);
        }
    }
    highfid303_destroy(h);
    return out;
}

void writeWav24(const std::filesystem::path& path, const std::vector<float>& samples, int sr)
{
    const int32_t dataBytes = static_cast<int32_t>(samples.size() * 3);
    const int32_t fmtSize = 16;
    const int16_t audioFormat = 1;
    const int16_t channels = 1;
    const int16_t bits = 24;
    const int32_t byteRate = sr * channels * (bits / 8);
    const int16_t blockAlign = channels * (bits / 8);
    const int32_t riffSize = 36 + dataBytes;

    std::ofstream f(path, std::ios::binary);
    auto wr = [&](const void* p, size_t n) { f.write(reinterpret_cast<const char*>(p), static_cast<std::streamsize>(n)); };
    wr("RIFF", 4); wr(&riffSize, 4); wr("WAVE", 4);
    wr("fmt ", 4); wr(&fmtSize, 4); wr(&audioFormat, 2); wr(&channels, 2);
    wr(&sr, 4); wr(&byteRate, 4); wr(&blockAlign, 2); wr(&bits, 2);
    wr("data", 4); wr(&dataBytes, 4);
    for (float s : samples) {
        float c = std::max(-1.0f, std::min(1.0f, s));
        int32_t v = static_cast<int32_t>(std::lrint(c * 8388607.0f));
        uint8_t b[3] = {
            static_cast<uint8_t>(v & 0xff),
            static_cast<uint8_t>((v >> 8) & 0xff),
            static_cast<uint8_t>((v >> 16) & 0xff),
        };
        wr(b, 3);
    }
}

}  // namespace

int main(int argc, char** argv)
{
    const std::string outDir = (argc > 1) ? argv[1] : "docs/audio-engine/303-baseline";
    std::filesystem::create_directories(outDir);

    std::printf("TB-303 Phase-2 highfid-cpu baseline dump → %s\n", outDir.c_str());
    // Default offline quality: 4× oversample for the reference WAV
    const auto samples = render(4);
    const auto wavPath = std::filesystem::path(outDir) / "highfid-cpu_canonical.wav";
    writeWav24(wavPath, samples, static_cast<int>(SAMPLE_RATE));
    std::printf("  wrote %s (%zu samples @ %.0f Hz, 4× OS)\n",
                wavPath.string().c_str(), samples.size(), SAMPLE_RATE);

    std::ofstream mf(std::filesystem::path(outDir) / "highfid_baseline_manifest.txt");
    mf << "# Phase-2 highfid-cpu diode-ladder baseline\n";
    mf << "model=highfid-cpu\n";
    mf << "sample_rate=48000\n";
    mf << "bit_depth=24\n";
    mf << "oversample=4\n";
    mf << "topology=diode-ladder (mystran/kunn) + feedback HP 150 Hz + diode shape + PolyBLEP\n";
    mf << "related_test=emscripten/tests/tb303_highfid_offline_test.cpp\n";
    mf << "role=high-fidelity CPU reference (Phase-2)\n";
    return 0;
}
