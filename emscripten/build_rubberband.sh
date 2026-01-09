#!/bin/bash
set -euo pipefail

# Ensure we are in the emscripten directory
cd "$(dirname "$0")"

echo "Compiling Rubber Band WASM (Direct Source Build)..."

# 1. Check if the library is present
if [ ! -d "rubberband" ]; then
    echo "Cloning Rubber Band Library..."
    git clone https://github.com/breakfastquay/rubberband.git
fi

# 2. Define Source Files
# We compile the wrapper AND the library sources together.
# This eliminates the need for 'librubberband.a'
SOURCES="rubberband_wrapper.cpp rubberband/src/*.cpp"

# 3. Compile with Emscripten
# -O3: Aggressive optimization
# -frtti: Enable RTTI (REQUIRED for Embind to work)
# -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0: Suppress strict type name checks
# -DUSE_KISSFFT: Force Rubber Band to use its internal FFT (no external deps)
# --bind: Link Embind
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

echo "Success! Build artifacts saved to ../public/rubberband.js"
