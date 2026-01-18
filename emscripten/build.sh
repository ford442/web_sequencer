#!/bin/bash
# Build script for Hyphon Emscripten WASM module
# Optimized for: Multithreading (Pthreads) + SIMD + Reliability

set -euo pipefail

echo "Building hyphon_native.js (Safe Pthread Build)..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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
mkdir -p "$TEMP_DIR"

# ---------------------------------------------------------
# FLAGS
# ---------------------------------------------------------
# Common flags
COMMON_FLAGS="-O3 -msimd128 -mrelaxed-simd -ffast-math -flto -flto=thin -funroll-loops -mbulk-memory -fopenmp -pthread -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 -DPROCESS_CMAKE_PROJECT"

# C Flags
CFLAGS="$COMMON_FLAGS"

# C++ Flags
CXXFLAGS="$COMMON_FLAGS -frtti -DUSE_KISSFFT -DHAVE_KISSFFT -DUSE_PTHREADS -DUSE_SPEEX -std=c++17"

# Linker Flags
# -lomp is removed because we link against the static libomp.a directly
LINK_FLAGS="$COMMON_FLAGS -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s WASM=1 -s WASM_BIGINT=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=512mb -s ASSERTIONS=0 -s ENVIRONMENT='web','worker' --post-js $SCRIPT_DIR/pyodide_bootstrap.js --bind"

EXPORTS="[ \
    '_main', \
    '_malloc', \
    '_free' \
]"

# ---------------------------------------------------------
# INCLUDE PATHS
# ---------------------------------------------------------
# Added -I $SCRIPT_DIR to find the local omp.h
INCLUDES="-I $SCRIPT_DIR \
          -I $SCRIPT_DIR/rubberband \
          -I $SCRIPT_DIR/rubberband/rubberband \
          -I $SCRIPT_DIR/rubberband/src \
          -I $SCRIPT_DIR/rubberband/src/ext/kissfft \
          -I $SCRIPT_DIR/rubberband/src/ext/speex"

echo "Compiling Objects..."

# Helper function to compile C++ files
compile_cpp() {
    local src=$1
    local obj="$TEMP_DIR/$(basename "${src%.*}").o"
    echo "  [C++] $src -> $obj"
    em++ -c "$src" -o "$obj" $INCLUDES $CXXFLAGS
}

# Helper function to compile C files
compile_c() {
    local src=$1
    local obj="$TEMP_DIR/$(basename "${src%.*}").o"
    echo "  [C]   $src -> $obj"
    emcc -c "$src" -o "$obj" $INCLUDES $CFLAGS
}

# --- PATCH START ---
# Fix include path issue in VectorOpsComplex.cpp for the main build
echo "  [Patch] Fixing VectorOpsComplex.cpp include..."
sed -i 's|#include "system/sysutils.h"|#include "sysutils.h"|' "$SCRIPT_DIR/rubberband/src/common/VectorOpsComplex.cpp" || true

# Fix size_t issue in sysutils.h (needed for mathmisc.h etc)
echo "  [Patch] Fixing size_t in sysutils.h..."
sed -i 's|#include <math.h>|#include <math.h>\n#include <cstddef>\nusing std::size_t;|' "$SCRIPT_DIR/rubberband/src/common/sysutils.h" || true
# --- PATCH END ---

# 1. Compile C sources (KissFFT, Speex)
for f in $SCRIPT_DIR/rubberband/src/ext/kissfft/*.c; do compile_c "$f"; done
for f in $SCRIPT_DIR/rubberband/src/ext/speex/*.c; do compile_c "$f"; done

# 2. Compile C++ sources (Rubber Band Core)
compile_cpp "$SCRIPT_DIR/rubberband/src/RubberBandStretcher.cpp"
compile_cpp "$SCRIPT_DIR/rubberband/src/RubberBandLiveShifter.cpp"
compile_cpp "$SCRIPT_DIR/rubberband/src/rubberband-c.cpp"

for f in $SCRIPT_DIR/rubberband/src/common/*.cpp; do compile_cpp "$f"; done
for f in $SCRIPT_DIR/rubberband/src/faster/*.cpp; do compile_cpp "$f"; done
for f in $SCRIPT_DIR/rubberband/src/finer/*.cpp; do compile_cpp "$f"; done

# 3. Compile Wrapper & Main
compile_cpp "$SCRIPT_DIR/rubberband_wrapper.cpp"
compile_cpp "$SCRIPT_DIR/main.cpp"

echo "Linking..."

# Collect all object files
OBJECTS=$(find "$TEMP_DIR" -name "*.o")

# Check if we have the user-provided libomp.a (optional fallback)
USER_LIBOMP=""
if [ -f "$SCRIPT_DIR/libomp.a" ]; then
    echo "Found custom libomp.a, linking..."
    USER_LIBOMP="$SCRIPT_DIR/libomp.a"
else
    echo "Error: libomp.a not found in $SCRIPT_DIR!"
    exit 1
fi

em++ $OBJECTS "$USER_LIBOMP" -o "$OUTPUT_JS" \
  $LINK_FLAGS \
  -s EXPORTED_FUNCTIONS="$EXPORTS"

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "Generated: public/hyphon_native.js (and .wasm/.worker.js)"
    rm -rf "$TEMP_DIR"
else
    echo "Build failed."
    exit 1
fi
