/**
 * Shared note / param pattern for the 303 port baseline dumps (#1344 P3).
 *
 * Calls hooks the dump supplies — noteOn(note, velocity), noteOff(note),
 * setParam(id, value), render(frames) — so the same pattern drives open303,
 * jc303 and highfid303 through their immediate C APIs. Includes accents
 * (velocity 127), slides (a noteOn while the gate is still open) and param
 * moves between notes. Param ids are the Open303Param ids all three share.
 */
#pragma once

#include <cstdint>

template <class NoteOn, class NoteOff, class SetParam, class Render>
void runTb303Pattern(float sampleRate, int maxBlock, NoteOn noteOn, NoteOff noteOff, SetParam setParam, Render render) {
    setParam(2, 0.35f);  // cutoff
    setParam(3, 0.70f);  // resonance
    setParam(4, 0.55f);  // env mod
    setParam(5, 0.50f);  // decay
    setParam(6, 0.70f);  // accent
    setParam(7, 0.80f);  // volume

    const int notes[] = {36, 36, 48, 39, 41, 36, 43, 46};
    const int blockSizes[] = {128, 128, 96, 128, 64, 128, 32, 128};
    const double stepFrames = sampleRate * 60.0 / (130.0 * 4.0);
    int64_t frame = 0;
    int block = 0;
    int step = 0;
    int held = -1;
    const int steps = 48;
    const int64_t total = static_cast<int64_t>(stepFrames * steps) + static_cast<int64_t>(sampleRate / 2);

    while (frame < total) {
        int n = blockSizes[block++ % 8];
        if (n > maxBlock) n = maxBlock;
        while (step < steps && static_cast<int64_t>(step * stepFrames) < frame + n) {
            const int note = notes[step % 8] + (step / 16) * 12;
            const bool slide = step % 6 == 5;     // keep the gate open into the next note
            const bool accent = step % 4 == 2;
            if (held >= 0 && !slide) noteOff(held);
            if (step % 7 != 3) {                  // a rest now and then
                noteOn(note, accent ? 127.0f : 90.0f);
                held = note;
            }
            if (step % 8 == 0) setParam(2, 0.15f + 0.1f * static_cast<float>((step / 8) % 6));
            if (step % 8 == 4) setParam(3, 0.55f + 0.08f * static_cast<float>((step / 8) % 5));
            if (step == 16) setParam(0, 1.0f);    // square
            if (step == 32) setParam(0, 0.0f);    // saw
            if (step == 24) setParam(11, 0.6f);   // slide time
            if (step == 40) setParam(5, 0.15f);   // decay
            ++step;
        }
        render(n);
        frame += n;
    }
}
