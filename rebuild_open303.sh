#!/bin/bash
#
# Quick rebuild script for JC-303 with proper stack size
# This fixes the stack overflow issue by rebuilding with 2MB stack

set -e

echo "========================================"
echo " JC-303 WASM Rebuild with Stack Fix"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check for Emscripten
if ! command -v emcc &> /dev/null; then
    echo -e "${RED}Error: Emscripten (emcc) not found!${NC}"
    echo "Please install and activate emsdk first:"
    echo "  https://emscripten.org/docs/getting_started/downloads.html"
    exit 1
fi

echo -e "${GREEN}Emscripten found:${NC} $(emcc --version | head -n1)"
echo ""

# Ensure submodule is initialized
if [ ! -f "jc303_wasm/wasm/CMakeLists.txt" ]; then
    echo -e "${YELLOW}Initializing jc303_wasm submodule...${NC}"
    git submodule update --init jc303_wasm
fi

# Option 1: Use the project's build script (recommended)
echo -e "${GREEN}Option 1: Using project's build script${NC}"
echo "This builds both threaded and single-threaded variants"
echo ""
read -p "Build with build_jc303_omp.sh? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    bash tools/build_jc303_omp.sh release both
    echo -e "${GREEN}Build complete!${NC}"
    exit 0
fi

# Option 2: Direct CMake build (faster, single variant)
echo -e "${GREEN}Option 2: Direct CMake build${NC}"
echo ""

BUILD_DIR="jc303_wasm/wasm/build_rebuild"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

echo -e "${YELLOW}Configuring with CMake...${NC}"
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="-O3" \
    -DCMAKE_CXX_FLAGS="-O3" \
    -DCMAKE_EXE_LINKER_FLAGS="-s ALLOW_MEMORY_GROWTH=1 -s STACK_SIZE=2097152 -O3"

echo -e "${YELLOW}Building...${NC}"
emmake make -j$(nproc)

echo -e "${YELLOW}Copying to public directory...${NC}"
cp -f jc303.js ../../../public/jc303.js
cp -f jc303.wasm ../../../public/jc303.wasm
if [ -f "jc303_worklet.js" ]; then
    cp -f jc303_worklet.js ../../../public/jc303-worklet.js
fi

cd -

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Rebuild Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Files updated in public/:"
ls -lh public/jc303*
echo ""
echo -e "${YELLOW}Note: Clear browser cache and reload to use new WASM${NC}"
