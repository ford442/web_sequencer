#!/bin/bash
set -euo pipefail

# Ensure we are in the emscripten directory
cd "$(dirname "$0")"

echo "Compiling Rubber Band WASM (Direct Source Build)..."

# Verify the library exists
if [ ! -d "rubberband" ]; then
    echo "Error: 'rubberband' directory not found in emscripten/."
    echo "Run: git clone https://github.com/breakfastquay/rubberband.git"
    exit 1
fi

# Define sources: The wrapper + all .cpp files in rubberband/src
SOURCES="rubberband_wrapper.cpp rubberband/src/*.cpp"

# Build command
# -O3: Optimize
# -frtti: Enable RTTI (Required for Embind)
# -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0: Suppress strict type checks
# -DUSE_KISSFFT: Use internal FFT implementation
em++ -O3 \
    -frtti \
    -fexceptions \
    -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 \
    -DUSE_KISSFFT \
    -DPROCESS_CMAKE_PROJECT \
    -I . \
    -I rubberband \
    -I rubberband/rubberband \
    $SOURCES \
    --bind \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME='createRubberBandModule' \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
    -s ENVIRONMENT='web,worker' \
    -o ../public/rubberband.js

echo "Success! Created ../public/rubberband.js"
