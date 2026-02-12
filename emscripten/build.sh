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

# Copy Rubberband Source to Temp Directory
RUBBERBAND_SRC="$TEMP_DIR/rubberband"
mkdir -p "$RUBBERBAND_SRC"
echo "Copying Rubberband source from $REPO_ROOT/rubberband to $RUBBERBAND_SRC..."
cp -r "$REPO_ROOT/rubberband/"* "$RUBBERBAND_SRC/"

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
LINK_FLAGS="$COMMON_FLAGS -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s WASM=1 -s WASM_BIGINT=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=512mb -s ASSERTIONS=0 -s ENVIRONMENT=web,worker -s EXPORT_ES6=1 --pre-js $SCRIPT_DIR/pre.js --post-js $SCRIPT_DIR/pyodide_bootstrap.js --bind"

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
          -I $TEMP_DIR \
          -I $RUBBERBAND_SRC \
          -I $RUBBERBAND_SRC/rubberband \
          -I $RUBBERBAND_SRC/src \
          -I $RUBBERBAND_SRC/src/ext/kissfft \
          -I $RUBBERBAND_SRC/src/ext/speex"

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
if ! grep -q '#include "sysutils.h"' "$RUBBERBAND_SRC/src/common/VectorOpsComplex.cpp"; then
    sed -i 's|#include "system/sysutils.h"|#include "sysutils.h"|' "$RUBBERBAND_SRC/src/common/VectorOpsComplex.cpp" || true
fi

# Fix size_t issue in sysutils.h (needed for mathmisc.h etc)
echo "  [Patch] Fixing size_t in sysutils.h..."
if ! grep -q "using std::size_t;" "$RUBBERBAND_SRC/src/common/sysutils.h"; then
    sed -i 's|#include <math.h>|#include <math.h>\n#include <cstddef>\nusing std::size_t;|' "$RUBBERBAND_SRC/src/common/sysutils.h" || true
fi

# --- OPENMP PARALLELIZATION PATCHES ---
echo "  [Patch] Adding OpenMP parallelization to rubberband..."

# Add OpenMP include to main headers
for file in "$RUBBERBAND_SRC/src/faster/R2Stretcher.cpp" \
            "$RUBBERBAND_SRC/src/faster/StretcherProcess.cpp" \
            "$RUBBERBAND_SRC/src/finer/R3Stretcher.cpp" \
            "$RUBBERBAND_SRC/src/finer/R3LiveShifter.cpp"; do
    if [ -f "$file" ] && ! grep -q "#include <omp.h>" "$file"; then
        echo "    Adding OpenMP include to $(basename $file)..."
        sed -i '1s/^/#ifdef _OPENMP\n#include <omp.h>\n#endif\n/' "$file"
    fi
done

# Simple patch: Add OpenMP pragma before channel loops
# Pattern: for (int c = 0; c < ...channels...; ++c) {

# Patch R2Stretcher.cpp (uses m_channels only)
file="$RUBBERBAND_SRC/src/faster/R2Stretcher.cpp"
if [ -f "$file" ]; then
    if ! grep -q "#pragma omp parallel for" "$file"; then
        count=$(grep -c "for (int c = 0; c < .*channels" "$file" 2>/dev/null || echo 0)
        if [ "$count" -gt 0 ]; then
            echo "    Patching $count channel loops in R2Stretcher.cpp..."
            sed -i '/for (int c = 0; c < .*channels/i \
#ifdef _OPENMP\
#pragma omp parallel for schedule(static) if(m_channels > 2)\
#endif' "$file"
        fi
    else
        echo "    Skipping R2Stretcher.cpp (already patched)"
    fi
fi

# Patch StretcherProcess.cpp (uses m_channels only)
file="$RUBBERBAND_SRC/src/faster/StretcherProcess.cpp"
if [ -f "$file" ]; then
    if ! grep -q "#pragma omp parallel for" "$file"; then
        count=$(grep -c "for (int c = 0; c < .*channels" "$file" 2>/dev/null || echo 0)
        if [ "$count" -gt 0 ]; then
            echo "    Patching $count channel loops in StretcherProcess.cpp..."
            sed -i '/for (int c = 0; c < .*channels/i \
#ifdef _OPENMP\
#pragma omp parallel for schedule(static) if(m_channels > 2)\
#endif' "$file"
        fi
    else
        echo "    Skipping StretcherProcess.cpp (already patched)"
    fi
fi

# Patch R3Stretcher.cpp (uses m_parameters.channels)
file="$RUBBERBAND_SRC/src/finer/R3Stretcher.cpp"
if [ -f "$file" ]; then
    if ! grep -q "#pragma omp parallel for" "$file"; then
        count=$(grep -c "for (int c = 0; c < .*channels" "$file" 2>/dev/null || echo 0)
        if [ "$count" -gt 0 ]; then
            echo "    Patching $count channel loops in R3Stretcher.cpp..."
            sed -i '/for (int c = 0; c < .*channels/i \
#ifdef _OPENMP\
#pragma omp parallel for schedule(static) if(m_parameters.channels > 2)\
#endif' "$file"
        fi
    else
        echo "    Skipping R3Stretcher.cpp (already patched)"
    fi
fi

# Patch R3LiveShifter.cpp (uses m_parameters.channels)
file="$RUBBERBAND_SRC/src/finer/R3LiveShifter.cpp"
if [ -f "$file" ]; then
    if ! grep -q "#pragma omp parallel for" "$file"; then
        count=$(grep -c "for (int c = 0; c < .*channels" "$file" 2>/dev/null || echo 0)
        if [ "$count" -gt 0 ]; then
            echo "    Patching $count channel loops in R3LiveShifter.cpp..."
            sed -i '/for (int c = 0; c < .*channels/i \
#ifdef _OPENMP\
#pragma omp parallel for schedule(static) if(m_parameters.channels > 2)\
#endif' "$file"
        fi
    else
        echo "    Skipping R3LiveShifter.cpp (already patched)"
    fi
fi

echo "  [Patch] OpenMP parallelization complete."
# --- PATCH END ---

# 1. Compile C sources (KissFFT, Speex)
for f in $RUBBERBAND_SRC/src/ext/kissfft/*.c; do compile_c "$f"; done
for f in $RUBBERBAND_SRC/src/ext/speex/*.c; do compile_c "$f"; done

# 2. Compile C++ sources (Rubber Band Core)
compile_cpp "$RUBBERBAND_SRC/src/RubberBandStretcher.cpp"
compile_cpp "$RUBBERBAND_SRC/src/RubberBandLiveShifter.cpp"
compile_cpp "$RUBBERBAND_SRC/src/rubberband-c.cpp"

for f in $RUBBERBAND_SRC/src/common/*.cpp; do compile_cpp "$f"; done
for f in $RUBBERBAND_SRC/src/faster/*.cpp; do compile_cpp "$f"; done
for f in $RUBBERBAND_SRC/src/finer/*.cpp; do compile_cpp "$f"; done

# 3. Compile Audio DSP (OpenMP enabled)
compile_cpp "$SCRIPT_DIR/audio_dsp.cpp"

# 4. Compile Wrapper & Main
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
