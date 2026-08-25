#!/bin/bash
# Build script for Hyphon Emscripten WASM module
# Optimized for: Multithreading (Pthreads) + SIMD + Reliability
#
# Usage:
#   ./emscripten/build.sh [release|debug]
#   HYPHON_BUILD_PROFILE=debug ./emscripten/build.sh
#   HYPHON_LEGACY_JC303=1 ./emscripten/build.sh    # keep the single-instance jc303_* API
#
# Profiles (see docs/wasm/BUILD_NOTES.md):
#   release (default) — -O3 compile, ASSERTIONS=0, no DWARF, legacy exports pruned
#   debug             — -O1 -g3 compile, ASSERTIONS=2, STACK_OVERFLOW_CHECK=2,
#                       source maps, full export surface (legacy jc303_* kept)

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

echo "Building hyphon_native.js (Safe Pthread Build, profile=$BUILD_PROFILE)..."

# Source Emscripten
CANDIDATES=(
    "/content/build_space/emsdk/emsdk_env.sh"
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
)
for f in "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then source "$f"; break; fi
done

OUTPUT_JS="$REPO_ROOT/public/hyphon_native.js"
TEMP_DIR="$SCRIPT_DIR/temp_build"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# Rubber Band is NOT part of this module. It is built separately by
# emscripten/build_rubberband.sh into public/rubberband.wasm, which is what
# src/audio-worklets/{rubberband,sustain}-processor.ts actually instantiate
# (via createRubberBandModule). Linking it here only shared its ~40 MB stretch
# transient with the live 303 voices' heap for no caller.
# See docs/wasm/BUILD_NOTES.md#module-split.

# ---------------------------------------------------------
# MEMORY BUDGET (single source of truth)
# ---------------------------------------------------------
# emscripten/wasm_memory_budget.json is also read by
# src/audio-worklets/hyphonNativeImports.ts, which allocates the imported
# WebAssembly.Memory for the worklet instantiation path. Both sides must agree —
# src/__tests__/wasmMemoryBudget.test.ts enforces that in CI.
BUDGET_JSON="$SCRIPT_DIR/wasm_memory_budget.json"
INITIAL_MEMORY_MB="$(node -p "require('$BUDGET_JSON').hyphonNative.initialMemoryMb")"
MAXIMUM_MEMORY_MB="$(node -p "require('$BUDGET_JSON').hyphonNative.maximumMemoryMb")"
STACK_SIZE_MB="$(node -p "require('$BUDGET_JSON').hyphonNative.stackSizeMb")"
PTHREAD_POOL_SIZE="$(node -p "require('$BUDGET_JSON').hyphonNative.pthreadPoolSize")"
echo "  Memory budget: INITIAL=${INITIAL_MEMORY_MB}mb MAXIMUM=${MAXIMUM_MEMORY_MB}mb STACK=${STACK_SIZE_MB}mb"

# ---------------------------------------------------------
# FLAGS
# ---------------------------------------------------------
# Common flags
# Removed -mrelaxed-simd and -flto/-flto=thin for CI compatibility (Emscripten 3.1.51)
# Re-enabled : Emscripten 3.1.51 provides its own WASM-compatible OpenMP
# runtime when linking with -s USE_PTHREADS=1. We do NOT use a host system libomp.
ARCH_FLAGS="-msimd128 -pthread -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 -DPROCESS_CMAKE_PROJECT"

# Legacy single-instance jc303_* API (jc303_init / jc303_setCutoff / ...).
# Nothing in the shipped app calls it against hyphon_native.wasm: the worklet only
# reaches for it when open303_* is missing, which is the standalone jc303-single.wasm
# path (tools/build_jc303_omp.sh). Compiled out of release builds; kept in debug so
# the legacy path stays testable.
HYPHON_LEGACY_JC303="${HYPHON_LEGACY_JC303:-}"
if [ -z "$HYPHON_LEGACY_JC303" ]; then
    if [ "$BUILD_PROFILE" = "debug" ]; then HYPHON_LEGACY_JC303=1; else HYPHON_LEGACY_JC303=0; fi
fi
ARCH_FLAGS="$ARCH_FLAGS -DHYPHON_LEGACY_JC303=$HYPHON_LEGACY_JC303"

