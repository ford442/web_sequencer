#!/bin/bash
# Offline buffer test for the first custom 303 voices (issue #898).
#
# Compiles emscripten/open303_wrapper.cpp with a host g++ (via the emscripten
# stubs in emscripten_stub/) and renders a fixed pattern through the stock,
# experimental-01 and 1ink303-v1 voices, asserting an audible difference vs
# stock while the stock path stays bit-identical. Requires no emsdk.
#
# For Phase-0 (#973) 48 kHz / 24-bit WAV dumps + spectrograms, use:
#   bash scripts/generate_303_baselines.sh
#
# Usage: bash emscripten/tests/run_offline_voices_test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"

build_and_run() {
    local name="$1"
    echo "Compiling $name…"
    g++ -std=c++17 -O2 -Wall -Wextra \
        -I "$SCRIPT_DIR/emscripten_stub" \
        "$SCRIPT_DIR/$name.cpp" \
        -o "$TMP/$name"
    echo "Running $name…"
    "$TMP/$name"
    echo
}

# #901 factory/registry surface, then #898 voice audibility, then #975 highfid-cpu.
build_and_run tb303_factory_smoke_test
build_and_run tb303_voices_offline_test
build_and_run tb303_highfid_offline_test

# Output-level alignment across the realtime 303 voices. Needs the rosic sources
# from the jc303_wasm submodule, so it is skipped when that is not checked out.
OPEN303_DSP="$SCRIPT_DIR/../../jc303_wasm/src/dsp/open303"
if compgen -G "$OPEN303_DSP/*.cpp" > /dev/null; then
    echo "Compiling tb303_level_alignment_test…"
    # Suppress third-party rosic warning noise; our own sources stay -Wall -Wextra.
    g++ -std=c++17 -O2 -Wall -Wextra \
        -Wno-strict-aliasing -Wno-unused-parameter -Wno-aggressive-loop-optimizations \
        -I "$SCRIPT_DIR/emscripten_stub" \
        -I "$OPEN303_DSP" \
        -I "$SCRIPT_DIR/../../jc303_wasm/src/dsp" \
        "$SCRIPT_DIR/tb303_level_alignment_test.cpp" \
        "$SCRIPT_DIR/tb303_level_alignment_jc303_tu.cpp" \
        "$OPEN303_DSP"/*.cpp \
        -o "$TMP/tb303_level_alignment_test"
    echo "Running tb303_level_alignment_test…"
    "$TMP/tb303_level_alignment_test"
    echo
else
    echo "Skipping tb303_level_alignment_test (jc303_wasm submodule not checked out)."
    echo "  Run: git submodule update --init jc303_wasm"
    echo
fi
