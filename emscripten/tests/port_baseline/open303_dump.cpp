/**
 * Port baseline dump for open303 (#1344 P3): every open303-family model in
 * the registry, at oversample 1 / 2 / 4, through the immediate C API both the
 * pre-port and the ported wrapper expose. Raw float32 to argv[1].
 */

#include <cstdint>
#include <cstdio>
#include <vector>

#include "open303_wrapper.cpp"
#include "tb303_pattern.h"

int main(int argc, char** argv) {
    if (argc < 2) return 2;
    std::vector<float> out;
    std::vector<float> block(512);
    for (int model = 0; model < open303_get_model_count(); ++model) {
        for (int os : {1, 2, 4}) {
            const float sr = (model + os) % 2 ? 44100.0f : 48000.0f;
            const uintptr_t h = open303_create();
            open303_init(h, sr, 128);
            if (open303_set_model(h, model) != 1) {  // jc303-family model
                open303_destroy(h);
                continue;
            }
            open303_set_oversample(h, os);
            runTb303Pattern(
                sr, 128,
                [&](int note, float vel) { open303_note_on(h, note, vel); },
                [&](int note) { open303_note_off(h, note); },
                [&](int id, float v) { open303_set_param(h, id, v); },
                [&](int n) {
                    open303_process(h, reinterpret_cast<uintptr_t>(block.data()), n);
                    out.insert(out.end(), block.begin(), block.begin() + n);
                });
            open303_destroy(h);
        }
    }
    std::FILE* f = std::fopen(argv[1], "wb");
    if (!f) return 2;
    std::fwrite(out.data(), sizeof(float), out.size(), f);
    std::fclose(f);
    std::printf("%zu samples\n", out.size());
    return 0;
}
