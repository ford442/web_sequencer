#!/bin/bash
# emscripten/build_rubberband.sh
#
# Builds Rubber Band as its OWN wasm module, separate from hyphon_native.
#
# Why separate: the finer-engine stereo stretch is the dominant transient in the
# whole app (~40 MB). While it was linked into hyphon_native it shared a heap
# with the live 303 voices, so a stretch could force the voice module to grow
# mid-playback. Nothing ever called Rubber Band through hyphon_native either —
# src/audio-worklets/{rubberband,sustain}-processor.ts have always instantiated
# this module via createRubberBandModule(). See docs/wasm/BUILD_NOTES.md#module-split.
#
# Outputs:
#   src/audio-worklets/rubberband-lib.js  (ES6 glue, bundled by Vite)
#   public/rubberband.wasm                (fetched by the worklet host)
#
# Usage:
#   ./emscripten/build_rubberband.sh [release|debug]
#   pnpm run build:wasm:rubberband

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

echo "🔨 Building Rubber Band (standalone module, profile=$BUILD_PROFILE)..."

# Source Emscripten, same candidate list as build.sh.
CANDIDATES=(
    "/content/build_space/emsdk/emsdk_env.sh"
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
)
for f in "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then source "$f"; break; fi
done

SOURCE_DIR="$REPO_ROOT/rubberband"
if [ ! -d "$SOURCE_DIR/src" ]; then
    echo "⬇️  Fetching Rubber Band source..."
    (cd "$REPO_ROOT" && git submodule update --init --recursive) || true
fi
if [ ! -d "$SOURCE_DIR/src" ]; then
    echo "Rubber Band source not found at $SOURCE_DIR/src." >&2
    exit 1
fi

# ---------------------------------------------------------
# MEMORY BUDGET (single source of truth)
# ---------------------------------------------------------
# emscripten/wasm_memory_budget.json#rubberband. Unlike hyphon_native this module
# owns its memory (the worklets do not pass an imported WebAssembly.Memory), so
# the contract is only "no literals in this script".
BUDGET_JSON="$SCRIPT_DIR/wasm_memory_budget.json"
INITIAL_MEMORY_MB="$(node -p "require('$BUDGET_JSON').rubberband.initialMemoryMb")"
MAXIMUM_MEMORY_MB="$(node -p "require('$BUDGET_JSON').rubberband.maximumMemoryMb")"
STACK_SIZE_MB="$(node -p "require('$BUDGET_JSON').rubberband.stackSizeMb")"
echo "  Memory budget: INITIAL=${INITIAL_MEMORY_MB}mb MAXIMUM=${MAXIMUM_MEMORY_MB}mb STACK=${STACK_SIZE_MB}mb"

# ---------------------------------------------------------
# SOURCE COPY + PATCHES
# ---------------------------------------------------------
# Patch a copy, never the checked-out submodule: the two sed fixes below are not
# idempotent against an already-patched tree and would dirty the submodule.
TEMP_DIR="$SCRIPT_DIR/temp_build_rubberband"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
RB="$TEMP_DIR/rubberband"
mkdir -p "$RB"
cp -r "$SOURCE_DIR/"* "$RB/"

# Fix include path issue in VectorOpsComplex.cpp
if ! grep -q '#include "sysutils.h"' "$RB/src/common/VectorOpsComplex.cpp"; then
    sed -i 's|#include "system/sysutils.h"|#include "sysutils.h"|' "$RB/src/common/VectorOpsComplex.cpp" || true
fi
# Fix size_t issue in sysutils.h
if ! grep -q "using std::size_t;" "$RB/src/common/sysutils.h"; then
    sed -i 's|#include <math.h>|#include <math.h>\n#include <cstddef>\nusing std::size_t;|' "$RB/src/common/sysutils.h" || true
fi

# ---------------------------------------------------------
# FLAGS
# ---------------------------------------------------------
# No -ffast-math: Rubber Band's phase-vocoder accumulators and the resampler are
# exactly the recursive/reassociation-sensitive code the audit in
# docs/wasm/BUILD_NOTES.md#fast-math flagged. -msimd128 matches hyphon_native.
# NO_THREADING is deliberate — this module runs inside an AudioWorklet.
if [ "$BUILD_PROFILE" = "debug" ]; then
    OPT_FLAGS="-O1 -g3"
    LINK_PROFILE_FLAGS="-O1 -g3 -gsource-map -s ASSERTIONS=2"
else
    OPT_FLAGS="-O3 -funroll-loops"
    LINK_PROFILE_FLAGS="-O1 -s ASSERTIONS=0"
fi

GLUE_JS="$REPO_ROOT/src/audio-worklets/rubberband-lib.js"

em++ $OPT_FLAGS \
    -msimd128 \
    -frtti \
    -fexceptions \
    -std=c++17 \
    -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=1 \
    -DUSE_KISSFFT \
    -DHAVE_KISSFFT \
    -DUSE_SPEEX \
    -DNO_THREADING \
    -DPROCESS_CMAKE_PROJECT \
    -I "$SCRIPT_DIR" \
    -I "$RB" \
    -I "$RB/rubberband" \
    -I "$RB/src" \
    -I "$RB/src/ext/kissfft" \
    -I "$RB/src/ext/speex" \
    "$SCRIPT_DIR/rubberband_wrapper.cpp" \
    $(find "$RB/src" -name "*.cpp" -not -path "*jni*" -not -path "*test*") \
    $(find "$RB/src/ext/kissfft" -name "*.c") \
    $(find "$RB/src/ext/speex" -name "*.c") \
    --bind \
    $LINK_PROFILE_FLAGS \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb \
    -s MAXIMUM_MEMORY=${MAXIMUM_MEMORY_MB}mb \
    -s STACK_SIZE=${STACK_SIZE_MB}mb \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME='createRubberBandModule' \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue", "setValue"]' \
    -s EXPORTED_FUNCTIONS='["_malloc", "_free"]' \
    -s ENVIRONMENT='web,worker' \
    --pre-js "$SCRIPT_DIR/rubberband-pre.js" \
    -o "$GLUE_JS"

# The compiler writes rubberband-lib.wasm next to the glue; the worklet host
# fetches it from public/ as rubberband.wasm.
mv "$REPO_ROOT/src/audio-worklets/rubberband-lib.wasm" "$REPO_ROOT/public/rubberband.wasm"

rm -rf "$TEMP_DIR"

echo "✅ Glue:  src/audio-worklets/rubberband-lib.js"
echo "✅ Wasm:  public/rubberband.wasm"
