#!/bin/bash
# Build script for Candy World Emscripten WASM module
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

# ---------------------------------------------------------
# COMPILER FLAGS
# ---------------------------------------------------------
COMPILE_FLAGS="-O3 -msimd128 -mrelaxed-simd -ffast-math -flto -flto=thin -frtti -funroll-loops -mbulk-memory -fopenmp -pthread -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0"

# ---------------------------------------------------------
# LINKER FLAGS
# ---------------------------------------------------------
LINK_FLAGS="-O3 -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s WASM=1 -s WASM_BIGINT=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=512mb -s ASSERTIONS=0 -s ENVIRONMENT='web','worker' -flto -flto=thin --post-js $SCRIPT_DIR/pyodide_bootstrap.js --bind"

EXPORTS="[ \
    '_main', \
    '_malloc', \
    '_free' \
]"

echo "Compiling & Linking..."

# Clean old files to force full rebuild (prevents caching issues)
rm -f "$OUTPUT_JS" "$REPO_ROOT/public/hyphon_native.wasm" "$REPO_ROOT/public/hyphon_native.worker.js"

# Source files for the main application (wrapper and main)
SOURCES="$SCRIPT_DIR/main.cpp $SCRIPT_DIR/rubberband_wrapper.cpp"

# Include paths for the rubberband library
INCLUDES="-I $SCRIPT_DIR/rubberband/rubberband"

# Link against the static library built by Meson
RUBBERBAND_LIB_PATH="$SCRIPT_DIR/rubberband/build/librubberband.a"

em++ $SOURCES -o "$OUTPUT_JS" \
  $INCLUDES \
  $COMPILE_FLAGS \
  $LINK_FLAGS \
  $RUBBERBAND_LIB_PATH \
  -s EXPORTED_FUNCTIONS="$EXPORTS"

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "Generated: public/hyphon_native.js (and .wasm/.worker.js)"
else
    echo "Build failed."
    exit 1
fi
