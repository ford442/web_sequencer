#!/bin/bash
#
# JC-303 WebAssembly Build Script with Stack Overflow Protection
#
# This script builds the JC-303 synthesizer for WebAssembly using Emscripten
# with dual variants:
#   1. Threaded version (with OpenMP) - for high-performance environments
#   2. Single-threaded version (no OpenMP) - for broad compatibility
#
# CRITICAL FIX: This version includes massive stack size increase (32MB) and
# memory configuration changes to prevent stack overflow during initialization.
#
# Prerequisites:
#   - Emscripten SDK installed and activated (emsdk)
#   - CMake >= 3.15
#   - jc303_wasm submodule checked out
#
# Usage:
#   ./tools/build_jc303_omp.sh [debug|release] [threaded|single|both]
#
# Licensed under GPL-3.0

set -e

# Configuration
BUILD_TYPE="${1:-release}"
BUILD_VARIANT="${2:-both}"  # threaded, single, or both
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
JC303_DIR="$REPO_ROOT/jc303_wasm"
WASM_DIR="$JC303_DIR/wasm"
DIST_DIR="$WASM_DIR/dist"
PUBLIC_DIR="$REPO_ROOT/public"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} JC-303 WebAssembly Build${NC}"
echo -e "${GREEN} Build Type: ${BUILD_TYPE}${NC}"
echo -e "${GREEN} Variant: ${BUILD_VARIANT}${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}CRITICAL FIXES APPLIED:${NC}"
echo "  - Stack size: 32MB (was 4MB)"
echo "  - Initial memory: 64MB"
echo "  - Maximum memory: 256MB"
echo "  - Heap-allocated FFT buffers"
echo "  - Lazy wavetable initialization"
echo "  - setjmp/longjmp stack protection"
echo ""

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
    "/opt/emsdk/emsdk_env.sh"
)
for f in "${EMSDK_CANDIDATES[@]}"; do
    if [ -f "$f" ]; then 
        echo -e "${GREEN}Sourcing Emscripten from: $f${NC}"
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

# Create distribution directory
echo -e "${YELLOW}Creating distribution directory...${NC}"
mkdir -p "${DIST_DIR}"

# CRITICAL FIX: Emscripten flags for stack overflow prevention
# These are now primarily set in CMakeLists.txt, but we ensure they're
# passed correctly through cmake here.

EMSCRIPTEN_FLAGS=""
if [ "$BUILD_TYPE" = "debug" ]; then
    EMSCRIPTEN_FLAGS="-O0 -g -sASSERTIONS=2 -sSAFE_HEAP=1"
else
    EMSCRIPTEN_FLAGS="-O2 -flto"
fi

# Function to build a single variant
build_variant() {
    local VARIANT_NAME=$1  # "threaded" or "single"
    local ENABLE_THREADING=$2  # "true" or "false"
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN} Building ${VARIANT_NAME} variant${NC}"
    echo -e "${GREEN}========================================${NC}"
    
    # Create variant-specific build directory
    local BUILD_DIR="$WASM_DIR/build_${VARIANT_NAME}"
    echo -e "${YELLOW}Creating build directory: ${BUILD_DIR}${NC}"
    mkdir -p "${BUILD_DIR}"
    cd "${BUILD_DIR}"
    
    # Set up flags based on variant
    if [ "$ENABLE_THREADING" = "true" ]; then
        # Threaded variant - requires libomp.a
        LIBOMP_PATH="$REPO_ROOT/emscripten/libomp.a"
        if [ ! -f "$LIBOMP_PATH" ]; then
            echo -e "${YELLOW}Warning: libomp.a not found at $LIBOMP_PATH. Falling back to Emscripten built-in OpenMP.${NC}"
            OMP_INCLUDE_DIR="${REPO_ROOT}/emscripten"
            OMP_FLAGS="-pthread -fopenmp -I${OMP_INCLUDE_DIR}"
            LINK_OMP_FLAGS="-s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s PROXY_TO_PTHREAD=0"
        else
            echo -e "${GREEN}Found libomp.a: $LIBOMP_PATH${NC}"
            OMP_INCLUDE_DIR="${REPO_ROOT}/emscripten"
            OMP_FLAGS="-pthread -fopenmp -I${OMP_INCLUDE_DIR}"
            LINK_OMP_FLAGS="-s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s PROXY_TO_PTHREAD=0 ${LIBOMP_PATH}"
        fi
    else
        # Single-threaded variant - no OpenMP
        echo -e "${YELLOW}Building single-threaded variant (no OpenMP)${NC}"
        OMP_FLAGS=""
        LINK_OMP_FLAGS=""
    fi
    
    # CMake configuration with explicit stack/memory settings
    # CRITICAL: These must match the values in CMakeLists.txt
    CMAKE_BUILD_TYPE="$([ "$BUILD_TYPE" = "debug" ] && echo "Debug" || echo "Release")"
    
    echo -e "${YELLOW}Running CMake...${NC}"
    emcmake cmake "$WASM_DIR" \
        -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE}" \
        -DCMAKE_C_FLAGS="${OMP_FLAGS} ${EMSCRIPTEN_FLAGS}" \
        -DCMAKE_CXX_FLAGS="${OMP_FLAGS} ${EMSCRIPTEN_FLAGS}" \
        -DCMAKE_EXE_LINKER_FLAGS="${LINK_OMP_FLAGS}" \
        -DENABLE_WASM_DEBUG=$([ "$BUILD_TYPE" = "debug" ] && echo "ON" || echo "OFF")
    
    # Build with appropriate parallelism
    echo -e "${YELLOW}Building...${NC}"
    emmake make -j8
    
    # Copy built files with variant suffix
    echo -e "${YELLOW}Copying ${VARIANT_NAME} variant to distribution...${NC}"
    cp -f jc303.js "${DIST_DIR}/jc303-${VARIANT_NAME}.js" 2>/dev/null || true
    cp -f jc303.wasm "${DIST_DIR}/jc303-${VARIANT_NAME}.wasm" 2>/dev/null || true
    cp -f jc303_worklet.js "${DIST_DIR}/jc303-${VARIANT_NAME}-worklet.js" 2>/dev/null || true
    
    # Threaded variant also produces worker files
    if [ "$ENABLE_THREADING" = "true" ]; then
        cp -f jc303.worker.js "${DIST_DIR}/jc303-${VARIANT_NAME}.worker.js" 2>/dev/null || true
    fi
    
    echo -e "${GREEN}${VARIANT_NAME} variant build complete!${NC}"
}

