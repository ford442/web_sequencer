#!/bin/bash
# Offline buffer tests for the native voices: the first custom 303 voices
# (issue #898), then every voice-core engine — drum kit, Prophecy, macro.
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
    shift  # anything after the name is extra compiler flags
    echo "Compiling $name…"
    g++ -std=c++17 -O2 -Wall -Wextra "$@" \
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
build_and_run drumkit_offline_test
build_and_run prophecy_offline_test

# #1344 shared voice core (emscripten/core/voice.h): sample-accurate event
# splitting, O(1) handles, no allocation in process. Built with the flags the
# core promises to accept; -pthread for the two-thread ring test.
build_and_run voice_core_test -fno-exceptions -fno-rtti -pthread

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

    # #1344: jc303 on the shared voice core — event path vs immediate API.
    echo "Compiling tb303_jc303_event_test…"
    g++ -std=c++17 -O2 -Wall -Wextra \
        -Wno-strict-aliasing -Wno-unused-parameter -Wno-aggressive-loop-optimizations \
        -I "$SCRIPT_DIR/emscripten_stub" \
        -I "$OPEN303_DSP" \
        -I "$SCRIPT_DIR/../../jc303_wasm/src/dsp" \
        "$SCRIPT_DIR/tb303_jc303_event_test.cpp" \
        "$OPEN303_DSP"/*.cpp \
        -o "$TMP/tb303_jc303_event_test"
    echo "Running tb303_jc303_event_test…"
    "$TMP/tb303_jc303_event_test"
    echo
else
    echo "Skipping tb303_level_alignment_test + tb303_jc303_event_test (jc303_wasm submodule not checked out)."
    echo "  Run: git submodule update --init jc303_wasm"
    echo
fi

# macro-* voices: the Plaits sources from the pinned third_party submodules,
# staged with the wasm denormal guards exactly as emscripten/build.sh compiles
# them (tools/plaits_sources.mjs). Skipped when the submodules are absent.
if PLAITS_UNITS="$(node "$SCRIPT_DIR/../../tools/plaits_sources.mjs" --stage "$TMP/plaits_src" 2>/dev/null)"; then
    echo "Compiling the staged Plaits sources (upstream warnings off)…"
    mkdir -p "$TMP/plaits_obj"
    for f in $PLAITS_UNITS; do
        obj="$TMP/plaits_obj/$(echo "${f#"$TMP"/plaits_src/}" | tr '/' '_').o"
        g++ -std=c++17 -O2 -w -DTEST \
            -isystem "$TMP/plaits_src/eurorack" -isystem "$TMP/plaits_src" \
            -c "$f" -o "$obj"
    done
    echo "Compiling macro_offline_test…"
    g++ -std=c++17 -O2 -Wall -Wextra -DTEST \
        -I "$SCRIPT_DIR/emscripten_stub" \
        -isystem "$TMP/plaits_src/eurorack" -isystem "$TMP/plaits_src" \
        "$SCRIPT_DIR/macro_offline_test.cpp" "$TMP"/plaits_obj/*.o \
        -o "$TMP/macro_offline_test"
    echo "Running macro_offline_test…"
    "$TMP/macro_offline_test"
    echo
else
    echo "Skipping macro_offline_test (third_party/eurorack + third_party/stmlib not checked out)."
    echo "  Run: git submodule update --init --depth 1 third_party/eurorack third_party/stmlib"
    echo
fi

echo "Compiling rubberband_fx.cpp..."
g++ -std=c++17 -O2 -Wall -Wextra -Wno-unused-parameter \
    -I "$SCRIPT_DIR/emscripten_stub" \
    -c "$SCRIPT_DIR/../rubberband_fx.cpp" \
    -o "$TMP/rubberband_fx.o"
echo "rubberband_fx.cpp compiles successfully."
echo
