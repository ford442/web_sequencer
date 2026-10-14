#!/bin/bash
# emscripten/build_mix_bus.sh
#
# Builds the offline stereo mix bus as its OWN wasm module (#1341), separate
# from hyphon_native — the same rule as Rubber Band: an offline transient must
# not share a heap with the live 303 voices. It replaces audio_dsp.cpp, which
# was linked into the pthread voice module with no caller (and, never having
# been compiled with -fopenmp, never ran a single OpenMP pragma either).
# See docs/wasm/BUILD_NOTES.md#mix-bus.
#
# Output:
#   public/mix_bus.wasm   standalone reactor, zero imports, fixed memory.
#                         Instantiated by src/workers/mixBus.worker.ts via
#                         src/audio/offline/mixBus/mixBusKernel.ts — there is
#                         no Emscripten JS glue to drift between emcc versions.
#
# Usage:
#   ./emscripten/build_mix_bus.sh [release|debug]
#   pnpm run build:wasm:mixbus

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

echo "Building mix bus (standalone module, profile=$BUILD_PROFILE)..."

# The pinned Emscripten (emscripten/toolchain.json), or fail.
source "$SCRIPT_DIR/toolchain_env.sh"

# ---------------------------------------------------------
# MEMORY BUDGET (single source of truth)
# ---------------------------------------------------------
# emscripten/wasm_memory_budget.json#mixBus. The module owns its memory and
# never grows it: the scratch blocks are static, so INITIAL is the whole heap.
BUDGET_JSON="$SCRIPT_DIR/wasm_memory_budget.json"
INITIAL_MEMORY_MB="$(node -p "require('$BUDGET_JSON').mixBus.initialMemoryMb")"
STACK_SIZE_MB="$(node -p "require('$BUDGET_JSON').mixBus.stackSizeMb")"
echo "  Memory budget: INITIAL=${INITIAL_MEMORY_MB}mb (fixed) STACK=${STACK_SIZE_MB}mb"

# ---------------------------------------------------------
# FLAGS
# ---------------------------------------------------------
# -ffast-math is scoped to this one translation unit (see mix_bus.cpp and
# BUILD_NOTES#fast-math). The debug profile drops it so a debug build is
# bit-comparable with the IEEE reference.
if [ "$BUILD_PROFILE" = "debug" ]; then
    OPT_FLAGS="-O1 -g3"
    LINK_PROFILE_FLAGS="-O1 -g3 -s ASSERTIONS=2"
else
    OPT_FLAGS="-O3 -ffast-math"
    LINK_PROFILE_FLAGS="-O1 -s ASSERTIONS=0"
fi

# Keep in step with MIX_BUS_REQUIRED_EXPORTS in
# src/audio/offline/mixBus/mixBusKernel.ts (checked below).
MIX_BUS_EXPORTS=(
    mix_bus_abi_version mix_bus_block_frames
    mix_bus_in_ptr mix_bus_acc_ptr
    mix_bus_accumulate mix_bus_peak
)
EXPORTED_FUNCTIONS='['
for fn in "${MIX_BUS_EXPORTS[@]}"; do EXPORTED_FUNCTIONS+="\"_${fn}\", "; done
EXPORTED_FUNCTIONS="${EXPORTED_FUNCTIONS%, }]"

OUTPUT_WASM="$REPO_ROOT/public/mix_bus.wasm"

# STANDALONE_WASM + --no-entry: a reactor with no JS runtime to import from.
# No -pthread, no shared memory, no growth: the worker cannot reach a
# SharedArrayBuffer through this module even by accident.
em++ "$SCRIPT_DIR/mix_bus.cpp" \
    $OPT_FLAGS \
    -msimd128 \
    -std=c++17 \
    -fno-exceptions \
    -fno-rtti \
    $LINK_PROFILE_FLAGS \
    --no-entry \
    -s STANDALONE_WASM=1 \
    -s FILESYSTEM=0 \
    -s ALLOW_MEMORY_GROWTH=0 \
    -s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb \
    -s STACK_SIZE=${STACK_SIZE_MB}mb \
    -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
    -o "$OUTPUT_WASM"

node "$REPO_ROOT/tools/check_mix_bus_module.mjs" "$OUTPUT_WASM"

echo "Wasm: public/mix_bus.wasm"
