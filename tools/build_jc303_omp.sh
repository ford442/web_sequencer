#!/bin/bash
#
# JC-303 WebAssembly Build Script with OpenMP Threading Support
#
# This script builds the JC-303 synthesizer for WebAssembly using Emscripten
# with OpenMP (OMP) threading enabled for reduced latency.
#
# Prerequisites:
#   - Emscripten SDK installed and activated (emsdk)
#   - CMake >= 3.15
#   - jc303_wasm submodule checked out
#
# Usage:
#   ./tools/build_jc303_omp.sh [debug|release]
#
# Licensed under GPL-3.0

set -e

# Configuration
BUILD_TYPE="${1:-release}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
JC303_DIR="$REPO_ROOT/jc303_wasm"
WASM_DIR="$JC303_DIR/wasm"
BUILD_DIR="$WASM_DIR/build_omp"
DIST_DIR="$WASM_DIR/dist"
PUBLIC_DIR="$REPO_ROOT/public"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} JC-303 WebAssembly Build (OMP)${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if jc303_wasm submodule exists
if [ ! -d "$JC303_DIR" ]; then
    echo -e "${RED}Error: jc303_wasm submodule not found!${NC}"
    echo "Run: git submodule update --init jc303_wasm"
    exit 1
fi

# Source Emscripten if available
EMSDK_CANDIDATES=(
    "/content/build_space/emsdk/emsdk_env.sh"
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
)
for f in "${EMSDK_CANDIDATES[@]}"; do
    if [ -f "$f" ]; then 
        source "$f"
        break
    fi
done

# Check for Emscripten
if ! command -v emcc &> /dev/null; then
    echo -e "${RED}Error: Emscripten (emcc) not found!${NC}"
    echo "Please install and activate the Emscripten SDK:"
    echo "  https://emscripten.org/docs/getting_started/downloads.html"
    exit 1
fi

echo -e "${GREEN}Using Emscripten:${NC} $(emcc --version | head -n1)"

# Create build directory
echo -e "${YELLOW}Creating build directory...${NC}"
mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

# OpenMP flags for Emscripten
OMP_FLAGS="-pthread -fopenmp"
LINK_OMP_FLAGS="-s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s PROXY_TO_PTHREAD=0"

# Configure with CMake using Emscripten toolchain
echo -e "${YELLOW}Configuring with CMake (OpenMP enabled)...${NC}"
if [ "$BUILD_TYPE" = "debug" ]; then
    CMAKE_BUILD_TYPE="Debug"
    echo -e "${YELLOW}Using debug flags with OMP...${NC}"
    cmake_args=(
        -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE}"
        -DCMAKE_C_FLAGS="${OMP_FLAGS} -O0 -g"
        -DCMAKE_CXX_FLAGS="${OMP_FLAGS} -O0 -g"
        -DCMAKE_EXE_LINKER_FLAGS="${LINK_OMP_FLAGS} -sASSERTIONS=2 -sSAFE_HEAP=1"
    )
else
    CMAKE_BUILD_TYPE="Release"
    cmake_args=(
        -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE}"
        -DCMAKE_C_FLAGS="${OMP_FLAGS} -O3 -flto"
        -DCMAKE_CXX_FLAGS="${OMP_FLAGS} -O3 -flto"
        -DCMAKE_EXE_LINKER_FLAGS="${LINK_OMP_FLAGS}"
    )
fi

# Run CMake with guarded args  
emcmake cmake "$WASM_DIR" "${cmake_args[@]}"

# Build with appropriate parallelism
echo -e "${YELLOW}Building...${NC}"
NPROC=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4)
emmake make -j${NPROC}

# Create distribution directory
echo -e "${YELLOW}Creating distribution package...${NC}"
mkdir -p "${DIST_DIR}"

# Copy built files
cp -f jc303.js "${DIST_DIR}/" 2>/dev/null || true
cp -f jc303.wasm "${DIST_DIR}/" 2>/dev/null || true
cp -f jc303.worker.js "${DIST_DIR}/" 2>/dev/null || true
cp -f jc303_worklet.js "${DIST_DIR}/" 2>/dev/null || true

# Copy web files
cp -f "$WASM_DIR/jc303-web.js" "${DIST_DIR}/"
cp -f "$WASM_DIR/jc303-worklet-processor.js" "${DIST_DIR}/" 2>/dev/null || true
cp -f "$WASM_DIR/index.html" "${DIST_DIR}/" 2>/dev/null || true

# Copy to main public directory for use in web_sequencer
if [ -d "$PUBLIC_DIR" ]; then
    echo -e "${YELLOW}Copying to web_sequencer public directory...${NC}"
    cp -f "${DIST_DIR}/jc303.js" "$PUBLIC_DIR/" 2>/dev/null || true
    cp -f "${DIST_DIR}/jc303.wasm" "$PUBLIC_DIR/" 2>/dev/null || true
    cp -f "${DIST_DIR}/jc303.worker.js" "$PUBLIC_DIR/" 2>/dev/null || true
    cp -f "${DIST_DIR}/jc303-web.js" "$PUBLIC_DIR/" 2>/dev/null || true
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Build Complete (OMP Enabled)!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Output files in: ${DIST_DIR}/"
echo ""
echo "Note: OMP threading requires COOP/COEP headers on the web server."
