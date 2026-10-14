/**
 * Port baseline dump for jc303 (#1344 P3): the rosic engine through the
 * immediate C API both the pre-port and the ported wrapper expose, at two
 * sample rates and LEVELs. Block sizes stay within what init reserved — the
 * pre-port jc303_process_handle truncated larger ones. Raw float32 to argv[1].
 *
 * check_port_baseline.sh adds the jc303_wasm rosic sources for this one.
 */

#include <cstdint>
#include <cstdio>
#include <vector>

#include "jc303_wrapper.cpp"
#include "tb303_pattern.h"

int main(int argc, char** argv) {
    if (argc < 2) return 2;
    std::vector<float> out;
    for (int pass = 0; pass < 2; ++pass) {
        const float sr = pass ? 44100.0f : 48000.0f;
        const uintptr_t h = jc303_create();
        jc303_init_handle(h, sr, 128);
        runTb303Pattern(
            sr, 128,
            [&](int note, float vel) { jc303_note_on(h, note, vel); },
            [&](int note) { jc303_note_off(h, note); },
            [&](int id, float v) { jc303_set_param(h, id, pass ? v * 0.9f : v); },
            [&](int n) {
                const float* buf = reinterpret_cast<const float*>(jc303_process_handle(h, n));
                out.insert(out.end(), buf, buf + n);
            });
        jc303_destroy(h);
    }
    std::FILE* f = std::fopen(argv[1], "wb");
    if (!f) return 2;
    std::fwrite(out.data(), sizeof(float), out.size(), f);
    std::fclose(f);
    std::printf("%zu samples\n", out.size());
    return 0;
}
