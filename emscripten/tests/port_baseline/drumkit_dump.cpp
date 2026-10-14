/**
 * Port baseline dump for drumkit (#1344 P3).
 *
 * Renders a fixed pattern through the immediate C API — the surface both the
 * pre-port and the ported wrapper expose — and writes raw float32 samples to
 * argv[1]. check_port_baseline.sh builds this once against each tree and
 * requires the two files to be byte-identical.
 *
 * The wrapper comes from the include path (-I <tree>/emscripten).
 */

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "drumkit_wrapper.cpp"

namespace {

struct Hit {
    int voice;
    float velocity, a, b, c, d;
};

// Per-voice parameter sets in the ranges DrumKitEngine.ts sends.
const Hit kHits[] = {
    {0, 1.00f, 50.0f, 0.60f, 0.60f, 1.00f},    // kick
    {0, 0.70f, 42.0f, 1.20f, 0.10f, 0.90f},
    {1, 1.00f, 180.0f, 0.25f, 3000.0f, 0.90f}, // snare
    {1, 1.30f, 240.0f, 0.40f, 6000.0f, 0.80f},
    {2, 1.00f, 8000.0f, 0.05f, 0.70f, 0.0f},   // closed hat (chokes open)
    {3, 0.90f, 6500.0f, 0.50f, 0.70f, 0.0f},   // open hat
    {2, 0.50f, 9500.0f, 0.03f, 0.60f, 0.0f},
    {3, 1.10f, 7200.0f, 0.90f, 0.80f, 0.0f},
};

void renderPattern(std::vector<float>& out, float sampleRate, int kit) {
    const uintptr_t h = drumkit_create();
    drumkit_init(h, sampleRate, 128);
    drumkit_set_kit(h, kit);

    // 64 sixteenths at 128 BPM. Block sizes cycle through the default quantum,
    // a short one and two that are larger than init reserved.
    const int blockSizes[] = {128, 128, 96, 128, 256, 128, 512, 128};
    const double stepFrames = sampleRate * 60.0 / (128.0 * 4.0);
    int64_t frame = 0;
    int block = 0;
    int nextStep = 0;
    const int64_t total = static_cast<int64_t>(stepFrames * 64.0) + static_cast<int64_t>(sampleRate);

    while (frame < total) {
        const int n = blockSizes[block++ % 8];
        // Every step due before this block ends lands at its start (the
        // immediate API's resolution).
        while (nextStep < 64 && static_cast<int64_t>(nextStep * stepFrames) < frame + n) {
            const Hit& hit = kHits[(nextStep * 5 + nextStep / 3) % 8];
            drumkit_trigger(h, hit.voice, hit.velocity, hit.a, hit.b, hit.c, hit.d);
            if (nextStep % 4 == 0) drumkit_trigger(h, 0, 1.0f, 50.0f, 0.6f, 0.6f, 1.0f);
            if (nextStep % 16 == 14) drumkit_choke_open_hat(h);
            if (nextStep == 40) drumkit_set_kit(h, 1 - kit);
            ++nextStep;
        }
        const uintptr_t ptr = drumkit_process(h, n);
        const float* buf = reinterpret_cast<const float*>(ptr);
        if (!buf) {
            std::fprintf(stderr, "drumkit_process returned 0 at frame %lld\n", static_cast<long long>(frame));
            std::exit(2);
        }
        out.insert(out.end(), buf, buf + n);
        frame += n;
    }
    drumkit_destroy(h);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s <out.f32>\n", argv[0]);
        return 2;
    }
    std::vector<float> out;
    renderPattern(out, 44100.0f, 0);
    renderPattern(out, 48000.0f, 1);
    std::FILE* f = std::fopen(argv[1], "wb");
    if (!f) return 2;
    std::fwrite(out.data(), sizeof(float), out.size(), f);
    std::fclose(f);
    std::printf("%zu samples\n", out.size());
    return 0;
}
