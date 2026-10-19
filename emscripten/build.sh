#!/bin/bash
# Build script for the Hyphon voice module (303 family, Prophecy, drum kit,
# the macro / Plaits voices).
#
# Emits TWO voice modules from the same sources (see
# docs/wasm/BUILD_NOTES.md#threading-profiles):
#   public/hyphon_native.{js,wasm}     — pthread build (-pthread), shared imported memory
#   public/hyphon_native.st.{js,wasm}  — single-threaded build, non-shared imported memory.
#       Loaded by the worklets when the page is not crossOriginIsolated, on WebKit, or
#       when Open303Config.forceSingleThreaded is set.
# The two differ only in threading and memory: same sources, same exports, both
# --no-entry. Pthread workers are inlined in the glue (no *.worker.js).
#
# Neither module has a caller on the main thread. The AudioWorklets instantiate
# the .wasm by hand (src/audio-worklets/hyphonNativeSession.ts); the glue is read
# only for its export-name map. The Pyodide bootstrap that used to ride along as
# --post-js + main() is src/pyodide/bootstrap.ts.
#
# Usage:
#   ./emscripten/build.sh [release|debug]
#   HYPHON_BUILD_PROFILE=debug ./emscripten/build.sh
#
# Profiles (see docs/wasm/BUILD_NOTES.md):
#   release (default) — -O3 -flto compile and link, ASSERTIONS=0, no DWARF
#   debug             — -O1 -g3 compile, ASSERTIONS=2, STACK_OVERFLOW_CHECK=2,
#                       source maps

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

echo "Building hyphon_native (pthread + single-threaded, profile=$BUILD_PROFILE)..."

# The pinned Emscripten (emscripten/toolchain.json), or fail.
source "$SCRIPT_DIR/toolchain_env.sh"

OUTPUT_JS="$REPO_ROOT/public/hyphon_native.js"
OUTPUT_ST_JS="$REPO_ROOT/public/hyphon_native.st.js"
TEMP_ROOT="$SCRIPT_DIR/temp_build"
rm -rf "$TEMP_ROOT"
mkdir -p "$TEMP_ROOT"

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
ST_INITIAL_MEMORY_MB="$(node -p "require('$BUDGET_JSON').hyphonNativeSt.initialMemoryMb")"
ST_MAXIMUM_MEMORY_MB="$(node -p "require('$BUDGET_JSON').hyphonNativeSt.maximumMemoryMb")"
ST_STACK_SIZE_MB="$(node -p "require('$BUDGET_JSON').hyphonNativeSt.stackSizeMb")"
echo "  ST memory budget: INITIAL=${ST_INITIAL_MEMORY_MB}mb MAXIMUM=${ST_MAXIMUM_MEMORY_MB}mb STACK=${ST_STACK_SIZE_MB}mb"

# ---------------------------------------------------------
# FLAGS
# ---------------------------------------------------------
# Common flags
# No -mrelaxed-simd: it is outside the Safari feature intersection.
# No OpenMP: nothing here is compiled with -fopenmp (the threads are Emscripten
# pthreads), and the committed libomp.a is gone.
# -pthread is per profile (THREAD_FLAGS below): pthread objects are built with the
# atomics feature and cannot be linked into the single-threaded module.
ARCH_FLAGS="-msimd128"

if [ "$BUILD_PROFILE" = "debug" ]; then
    # -O1 keeps the build debuggable while staying fast enough to run in real time.
    OPT_FLAGS="-O1 -g3 -fno-omit-frame-pointer"
    LINK_PROFILE_FLAGS="-O1 -g3 -gsource-map -s ASSERTIONS=2 -s STACK_OVERFLOW_CHECK=2"
else
    # No -ffast-math anywhere in this module. Its one fast-math TU, the uncalled
    # audio_dsp.cpp, moved out to the offline mix bus (build_mix_bus.sh, #1341).
    # -ffast-math implies -ffinite-math-only and
    # -fno-signed-zeros, which lets the compiler assume no NaN/Inf ever reaches a
    # recursive filter: the diode-ladder and TB-303 IIR sections can then latch a
    # NaN instead of settling, and reassociated accumulations drift the 303
    # spectrogram baselines in scripts/generate_303_baselines.sh off their
    # reference. See docs/wasm/BUILD_NOTES.md#fast-math.
    #
    # Full LTO: every wrapper is its own TU, so without it nothing inlines across
    # open303_wrapper.cpp <-> the rosic DSP. -O3 at link runs the pinned emsdk's
    # in-band wasm-opt (the 3.1.51 one failed this module at -O2+, which is what
    # tools/optimize.sh used to work around). LTO must not move the IIR output:
    # tools/render_hyphon_native_parity.mjs is the gate (BUILD_NOTES#render-parity).
    OPT_FLAGS="-O3 -funroll-loops -flto"
    LINK_PROFILE_FLAGS="-O3 -flto -s ASSERTIONS=0"
