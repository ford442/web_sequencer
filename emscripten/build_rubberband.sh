#!/bin/bash

# Exit on error
set -e

# Ensure we are in the emscripten directory
cd "$(dirname "$0")"

echo "Compiling Rubber Band WASM..."

# Check if library exists
if [ ! -d "rubberband" ]; then
    echo "Error: rubberband directory not found."
    echo "Please run: git clone https://github.com/breakfastquay/rubberband.git emscripten/rubberband"
    exit 1
fi

# Define source files. 
# We compile all .cpp files in rubberband/src/
# We exclude files that might cause conflicts if they exist (like main.cpp inside src if any)
SOURCES="rubberband/src/*.cpp rubberband_wrapper.cpp"

emcc -O3 \
    $SOURCES \
    -I rubberband \
    -I rubberband/rubberband \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME='createRubberBandModule' \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
    -DUSE_KISSFFT \
    -DPROCESS_CMAKE_PROJECT \
    -o ../public/rubberband.js

echo "Done. Build artifacts saved to ../public/rubberband.js"
