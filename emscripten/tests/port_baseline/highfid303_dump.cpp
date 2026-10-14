/**
 * Port baseline dump for highfid303 (#1344 P3): oversample 1 / 2 / 4, the
 * canonical L3 coefficients and a moved set, through the immediate C API both
 * the pre-port and the ported wrapper expose. Raw float32 to argv[1].
 */

#include <cstdint>
#include <cstdio>
#include <vector>

#include "highfid303_wrapper.cpp"
#include "tb303_pattern.h"

int main(int argc, char** argv) {
    if (argc < 2) return 2;
    std::vector<float> out;
    std::vector<float> block(512);
    for (int coeffs = 0; coeffs < 2; ++coeffs) {
        for (int os : {1, 2, 4}) {
            const float sr = os == 2 ? 44100.0f : 48000.0f;
            const uintptr_t h = highfid303_create();
            highfid303_init(h, sr, 128);
            highfid303_set_oversample(h, os);
            if (coeffs) {  // Phase L3 editable coefficients (ids 14-17)
                highfid303_set_param(h, 14, 0.4f);
                highfid303_set_param(h, 15, 0.6f);
                highfid303_set_param(h, 16, 0.3f);
                highfid303_set_param(h, 17, 0.5f);
            }
            runTb303Pattern(
                sr, 128,
                [&](int note, float vel) { highfid303_note_on(h, note, vel); },
                [&](int note) { highfid303_note_off(h, note); },
                [&](int id, float v) { highfid303_set_param(h, id, v); },
                [&](int n) {
                    highfid303_process(h, reinterpret_cast<uintptr_t>(block.data()), n);
                    out.insert(out.end(), block.begin(), block.begin() + n);
                });
            highfid303_destroy(h);
        }
    }
    std::FILE* f = std::fopen(argv[1], "wb");
    if (!f) return 2;
    std::fwrite(out.data(), sizeof(float), out.size(), f);
    std::fclose(f);
    std::printf("%zu samples\n", out.size());
    return 0;
}
