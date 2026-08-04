/**
 * tb303_level_alignment_pattern.h
 *
 * Canonical render settings shared by tb303_level_alignment_test.cpp and its
 * per-engine translation units. Matches the pattern/params used by
 * tb303_baseline_dump.cpp so measurements are comparable with
 * docs/audio-engine/303-baseline/.
 */

#pragma once

constexpr float TB303_SAMPLE_RATE = 48000.0f;
constexpr int   TB303_BLOCK       = 128;
constexpr int   TB303_STEP_BLOCKS = 57;
constexpr float TB303_ACCENT_VEL  = 120.0f;
constexpr float TB303_NORMAL_VEL  = 90.0f;

constexpr int TB303_P_WAVEFORM  = 0;
constexpr int TB303_P_CUTOFF    = 2;
constexpr int TB303_P_RESONANCE = 3;
constexpr int TB303_P_ENVMOD    = 4;
constexpr int TB303_P_DECAY     = 5;
constexpr int TB303_P_ACCENT    = 6;
constexpr int TB303_P_VOLUME    = 7;

struct Tb303Step { int note; bool accent; bool legato; };

constexpr Tb303Step kTb303Pattern[] = {
    { 36, false, false },
    { 36, true,  true  },
    { 39, false, false },
    { 43, true,  true  },
};

constexpr int TB303_NUM_STEPS = 4;
constexpr int TB303_TOTAL_FRAMES = TB303_NUM_STEPS * TB303_STEP_BLOCKS * TB303_BLOCK;
