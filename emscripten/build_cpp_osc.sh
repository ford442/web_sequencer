#!/bin/bash
# emscripten/build_cpp_osc.sh
#
# Builds the `cpp-*` oscillator family (#1665) as its OWN wasm module, separate
# from hyphon_native: the voice module's heap is sized for its voices, and an
# oscillator instantiated once per synth voice inside its own AudioWorklet must
# not share (or multiply) that heap. Same shape as the mix bus and the Rust OSC.
# See docs/wasm/BUILD_NOTES.md#cpp-osc.
#
# Output:
#   public/cpp_osc.wasm   standalone reactor, zero imports, fixed 2-page memory.
#                         Instantiated per voice by src/audio-worklets/cpp-osc-processor.ts
#                         and offline by src/audio/offline/OfflineCppOscEngine.ts —
#                         there is no Emscripten JS glue.
#
# Usage:
#   ./emscripten/build_cpp_osc.sh [release|debug]
#   pnpm run build:wasm:cpp

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_PROFILE="${1:-${HYPHON_BUILD_PROFILE:-release}}"
case "$BUILD_PROFILE" in
    release|debug) ;;
    *)
        echo "Unknown build profile '$BUILD_PROFILE' (expected 'release' or 'debug')." >&2
        exit 1
        ;;
esac

echo "Building C++ OSC (standalone module, profile=$BUILD_PROFILE)..."

# The pinned Emscripten (emscripten/toolchain.json), or fail.
source "$SCRIPT_DIR/toolchain_env.sh"

# ---------------------------------------------------------
# MEMORY BUDGET (single source of truth)
# ---------------------------------------------------------
# emscripten/wasm_memory_budget.json#cppOsc, in 64 KiB pages. Every byte the
# kernel touches is a static, so INITIAL is the whole memory and it never grows.
BUDGET_JSON="$SCRIPT_DIR/wasm_memory_budget.json"
INITIAL_MEMORY_PAGES="$(node -p "require('$BUDGET_JSON').cppOsc.initialMemoryPages")"
STACK_SIZE_BYTES="$(node -p "require('$BUDGET_JSON').cppOsc.stackSizeBytes")"
INITIAL_MEMORY_BYTES=$((INITIAL_MEMORY_PAGES * 65536))
echo "  Memory budget: INITIAL=${INITIAL_MEMORY_PAGES} pages (fixed) STACK=${STACK_SIZE_BYTES} B"

# ---------------------------------------------------------
# FLAGS
# ---------------------------------------------------------
# No -msimd128 on purpose: the kernel is scalar so it runs where WASM SIMD does
# not (that is what lets `cpp` catch a `rust-*` part on such a browser). No
# -ffast-math either: the residual tables and the phase accumulator rely on
# IEEE ordering (the onset/BLEP tests compare against a double reference).
if [ "$BUILD_PROFILE" = "debug" ]; then
    OPT_FLAGS="-O1 -g3"
    LINK_PROFILE_FLAGS="-O1 -g3 -s ASSERTIONS=2"
else
    OPT_FLAGS="-O3 -flto"
    LINK_PROFILE_FLAGS="-O3 -flto -s ASSERTIONS=0"
fi

# EXPORTED_FUNCTIONS come from the `cppOsc` section of
# emscripten/wasm_export_manifest.json; gen:native-types types the same list for
# src/shared/rt/cppOscExports.ts, and check_cpp_osc_module.mjs (below) checks the
# binary against it.
EXPORTED_FUNCTIONS="$(node "$REPO_ROOT/tools/hyphon_native_exports.mjs" --module cppOsc)"

OUTPUT_WASM="$REPO_ROOT/public/cpp_osc.wasm"
mkdir -p "$(dirname "$OUTPUT_WASM")"

# STANDALONE_WASM + --no-entry: a reactor with no JS runtime to import from.
# No -pthread, no shared memory, no growth, no exceptions: the AudioWorklet
# instantiates it with `{}` and nothing on the audio thread can allocate.
em++ "$SCRIPT_DIR/cpp_osc.cpp" \
    $OPT_FLAGS \
    -std=c++17 \
    -fno-exceptions \
    -fno-rtti \
    $LINK_PROFILE_FLAGS \
    --no-entry \
    -s STANDALONE_WASM=1 \
    -s FILESYSTEM=0 \
    -s ALLOW_MEMORY_GROWTH=0 \
    -s INITIAL_MEMORY=${INITIAL_MEMORY_BYTES} \
    -s STACK_SIZE=${STACK_SIZE_BYTES} \
    -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
    -o "$OUTPUT_WASM"

node "$REPO_ROOT/tools/check_cpp_osc_module.mjs" "$OUTPUT_WASM"

echo "Wasm: public/cpp_osc.wasm ($(wc -c < "$OUTPUT_WASM") B)"