fi

COMMON_FLAGS="$OPT_FLAGS $ARCH_FLAGS"

# Per-profile threading flags.
PTHREAD_THREAD_FLAGS="-pthread"
ST_THREAD_FLAGS=""

# Linker Flags (shared by both profiles; threading + memory are appended per profile).
#
# -lexports.js links no code (its one function is dead-stripped unless called), but
# it is emcc's documented switch for keeping wasm import/export NAMES unminified at
# -O2+ (tools/link.py). The worklets instantiate this wasm by hand: they satisfy
# imports by name (hyphonNativeImports.ts#createEmscriptenEnv) and must find
# __wasm_call_ctors, so minified names would turn emscripten_resize_heap / abort
# into guessed letters. Stable names also keep the export maps identity maps,
# byte-identical between CI and local builds.
#
# No --bind / -frtti: there are no EMSCRIPTEN_BINDINGS left; every caller goes
# through the C exports. No WASM=1 / WASM_BIGINT=1: both are the 6.x defaults.
BASE_LINK_FLAGS="$LINK_PROFILE_FLAGS $ARCH_FLAGS -s ALLOW_MEMORY_GROWTH=1 -s ENVIRONMENT=web,worker -s EXPORT_ES6=1 --pre-js $SCRIPT_DIR/pre.js --no-entry -lexports.js"

# pthread: shared imported memory, worker pool.
PTHREAD_LINK_FLAGS="$BASE_LINK_FLAGS -pthread -s PTHREAD_POOL_SIZE=$PTHREAD_POOL_SIZE -s INITIAL_MEMORY=${INITIAL_MEMORY_MB}mb -s MAXIMUM_MEMORY=${MAXIMUM_MEMORY_MB}mb -s STACK_SIZE=${STACK_SIZE_MB}mb"

# single-threaded: the memory is IMPORTED and non-shared so the worklet can size
# it from the same budget key.
ST_LINK_FLAGS="$BASE_LINK_FLAGS -s IMPORTED_MEMORY=1 -s INITIAL_MEMORY=${ST_INITIAL_MEMORY_MB}mb -s MAXIMUM_MEMORY=${ST_MAXIMUM_MEMORY_MB}mb -s STACK_SIZE=${ST_STACK_SIZE_MB}mb"

# EXPORTED_FUNCTIONS come from emscripten/wasm_export_manifest.json — the one
# declared list of the C API (#1344). Add an export there, not here; the map
# check after each link fails on any drift from it. Both profiles export the
# same surface.
VOICE_EXPORTS="$(node "$REPO_ROOT/tools/hyphon_native_exports.mjs")"
PTHREAD_EXPORTS="$VOICE_EXPORTS"
ST_EXPORTS="$VOICE_EXPORTS"

# ---------------------------------------------------------
# PLAITS SOURCES (the macro-* engine family)
# ---------------------------------------------------------
# tools/plaits_sources.mjs owns the list (the host test and
# scripts/native-worlds.mjs read it too). It copies the pinned submodules'
# sources into the temp dir and applies the denormal guards from
# tools/plaits_wasm_patches.mjs — wasm has no flush-to-zero. The submodules are
# never modified. An uninitialised submodule, or a guard upstream moved, fails
# here by name rather than deep in em++.
PLAITS_STAGE="$TEMP_ROOT/plaits_src"
if ! PLAITS_UNITS="$(node "$REPO_ROOT/tools/plaits_sources.mjs" --stage "$PLAITS_STAGE")"; then
    echo "❌ Could not stage the Plaits sources (see above)." >&2
    exit 1
fi

