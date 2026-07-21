#!/bin/bash
# Offline buffer test for the first custom 303 voices (issue #898).
#
# Compiles emscripten/open303_wrapper.cpp with a host g++ (via the emscripten
# stubs in emscripten_stub/) and renders a fixed pattern through the stock,
# experimental-01 and 1ink303-v1 voices, asserting an audible difference vs
# stock while the stock path stays bit-identical. Requires no emsdk.
#
# Usage: bash emscripten/tests/run_offline_voices_test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mktemp -d)/tb303_voices_offline_test"

echo "Compiling offline voices test…"
g++ -std=c++17 -O2 -Wall -Wextra \
    -I "$SCRIPT_DIR/emscripten_stub" \
    "$SCRIPT_DIR/tb303_voices_offline_test.cpp" \
    -o "$OUT"

echo "Running…"
"$OUT"
