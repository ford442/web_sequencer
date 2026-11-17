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

# The pinned Emscripten (emscripten/toolchain.json), or fail.
source "$SCRIPT_DIR/toolchain_env.sh"

SOURCE_DIR="$REPO_ROOT/rubberband"
if [ ! -d "$SOURCE_DIR/src" ]; then
    echo "⬇️  Fetching Rubber Band source..."
    git -C "$REPO_ROOT" submodule update --init --recursive rubberband
fi
if [ ! -f "$SOURCE_DIR/rubberband/RubberBandStretcher.h" ]; then
    echo "Rubber Band public header missing at $SOURCE_DIR/rubberband/RubberBandStretcher.h" >&2
    exit 1
fi

# ---------------------------------------------------------
# MEMORY BUDGET (single source of truth)
# ---------------------------------------------------------
# emscripten/wasm_memory_budget.json#rubberband. Unlike hyphon_native this module
# owns its memory (the worklets do not pass an imported WebAssembly.Memory), so
# the contract is "no literals in this script". The memory is FIXED
# (ALLOW_MEMORY_GROWTH=0, BUILD_NOTES#rubberband-fixed-memory): a sample too long
# for it fails rb_fx_sample_alloc and runs on the TypeScript FX chain instead of
# growing the heap under the worklet's views.
BUDGET_JSON="$SCRIPT_DIR/wasm_memory_budget.json"
INITIAL_MEMORY_MB="$(node -p "require('$BUDGET_JSON').rubberband.initialMemoryMb")"
STACK_SIZE_MB="$(node -p "require('$BUDGET_JSON').rubberband.stackSizeMb")"
echo "  Memory budget: INITIAL=${INITIAL_MEMORY_MB}mb (fixed) STACK=${STACK_SIZE_MB}mb"

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
#
# No exceptions, no RTTI, no embind (like hyphon_native): the worklets call the
# extern "C" rb_* API in rubberband_wrapper.cpp. Rubber Band itself never catches;
# with -DNO_EXCEPTIONS its few throw sites (allocation failure, an FFT/resampler
# implementation error) abort() instead — what an uncaught throw already did,
# minus the JS-trampoline invoke_* on every call that -fexceptions cost.
if [ "$BUILD_PROFILE" = "debug" ]; then
    OPT_FLAGS="-O1 -g3"
    LINK_PROFILE_FLAGS="-O1 -g3 -gsource-map -s ASSERTIONS=2"
else
    # Same release profile as hyphon_native (BUILD_NOTES#wasm-opt): the -O1 link
    # was the emsdk 3.1.51 wasm-opt workaround, lifted on the 6.0.9 pin.
    OPT_FLAGS="-O3 -funroll-loops -flto"
    LINK_PROFILE_FLAGS="-O3 -flto -s ASSERTIONS=0"
fi

GLUE_JS="$REPO_ROOT/src/audio-worklets/rubberband-lib.js"

# The worklets have no fetch: they hand createRubberBandModule() the bytes the
# main thread fetched. emcc 4+ dropped `wasmBinary` from the default
# INCOMING_MODULE_JS_API, so without the explicit list below the glue silently
# ignores Module.wasmBinary and aborts with "both async and sync fetching of the
# wasm failed" inside the AudioWorklet.
#
# Likewise the HEAP views: since emcc 4 the glue keeps HEAPF32 / HEAPF64 as
# module-local vars and only puts them on the Module object when they are named
# in EXPORTED_RUNTIME_METHODS. The worklets (and the vocal-FX harness) read
# module.HEAPF32 / HEAPF64 for every block, so without them stretch output is
# written into `undefined`.

# EXPORTED_FUNCTIONS come from the `rubberband` section of
# emscripten/wasm_export_manifest.json — the stretcher (rb_*, rubberband_wrapper.cpp)
# and the native vocal FX chain (rb_fx_*, rubberband_fx.cpp). Add an export there,
# not here: gen:native-types turns the same list into src/shared/rt/rubberbandExports.ts
# (what stretcher.ts and nativeVocalFx.ts probe for), and check_rubberband_module.mjs
# below fails on any drift between it and the linked glue.
EXPORTED_FUNCTIONS="$(node "$REPO_ROOT/tools/hyphon_native_exports.mjs" --module rubberband)"

em++ $OPT_FLAGS \
    -msimd128 \
    -fno-rtti \
    -fno-exceptions \
    -DNO_EXCEPTIONS \
    -std=c++17 \
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
    "$SCRIPT_DIR/rubberband_fx.cpp" \
    $(find "$RB/src" -name "*.cpp" -not -path "*jni*" -not -path "*test*") \
    $(find "$RB/src/ext/kissfft" -name "*.c") \
    $(find "$RB/src/ext/speex" -name "*.c") \
    $LINK_PROFILE_FLAGS \
    -s ALLOW_MEMORY_GROWTH=0 \
    -s ABORTING_MALLOC=0 \
    -s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb \
    -s STACK_SIZE=${STACK_SIZE_MB}mb \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME='createRubberBandModule' \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue", "setValue", "HEAPF32", "HEAPF64"]' \
    -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
    -s INCOMING_MODULE_JS_API='["wasmBinary", "locateFile", "print", "printErr", "onAbort"]' \
    -s ENVIRONMENT='web,worker' \
    --pre-js "$SCRIPT_DIR/rubberband-pre.js" \
    -o "$GLUE_JS"

# The compiler writes rubberband-lib.wasm next to the glue; the worklet host
# fetches it from public/ as rubberband.wasm.
mv "$REPO_ROOT/src/audio-worklets/rubberband-lib.wasm" "$REPO_ROOT/public/rubberband.wasm"

# No embind, no exception runtime, and a memory that cannot grow.
node "$REPO_ROOT/tools/check_rubberband_module.mjs" "$REPO_ROOT/public/rubberband.wasm" "$GLUE_JS" "$INITIAL_MEMORY_MB"

rm -rf "$TEMP_DIR"

echo "✅ Glue:  src/audio-worklets/rubberband-lib.js"
echo "✅ Wasm:  public/rubberband.wasm"