if [ "$BUILD_PROFILE" = "debug" ]; then
    # -O1 keeps the build debuggable while staying fast enough to run in real time.
    OPT_FLAGS="-O1 -g3 -fno-omit-frame-pointer"
    LINK_PROFILE_FLAGS="-O1 -g3 -gsource-map -s ASSERTIONS=2 -s STACK_OVERFLOW_CHECK=2"
else
    # No -ffast-math here. It is opt-in per translation unit via compile_cpp_fast
    # (audio_dsp.cpp only). -ffast-math implies -ffinite-math-only and
    # -fno-signed-zeros, which lets the compiler assume no NaN/Inf ever reaches a
    # recursive filter: the diode-ladder and TB-303 IIR sections can then latch a
    # NaN instead of settling, and reassociated accumulations drift the 303
    # spectrogram baselines in scripts/generate_303_baselines.sh off their
    # reference. See docs/wasm/BUILD_NOTES.md#fast-math.
    OPT_FLAGS="-O3 -funroll-loops"
    # Link-time -O1 (not -O3) is deliberate: at -O2+ em++ 3.1.51 runs wasm-opt with a
    # feature set that does not match the pthreads+SIMD module and the link fails.
    # Revisit only with a pinned binaryen — see docs/wasm/BUILD_NOTES.md#wasm-opt.
    LINK_PROFILE_FLAGS="-O1 -s ASSERTIONS=0"
fi

COMMON_FLAGS="$OPT_FLAGS $ARCH_FLAGS"

# C++ Flags. USE_KISSFFT / USE_SPEEX are gone with Rubber Band - nothing left in
# this module uses them.
CXXFLAGS="$COMMON_FLAGS -frtti -DUSE_PTHREADS -std=c++17"

# Fast-math variant, used only by compile_cpp_fast. In the debug profile this is
# identical to CXXFLAGS so debug builds stay bit-comparable with the reference.
if [ "$BUILD_PROFILE" = "debug" ]; then
    CXXFLAGS_FAST="$CXXFLAGS"
else
    CXXFLAGS_FAST="$CXXFLAGS -ffast-math"
fi

# Linker Flags
LINK_FLAGS="$LINK_PROFILE_FLAGS $ARCH_FLAGS -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=$PTHREAD_POOL_SIZE -s WASM=1 -s WASM_BIGINT=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb -s MAXIMUM_MEMORY=${MAXIMUM_MEMORY_MB}mb -s STACK_SIZE=${STACK_SIZE_MB}mb -s ENVIRONMENT=web,worker -s EXPORT_ES6=1 --pre-js $SCRIPT_DIR/pre.js --post-js $SCRIPT_DIR/pyodide_bootstrap.js --bind"

EXPORTS="[ \
    '_main', \
    '_malloc', \
    '_free', \
    '_open303_create', \
    '_open303_destroy', \
    '_open303_init', \
    '_open303_note_on', \
    '_open303_note_off', \
    '_open303_all_notes_off', \
    '_open303_set_param', \
    '_open303_set_oversample', \
    '_open303_get_oversample', \
    '_open303_process', \
    '_open303_get_model_count', \
    '_open303_get_model_id', \
    '_open303_get_model_label', \
    '_open303_get_model_engine', \
    '_open303_set_model', \
    '_open303_get_model', \
    '_open303_find_model_index', \
    '_open303_set_model_by_id', \
    '_highfid303_create', \
    '_highfid303_destroy', \
    '_highfid303_init', \
    '_highfid303_note_on', \
    '_highfid303_note_off', \
    '_highfid303_all_notes_off', \
    '_highfid303_set_param', \
    '_highfid303_set_oversample', \
    '_highfid303_get_oversample', \
    '_highfid303_process', \
    '_highfid303_engine_id', \
    '_jc303_create', \
    '_jc303_destroy', \
    '_jc303_init_handle', \
    '_jc303_note_on', \
    '_jc303_note_off', \
    '_jc303_all_notes_off', \
    '_jc303_set_param', \
    '_jc303_process_handle', \
    '_prophecy_create', \
    '_prophecy_destroy', \
    '_prophecy_init', \
    '_prophecy_note_on', \
    '_prophecy_note_off', \
    '_prophecy_all_notes_off', \
    '_prophecy_set_param', \
    '_prophecy_process' \
]"

