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

SOURCES="rubberband/src/*.cpp rubberband_wrapper.cpp"

# Use em++ for C++ linking
# -O3 implies -fno-rtti, so we place -frtti AFTER it to override.
# We also define the macro to disable the unbound type name check just in case.

em++ -O3 \
    -frtti \
    -fexceptions \
    -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 \
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
    -s DISABLE_EXCEPTION_CATCHING=0 \
    -DUSE_KISSFFT \
    -DPROCESS_CMAKE_PROJECT \
    -o ../public/rubberband.js

echo "Done. Build artifacts saved to ../public/rubberband.js"
