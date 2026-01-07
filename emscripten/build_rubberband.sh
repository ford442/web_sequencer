#!/bin/bash
# Build script for Rubber Band Library WASM module
set -euo pipefail

echo "Building rubberband.js (Emscripten build)..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUBBERBAND_SRC_DIR="$REPO_ROOT/rubberband"
BUILD_DIR="$RUBBERBAND_SRC_DIR/build_wasm"
OUTPUT_JS="$REPO_ROOT/public/rubberband.js"
WRAPPER_CPP="$SCRIPT_DIR/rubberband_wrapper.cpp"

# Source Emscripten SDK
source "$REPO_ROOT/emsdk/emsdk_env.sh"

# 1. Configure Rubber Band with Meson for Emscripten
# We will create a static library with minimal features.
rm -rf "$BUILD_DIR"
meson setup "$RUBBERBAND_SRC_DIR" "$BUILD_DIR" \
    --cross-file "$SCRIPT_DIR/emscripten.meson.cross" \
    -Ddefault_library=static \
    -Dfft=builtin \
    -Dresampler=builtin \
    -Djni=disabled \
    -Dladspa=disabled \
    -Dlv2=disabled \
    -Dvamp=disabled \
    -Dcmdline=disabled \
    -Dtests=disabled

# 2. Build the static library using Ninja
ninja -C "$BUILD_DIR"

# 3. Link the static library with the C++ wrapper to create the final WASM module
echo "Linking with wrapper..."

# Find the built static library
# Meson typically places it in the build dir with a name like librubberband.a
STATIC_LIB_PATH=$(find "$BUILD_DIR" -name "librubberband.a")

if [ -z "$STATIC_LIB_PATH" ]; then
    echo "Error: Could not find static library librubberband.a in $BUILD_DIR"
    exit 1
fi

em++ -O3 -std=c++17 \
    "$WRAPPER_CPP" \
    "$STATIC_LIB_PATH" \
    -I "$RUBBERBAND_SRC_DIR/rubberband" \
    -I "$RUBBERBAND_SRC_DIR/src" \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="createRubberbandModule" \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT='web,worker' \
    --bind \
    -o "$OUTPUT_JS"

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "Generated: public/rubberband.js (and .wasm)"
else
    echo "Build failed during final linking."
    exit 1
fi