# ---------------------------------------------------------
# COMPILE + LINK (once per threading profile)
# ---------------------------------------------------------
build_profile() {
    local variant=$1          # pthread | st
    local output_js=$2
    local thread_flags=$3
    local link_flags=$4
    local exports=$5
    local map_json=$6

    local temp_dir="$TEMP_ROOT/$variant"
    mkdir -p "$temp_dir"

    local includes="-I $SCRIPT_DIR \
          -I $temp_dir \
          -I $REPO_ROOT/jc303_wasm/src/dsp/open303 \
          -I $REPO_ROOT/jc303_wasm/src/dsp"

    # C++ Flags. No exceptions and no RTTI: the voice code neither throws nor
    # catches, and RTTI was only there for embind. (Rubber Band, a separate module,
    # keeps -fexceptions.)
    local CXXFLAGS="$COMMON_FLAGS $thread_flags -std=c++17 -fno-exceptions -fno-rtti"

    # Helper to compile C++ files. IEEE-safe math only (see the -ffast-math note
    # above OPT_FLAGS). Extra arguments are per-file flags.
    compile_cpp() {
        local src=$1
        shift
        local obj="$temp_dir/$(basename "${src%.*}").o"
        echo "  [$variant C++] $src -> $obj"
        em++ -c "$src" -o "$obj" $includes $CXXFLAGS "$@"
    }

    # Mutable Instruments Plaits, from the staged copy (PLAITS SOURCES above).
    # -DTEST is upstream's portable-host switch: it swaps the Cortex-M4 asm in
    # stmlib/dsp/dsp.h (ssat, vsqrt) for plain C++. -isystem keeps upstream's
    # warnings out of our build log. Object names carry a plaits_ prefix:
    # several basenames (string.cc, units.cc, …) would otherwise collide in
    # the flat temp dir.
    local PLAITS_FLAGS="-DTEST -isystem $PLAITS_STAGE/eurorack -isystem $PLAITS_STAGE"
    compile_plaits() {
        local src=$1
        local rel="${src#$PLAITS_STAGE/}"
        local obj="$temp_dir/plaits_$(echo "${rel%.*}" | tr '/' '_').o"
        echo "  [$variant C++] $rel -> $obj"
        em++ -c "$src" -o "$obj" $includes $CXXFLAGS $PLAITS_FLAGS
    }

    echo "Compiling Objects ($variant)..."

    # The offline mix/gain/peak DSP (formerly audio_dsp.cpp + libomp.a, linked here
    # with no caller) is its own module now: emscripten/build_mix_bus.sh. Nothing
    # in this voice module uses OpenMP, so libomp.a is not linked.

    # 1. Phase-2 high-fidelity diode-ladder offline reference (highfid-cpu)
    compile_cpp "$SCRIPT_DIR/highfid303_wrapper.cpp"

    # 2. Compile custom Open303 TB-303 synthesizer engine
    compile_cpp "$SCRIPT_DIR/open303_wrapper.cpp"

    # 3. Compile authentic rosic Open303 DSP (from jc303_wasm submodule)
    for f in $REPO_ROOT/jc303_wasm/src/dsp/open303/*.cpp; do
        compile_cpp "$f"
    done
    compile_cpp "$SCRIPT_DIR/jc303_wrapper.cpp"

    # 4. Compile Korg Prophecy formant synthesis engine (self-contained wrapper)
    compile_cpp "$SCRIPT_DIR/prophecy_wrapper.cpp"

    # 5. Analog 808/909 drum kit (same module, new handles — one kit instance)
    compile_cpp "$SCRIPT_DIR/drumkit_wrapper.cpp"

    # 6. macro-* voices: Plaits DSP + the polyphonic wrapper on the voice core.
    #    upstream voice.cc is not built — macro_wrapper.cpp is its DAW port.
    for f in $PLAITS_UNITS; do
        compile_plaits "$f"
    done
    compile_cpp "$SCRIPT_DIR/macro_wrapper.cpp" $PLAITS_FLAGS

    echo "Linking ($variant)..."

    local objects
    objects=$(find "$temp_dir" -name "*.o")

    em++ $objects -o "$output_js" \
      $link_flags \
      -s EXPORTED_FUNCTIONS="$exports"

    echo "Extracting WASM export name map ($variant) for AudioWorklets..."
    node "$REPO_ROOT/tools/extract_wasm_export_map.mjs" "$output_js" "$map_json"
    echo "Validating export map against emscripten/wasm_export_manifest.json and the linked wasm..."
    node "$REPO_ROOT/tools/check_wasm_export_map.mjs" \
        --map "$map_json" \
        --glue "$output_js" \
        --wasm "${output_js%.js}.wasm"
}

build_profile pthread "$OUTPUT_JS" "$PTHREAD_THREAD_FLAGS" "$PTHREAD_LINK_FLAGS" \
    "$PTHREAD_EXPORTS" "$REPO_ROOT/public/hyphon_wasm_export_map.json"

build_profile st "$OUTPUT_ST_JS" "$ST_THREAD_FLAGS" "$ST_LINK_FLAGS" \
    "$ST_EXPORTS" "$REPO_ROOT/public/hyphon_wasm_export_map.st.json"

# A single-threaded module must not import shared memory or spawn workers, and
# neither module may carry libomp, embind or emscripten_run_script.
node "$REPO_ROOT/tools/check_hyphon_st_module.mjs" "${OUTPUT_ST_JS%.js}.wasm"
node "$REPO_ROOT/tools/check_hyphon_st_module.mjs" --symbols-only "${OUTPUT_JS%.js}.wasm"

echo "Build successful! (profile=$BUILD_PROFILE)"
echo "Generated: public/hyphon_native.js (and .wasm)"
echo "Generated: public/hyphon_native.st.js (and .wasm)"
rm -rf "$TEMP_ROOT"
