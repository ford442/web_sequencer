#!/bin/bash
# emscripten/build_cpp_osc.sh
#
# Builds the `cpp-*` oscillator family (#1665) as its OWN wasm module, separate
# from hyphon_native: the voice module's heap is sized for its voices, and an
# oscillator instantiated once per synth voice inside its own AudioWorklet must
# not share (or multiply) that heap. Same shape as the mix bus and the Rust OSC.
# See docs/wasm/BUILD_NOTES.md#cpp-osc.
#
# Output (one source, two builds, #1667):
#   public/cpp_osc.wasm         -msimd128: the wasm_simd128.h paths of the kernel.
#                               What every browser with WASM SIMD runs.
#   public/cpp_osc_scalar.wasm  no SIMD: the same kernel's scalar paths, sample for
#                               sample the same output. Loaded by CppOscillator.ts
#                               only where the SIMD build does not validate, so
#                               `cpp` still catches a `rust-*` part there.
# Both: standalone reactor, zero imports, fixed 2-page memory. Instantiated per
# voice by src/audio-worklets/cpp-osc-processor.ts and offline by
# src/audio/offline/OfflineCppOscEngine.ts — there is no Emscripten JS glue.
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
# -msimd128 for cpp_osc.wasm only; the scalar twin passes -mno-simd128 so the
# autovectoriser cannot put a v128 in it either (check_cpp_osc_module.mjs checks
# both ways). Nothing beyond simd128: no relaxed-simd (its FMA would change the
# rounding), no bulk-memory, threads or exceptions. No -ffast-math either: the
# residual tables, the phase accumulator and the scalar/SIMD parity rely on
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

mkdir -p "$REPO_ROOT/public"

# STANDALONE_WASM + --no-entry: a reactor with no JS runtime to import from.
# No -pthread, no shared memory, no growth, no exceptions: the AudioWorklet
# instantiates it with `{}` and nothing on the audio thread can allocate.
build_variant() {
    local simd_flag="$1" output="$2" variant="$3"
    em++ "$SCRIPT_DIR/cpp_osc.cpp" \
        $OPT_FLAGS \
        "$simd_flag" \
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
        -o "$output"
    node "$REPO_ROOT/tools/check_cpp_osc_module.mjs" "$output" --variant "$variant"
    echo "Wasm: ${output#$REPO_ROOT/} ($(wc -c < "$output") B, $variant)"
}

build_variant -msimd128 "$REPO_ROOT/public/cpp_osc.wasm" simd
build_variant -mno-simd128 "$REPO_ROOT/public/cpp_osc_scalar.wasm" scalar