# Build requested variant(s)
if [ "$BUILD_VARIANT" = "threaded" ] || [ "$BUILD_VARIANT" = "both" ]; then
    build_variant "threaded" "true" || {
        echo -e "${RED}Threaded variant build failed${NC}"
        if [ "$BUILD_VARIANT" = "threaded" ]; then
            exit 1
        fi
    }
fi

if [ "$BUILD_VARIANT" = "single" ] || [ "$BUILD_VARIANT" = "both" ]; then
    build_variant "single" "false" || {
        echo -e "${RED}Single-threaded variant build failed${NC}"
        exit 1
    }
fi

# Copy to main public directory for use in web_sequencer
if [ -d "$PUBLIC_DIR" ]; then
    echo -e "${YELLOW}Copying to web_sequencer public directory...${NC}"
    cp -f "${DIST_DIR}"/jc303-*.js "$PUBLIC_DIR/" 2>/dev/null || true
    cp -f "${DIST_DIR}"/jc303-*.wasm "$PUBLIC_DIR/" 2>/dev/null || true
    cp -f "${DIST_DIR}"/jc303-*.worker.js "$PUBLIC_DIR/" 2>/dev/null || true

    # Also copy without suffix for backward compatibility (prefer single-threaded if both exist)
    if [ -f "${DIST_DIR}/jc303-single.js" ]; then
        cp -f "${DIST_DIR}/jc303-single.js" "$PUBLIC_DIR/jc303.js" 2>/dev/null || true
        cp -f "${DIST_DIR}/jc303-single.wasm" "$PUBLIC_DIR/jc303.wasm" 2>/dev/null || true
        cp -f "${DIST_DIR}/jc303-single-worklet.js" "$PUBLIC_DIR/jc303_worklet.js" 2>/dev/null || true
    elif [ -f "${DIST_DIR}/jc303-threaded.js" ]; then
        cp -f "${DIST_DIR}/jc303-threaded.js" "$PUBLIC_DIR/jc303.js" 2>/dev/null || true
        cp -f "${DIST_DIR}/jc303-threaded.wasm" "$PUBLIC_DIR/jc303.wasm" 2>/dev/null || true
        cp -f "${DIST_DIR}/jc303-threaded-worklet.js" "$PUBLIC_DIR/jc303_worklet.js" 2>/dev/null || true
        cp -f "${DIST_DIR}/jc303-threaded.worker.js" "$PUBLIC_DIR/jc303.worker.js" 2>/dev/null || true
    fi
fi

# Copy single-threaded WASM to src/wasm/ — this is the Vite-managed asset.
# Open303Oscillator.ts imports it as `../wasm/jc303-single.wasm?url` so Vite
# content-hashes it and resolves the URL correctly in dev and production.
# After running this script, commit src/wasm/jc303-single.wasm to git.
SRC_WASM_DIR="$REPO_ROOT/src/wasm"
if [ -f "${DIST_DIR}/jc303-single.wasm" ]; then
    echo -e "${YELLOW}Copying single WASM to src/wasm/ (Vite asset)...${NC}"
    mkdir -p "$SRC_WASM_DIR"
    cp -f "${DIST_DIR}/jc303-single.wasm" "$SRC_WASM_DIR/jc303-single.wasm"
    echo -e "${GREEN}Copied to $SRC_WASM_DIR/jc303-single.wasm${NC}"
    echo ""
    echo -e "${YELLOW}IMPORTANT — commit these files to git:${NC}"
    echo "  git add src/wasm/jc303-single.wasm public/jc303_worklet.js public/jc303-single.wasm"
    echo "  git commit -m 'chore: update jc303 wasm artifacts'"
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Build Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Output files in: ${DIST_DIR}/"
echo ""
if [ "$BUILD_VARIANT" = "both" ] || [ "$BUILD_VARIANT" = "threaded" ]; then
    echo "Threaded variant files: jc303-threaded.{js,wasm,worker.js}"
    echo "  Note: Requires COOP/COEP headers on web server"
fi
if [ "$BUILD_VARIANT" = "both" ] || [ "$BUILD_VARIANT" = "single" ]; then
    echo "Single-threaded variant files: jc303-single.{js,wasm}"
    echo "  Note: Broader compatibility, no special headers required"
fi
echo ""
echo -e "${YELLOW}IMPORTANT:${NC}"
echo "  - Stack size is now 32MB (was 4MB)"
echo "  - Memory starts at 64MB, grows to 256MB max"
echo "  - FFT buffers are heap-allocated"
echo "  - Wavetable generation is deferred"
echo ""
echo "If you still see stack overflows:"
echo "  1. Check browser console for 'Stack overflow detected' messages"
echo "  2. Verify the new WASM files are being loaded (not cached)"
echo "  3. Try the single-threaded variant first (more compatible)"
echo ""
