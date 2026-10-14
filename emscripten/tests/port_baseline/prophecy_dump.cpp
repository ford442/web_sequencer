/**
 * Port baseline dump for prophecy (#1344 P3).
 *
 * Renders a fixed note + parameter pattern through the immediate C API — the
 * surface both the pre-port and the ported wrapper expose — and writes raw
 * float32 to argv[1]. Block sizes stay within what init reserved: the
 * pre-port prophecy_process rendered only that many frames of a larger block.
 *
 * The wrapper comes from the include path (-I <tree>/emscripten).
 */

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "prophecy_wrapper.cpp"

namespace {

void renderPattern(std::vector<float>& out, float sampleRate, int waveform) {
    const uintptr_t h = prophecy_create();
    prophecy_init(h, sampleRate, 512);
    prophecy_set_param(h, PROPHECY_WAVEFORM, static_cast<float>(waveform));
    prophecy_set_param(h, PROPHECY_VOWEL, 0.1f + 0.2f * waveform);
    prophecy_set_param(h, PROPHECY_ATTACK, 0.005f);
    prophecy_set_param(h, PROPHECY_RELEASE, 0.08f);

    const int notes[] = {48, 55, 60, 63, 67, 60, 58, 51};
    const int blockSizes[] = {128, 128, 96, 128, 256, 128, 512, 64};
    const double stepFrames = sampleRate * 60.0 / (120.0 * 4.0);
    int64_t frame = 0;
    int block = 0;
    int step = 0;
    const int64_t total = static_cast<int64_t>(stepFrames * 48.0) + static_cast<int64_t>(sampleRate);

    while (frame < total) {
        const int n = blockSizes[block++ % 8];
        while (step < 48 && static_cast<int64_t>(step * stepFrames) < frame + n) {
            const int note = notes[step % 8] + (step / 16) * 12;
            if (step > 0) prophecy_note_off(h, notes[(step - 1) % 8] + ((step - 1) / 16) * 12);
            if (step % 3 != 2) prophecy_note_on(h, note, 64.0f + (step * 13) % 64);
            if (step % 4 == 1) prophecy_note_on(h, note + 7, 90.0f);  // overlapping voice
            if (step % 8 == 0) prophecy_set_param(h, PROPHECY_FORMANT_SHIFT, (step % 5) * 0.2f);
            if (step % 8 == 4) prophecy_set_param(h, PROPHECY_RESONANCE, (step % 7) / 7.0f);
            if (step == 20) prophecy_set_param(h, PROPHECY_PORTAMENTO, 0.3f);
            if (step == 30) prophecy_set_param(h, PROPHECY_VOWEL, 0.9f);
            if (step == 36) prophecy_all_notes_off(h);
            ++step;
        }
        const float* buf = reinterpret_cast<const float*>(prophecy_process(h, n));
        if (!buf) {
            std::fprintf(stderr, "prophecy_process returned 0 at frame %lld\n", static_cast<long long>(frame));
            std::exit(2);
        }
        out.insert(out.end(), buf, buf + n);
        frame += n;
    }
    prophecy_destroy(h);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s <out.f32>\n", argv[0]);
        return 2;
    }
    std::vector<float> out;
    for (int wf = 0; wf < 4; ++wf) renderPattern(out, wf % 2 ? 48000.0f : 44100.0f, wf);
    std::FILE* f = std::fopen(argv[1], "wb");
    if (!f) return 2;
    std::fwrite(out.data(), sizeof(float), out.size(), f);
    std::fclose(f);
    std::printf("%zu samples\n", out.size());
    return 0;
}
