#!/bin/bash

# Exit on error
set -e

# Ensure we are in the emscripten directory
cd "$(dirname "$0")"

echo "Compiling Rubber Band WASM..."

# Check if library exists
if [ ! -d "rubberband" ]; then
    echo "Error: rubberband directory not found."
    exit 1
fi

# Define sources: Main wrapper + RubberBand Library implementation
SOURCES="rubberband/src/*.cpp rubberband_wrapper.cpp"

# NOTE: If RubberBand bundles KissFFT as .c files, we might need to include them.
# But standard src usually relies on internal or external headers.
# If you get linker errors about kiss_fft later, we will address that.

emcc -O3 \
    $SOURCES \
    -I . \
    -I rubberband \
    -I rubberband/rubberband \
    --bind \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME='createRubberBandModule' \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
    -s ENVIRONMENT='web,worker' \
    -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 \
    -DUSE_KISSFFT \
    -DPROCESS_CMAKE_PROJECT \
    -o ../public/rubberband.js

echo "Done. Build artifacts saved to ../public/rubberband.js"