# Legacy single-instance jc303_* surface, appended only when compiled in.
LEGACY_JC303_EXPORTS="'_jc303_init', \
    '_jc303_noteOn', \
    '_jc303_noteOff', \
    '_jc303_allNotesOff', \
    '_jc303_setWaveform', \
    '_jc303_setCutoff', \
    '_jc303_setResonance', \
    '_jc303_setEnvMod', \
    '_jc303_setDecay', \
    '_jc303_setAccent', \
    '_jc303_setVolume', \
    '_jc303_setFilterMode', \
    '_jc303_process'"

if [ "$HYPHON_LEGACY_JC303" = "1" ]; then
    EXPORTS="${EXPORTS%]*}, $LEGACY_JC303_EXPORTS ]"
fi

# ---------------------------------------------------------
# INCLUDE PATHS
# ---------------------------------------------------------
# Added -I $SCRIPT_DIR to find the local omp.h
INCLUDES="-I $SCRIPT_DIR \
          -I $TEMP_DIR \
          -I $REPO_ROOT/jc303_wasm/src/dsp/open303 \
          -I $REPO_ROOT/jc303_wasm/src/dsp"

echo "Compiling Objects..."

# Helper function to compile C++ files.
# Default: IEEE-safe math (see the -ffast-math note above CXXFLAGS_FAST).
compile_cpp() {
    local src=$1
    local obj="$TEMP_DIR/$(basename "${src%.*}").o"
    echo "  [C++] $src -> $obj"
    em++ -c "$src" -o "$obj" $INCLUDES $CXXFLAGS
}

# Opt-in fast-math variant. Only for kernels with no recursive filter state and
# no baseline-comparison contract - currently just audio_dsp.cpp (mix/gain/pan).
compile_cpp_fast() {
    local src=$1
    local obj="$TEMP_DIR/$(basename "${src%.*}").o"
    echo "  [C++/fast-math] $src -> $obj"
    em++ -c "$src" -o "$obj" $INCLUDES $CXXFLAGS_FAST
}

# 1. Compile Audio DSP.
# The one fast-math consumer: block mix / gain / pan over stateless float arrays,
# where reassociation is safe and vectorises well. Everything below is compiled
# IEEE-safe.
compile_cpp_fast "$SCRIPT_DIR/audio_dsp.cpp"

# 2. Phase-2 high-fidelity diode-ladder offline reference (highfid-cpu)
compile_cpp "$SCRIPT_DIR/highfid303_wrapper.cpp"

# 3. Compile custom Open303 TB-303 synthesizer engine
compile_cpp "$SCRIPT_DIR/open303_wrapper.cpp"

# 4. Compile authentic rosic Open303 DSP (from jc303_wasm submodule)
for f in $REPO_ROOT/jc303_wasm/src/dsp/open303/*.cpp; do
    compile_cpp "$f"
done
compile_cpp "$SCRIPT_DIR/jc303_wrapper.cpp"

# 5. Compile Korg Prophecy formant synthesis engine (self-contained wrapper)
compile_cpp "$SCRIPT_DIR/prophecy_wrapper.cpp"

# 6. Compile Main
compile_cpp "$SCRIPT_DIR/main.cpp"

echo "Linking..."

# Collect all object files
OBJECTS=$(find "$TEMP_DIR" -name "*.o")

em++ $OBJECTS "$SCRIPT_DIR/libomp.a" -o "$OUTPUT_JS" \
  $LINK_FLAGS \
  -s EXPORTED_FUNCTIONS="$EXPORTS"

if [ $? -eq 0 ]; then
    echo "Extracting WASM export name map for AudioWorklets..."
    node "$REPO_ROOT/tools/extract_wasm_export_map.mjs" \
        "$OUTPUT_JS" \
        "$REPO_ROOT/public/hyphon_wasm_export_map.json"
    echo "Validating export map against emscripten/wasm_export_manifest.json..."
    node "$REPO_ROOT/tools/check_wasm_export_map.mjs" --glue "$OUTPUT_JS"
    # Emscripten 3.1.51 emits hyphon_native.worker.js; 6.x inlines pthread workers.
    node "$REPO_ROOT/scripts/ensure-pthread-worker-stamp.mjs" \
        --src-dir "$REPO_ROOT/public" \
        --stem hyphon_native \
        --dest "$REPO_ROOT/public/hyphon_native.worker.js"
    echo "Build successful! (profile=$BUILD_PROFILE, legacy_jc303=$HYPHON_LEGACY_JC303)"
    echo "Generated: public/hyphon_native.js (and .wasm/.worker.js)"
    rm -rf "$TEMP_DIR"
else
    echo "Build failed."
    exit 1
fi
