/**
 * tb303_level_alignment_jc303_tu.cpp
 *
 * jc303 (rosic) translation unit for tb303_level_alignment_test.cpp.
 *
 * The 303 wrappers each define their own file-static helpers (midiToFreq,
 * fastTanh, TWO_PI_F, ...), so they cannot share a translation unit — the real
 * build compiles them separately too (see emscripten/build.sh). This TU exposes
 * a single C-linkage render entry point for the alignment test to call.
 */

#include "../jc303_wrapper.cpp"

#include <cstring>

#include "tb303_level_alignment_pattern.h"

extern "C" int tb303_render_jc303(float volume, float* out)
{
    uintptr_t h = jc303_create();
    jc303_init_handle(h, TB303_SAMPLE_RATE, TB303_BLOCK);
    jc303_set_param(h, TB303_P_WAVEFORM,  0.0f);
    jc303_set_param(h, TB303_P_CUTOFF,    0.35f);
    jc303_set_param(h, TB303_P_RESONANCE, 0.70f);
    jc303_set_param(h, TB303_P_ENVMOD,    0.55f);
    jc303_set_param(h, TB303_P_DECAY,     0.50f);
    jc303_set_param(h, TB303_P_ACCENT,    0.70f);
    jc303_set_param(h, TB303_P_VOLUME,    volume);

    int n = 0;
    int prevNote = -1;
    for (int s = 0; s < TB303_NUM_STEPS; ++s) {
        if (!kTb303Pattern[s].legato && prevNote >= 0) jc303_note_off(h, prevNote);
        jc303_note_on(h, kTb303Pattern[s].note,
                      kTb303Pattern[s].accent ? TB303_ACCENT_VEL : TB303_NORMAL_VEL);
        prevNote = kTb303Pattern[s].note;
        for (int b = 0; b < TB303_STEP_BLOCKS; ++b) {
            uintptr_t ptr = jc303_process_handle(h, TB303_BLOCK);
            const float* blk = reinterpret_cast<const float*>(ptr);
            for (int i = 0; i < TB303_BLOCK; ++i) out[n++] = blk ? blk[i] : 0.0f;
        }
    }

    jc303_destroy(h);
    return n;
}
