#!/bin/bash
#
# JC-303 WebAssembly Build Script
#
# This script builds the JC-303 synthesizer for WebAssembly using Emscripten.
# 
# Prerequisites:
#   - Emscripten SDK installed and activated (emsdk)
#   - CMake >= 3.15
#
# Usage:
#   ./build.sh [debug|release]
#
# Licensed under GPL-3.0

set -e

# Configuration
BUILD_TYPE="${1:-release}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
DIST_DIR="${SCRIPT_DIR}/dist"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} JC-303 WebAssembly Build${NC}"
echo -e "${GREEN}========================================${NC}"

# Check for Emscripten
if ! command -v emcc &> /dev/null; then
    echo -e "${RED}Error: Emscripten (emcc) not found!${NC}"
    echo "Please install and activate the Emscripten SDK:"
    echo "  https://emscripten.org/docs/getting_started/downloads.html"
    echo ""
    echo "Quick setup:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

echo -e "${GREEN}Using Emscripten:${NC} $(emcc --version | head -n1)"

# Create build directory
echo -e "${YELLOW}Creating build directory...${NC}"
mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

# Configure with CMake using Emscripten toolchain
echo -e "${YELLOW}Configuring with CMake...${NC}"
if [ "$BUILD_TYPE" = "debug" ]; then
    CMAKE_BUILD_TYPE="Debug"
    echo -e "${YELLOW}Using debug flags...${NC}"
    # Use an array to pass CMake arguments safely so that flags with spaces
    # or embedded `=` signs are not mis-parsed by the shell/CMake.
    cmake_args=(
        -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE}"
        -DCMAKE_CXX_FLAGS="-O0 -g -sASSERTIONS=2 -sSAFE_HEAP=1"
        -DCMAKE_EXE_LINKER_FLAGS="-sASSERTIONS=2 -sSAFE_HEAP=1"
    )
else
    CMAKE_BUILD_TYPE="Release"
    cmake_args=( -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE}" )
fi

# Run CMake with guarded args
emcmake cmake .. "${cmake_args[@]}"

# Build with appropriate parallelism
echo -e "${YELLOW}Building...${NC}"
NPROC=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4) # Use 4 cores as a safe default
emmake make -j${NPROC}

# Create distribution directory
echo -e "${YELLOW}Creating distribution package...${NC}"
mkdir -p "${DIST_DIR}"

# Copy built files
cp -f jc303.js "${DIST_DIR}/" 2>/dev/null || true
cp -f jc303.wasm "${DIST_DIR}/" 2>/dev/null || true
cp -f jc303_worklet.js "${DIST_DIR}/" 2>/dev/null || true

# Copy web files
cp -f "${SCRIPT_DIR}/jc303-web.js" "${DIST_DIR}/"
cp -f "${SCRIPT_DIR}/jc303-worklet-processor.js" "${DIST_DIR}/"
cp -f "${SCRIPT_DIR}/index.html" "${DIST_DIR}/"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Build Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Output files in: ${DIST_DIR}/"
echo ""
echo "To test locally, run a web server in the dist directory:"
echo "  cd ${DIST_DIR}"
echo "  python3 -m http.server 8080"
echo ""
echo "Then open: http://localhost:8080"
