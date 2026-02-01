#!/bin/bash
# emscripten/build_rubberband.sh
set -euo pipefail

# Navigate to script directory
cd "$(dirname "$0")"

echo "🔨 Building Rubber Band (Standalone Module)..."

# 1. Initialize Submodule if missing
if [ ! -d "rubberband/src" ]; then
    echo "⬇️  Cloning Rubber Band..."
    git submodule update --init --recursive
    if [ ! -d "rubberband/src" ]; then
        git clone https://github.com/breakfastquay/rubberband.git
    fi
fi

# 1.5 Patch Rubber Band Source (Fix include path issue in VectorOpsComplex.cpp)
sed -i 's|#include "system/sysutils.h"|#include "sysutils.h"|' rubberband/src/common/VectorOpsComplex.cpp || true

# Fix size_t issue in sysutils.h
sed -i 's|#include <math.h>|#include <math.h>\n#include <cstddef>\nusing std::size_t;|' rubberband/src/common/sysutils.h || true

# 2. Compile Rubber Band -> src/audio-worklets/rubberband-lib.js
# We output the JS to src (for bundling) and will move the WASM to public
em++ -O3 \
    -frtti \
    -fexceptions \
    -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=1 \
    -DHAVE_KISSFFT \
    -DUSE_SPEEX \
    -DNO_THREADING \
    -DPROCESS_CMAKE_PROJECT \
    -I "$(pwd)" \
    -I "$(pwd)/rubberband" \
    -I "$(pwd)/rubberband/rubberband" \
    -I "$(pwd)/rubberband/src" \
    -I "$(pwd)/rubberband/src/ext/kissfft" \
    -I "$(pwd)/rubberband/src/ext/speex" \
    rubberband_wrapper.cpp \
    $(find rubberband/src -name "*.cpp" -not -path "*jni*" -not -path "*test*") \
    $(find rubberband/src/ext/kissfft -name "*.c") \
    $(find rubberband/src/ext/speex -name "*.c") \
    --bind \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME='createRubberBandModule' \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue", "setValue"]' \
    -s EXPORTED_FUNCTIONS='["_malloc", "_free"]' \
    -s ENVIRONMENT='web,worker' \
    --pre-js rubberband-pre.js \
    -o ../src/audio-worklets/rubberband-lib.js

# 3. Move the WASM file to public so it can be fetched
# The compiler outputs rubberband-lib.wasm next to the JS
mv ../src/audio-worklets/rubberband-lib.wasm ../public/rubberband.wasm

echo "✅ Success: JS lib written to src/audio-worklets/rubberband-lib.js"
echo "✅ Success: WASM binary moved to public/rubberband.wasm"
