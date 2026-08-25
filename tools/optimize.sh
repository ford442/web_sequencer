#!/bin/bash
# tools/optimize.sh — opt-in, out-of-band wasm-opt pass.
#
# NOT part of `build` / `build:release`. emscripten/build.sh deliberately links at
# -O1 because emsdk 3.1.51's bundled wasm-opt fails this pthreads + SIMD + bigint
# module at -O2+. This script is the sanctioned way to get those passes back: a
# PINNED binaryen, run on the already-linked binaries, with the feature set
# spelled out per module.
#
# The pin lives in emscripten/toolchain.json (binaryen.version). A wasm-opt whose
# reported version differs is refused rather than used — an emsdk wasm-opt found
# on PATH is exactly the binary this script exists to avoid.
#
# Usage:
#   pnpm run optimize
#   HYPHON_WASM_OPT=/path/to/wasm-opt pnpm run optimize   # explicit binary
#   HYPHON_ALLOW_UNPINNED_WASM_OPT=1 pnpm run optimize    # escape hatch, prints a warning

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

TOOLCHAIN_JSON="$REPO_ROOT/emscripten/toolchain.json"
PINNED_VERSION="$(node -p "require('$TOOLCHAIN_JSON').binaryen.version")"
PINNED_PACKAGE="$(node -p "require('$TOOLCHAIN_JSON').binaryen.npmPackage")"
EMCC_VERSION="$(node -p "require('$TOOLCHAIN_JSON').emscripten.version")"

feature_flags() {
    node -p "require('$TOOLCHAIN_JSON').binaryen.features.$1.join(' ')"
}

echo "🚀 Out-of-band WASM optimisation"
echo "   emscripten pin: $EMCC_VERSION (link stays at -O1)"
echo "   binaryen pin:   $PINNED_VERSION ($PINNED_PACKAGE)"

# ---------------------------------------------------------
# 1. Resolve wasm-opt and verify the pin
# ---------------------------------------------------------
# Deliberate resolution order. $EMSDK/upstream/bin/wasm-opt is NOT in it.
if [ -n "${HYPHON_WASM_OPT:-}" ]; then
    WASM_OPT="$HYPHON_WASM_OPT"
elif [ -x "$REPO_ROOT/node_modules/.bin/wasm-opt" ]; then
    WASM_OPT="$REPO_ROOT/node_modules/.bin/wasm-opt"
elif command -v npx >/dev/null 2>&1; then
    echo "   No local wasm-opt; fetching the pinned $PINNED_PACKAGE via npx..."
    WASM_OPT="npx --yes --package=$PINNED_PACKAGE wasm-opt"
else
    echo "❌ No wasm-opt available. Install the pin:" >&2
    echo "     pnpm add -D $PINNED_PACKAGE" >&2
    exit 1
fi

REPORTED="$($WASM_OPT --version 2>&1 | head -1)"
echo "   using: $REPORTED"

if ! printf '%s' "$REPORTED" | grep -Eq "version $PINNED_VERSION\b"; then
    if [ "${HYPHON_ALLOW_UNPINNED_WASM_OPT:-0}" = "1" ]; then
        echo "⚠️  Unpinned wasm-opt allowed by HYPHON_ALLOW_UNPINNED_WASM_OPT=1."
        echo "⚠️  Expected binaryen $PINNED_VERSION, got: $REPORTED"
        echo "⚠️  Do not ship the result without re-validating it."
    else
        echo "❌ wasm-opt version mismatch." >&2
        echo "   expected: binaryen $PINNED_VERSION (emscripten/toolchain.json)" >&2
        echo "   found:    $REPORTED" >&2
        echo "   Install the pin (pnpm add -D $PINNED_PACKAGE), point HYPHON_WASM_OPT at it," >&2
        echo "   or set HYPHON_ALLOW_UNPINNED_WASM_OPT=1 if you know what you are doing." >&2
        exit 1
    fi
fi

# ---------------------------------------------------------
# 2. Optimise each module with ITS OWN feature set
# ---------------------------------------------------------
# Passing a feature a module was not compiled with is not free: it lets later
# passes emit instructions the target engine may reject. hyphon_native has no
# relaxed SIMD; oscillators.relaxed.wasm is the only module that does.
optimize_one() {
    local wasm="$1"
    local feature_key="$2"
    if [ ! -f "$wasm" ]; then
        echo "   skip (not built): $wasm"
        return 0
    fi
    local flags
    flags="$(feature_flags "$feature_key")"
    echo "🔧 $wasm  [$feature_key]"
    $WASM_OPT "$wasm" -o "$wasm.opt" -O3 --converge --strip-debug $flags
    mv "$wasm.opt" "$wasm"
}

optimize_one "src/wasm/oscillators.wasm"          assemblyScriptBaseline
optimize_one "src/wasm/trackFreezer.wasm"         assemblyScriptBaseline
optimize_one "src/wasm/fft.wasm"                  assemblyScriptBaseline
optimize_one "src/wasm/audioExport.wasm"          assemblyScriptBaseline
optimize_one "src/wasm/xmExport.wasm"             assemblyScriptBaseline
optimize_one "public/hyphon_native.wasm"          hyphonNative

# ---------------------------------------------------------
# 3. Re-establish the export contract
# ---------------------------------------------------------
# The glue is untouched by this script, so `--glue` alone would still pass even if
# a pass had renamed exports. `--wasm` compares the map against the real binary.
if [ -f "public/hyphon_native.wasm" ] && [ -f "public/hyphon_native.js" ]; then
    echo "🔎 Re-checking the export contract..."
    node tools/extract_wasm_export_map.mjs \
        public/hyphon_native.js \
        public/hyphon_wasm_export_map.json
    node tools/check_wasm_export_map.mjs \
        --glue public/hyphon_native.js \
        --wasm public/hyphon_native.wasm
fi

echo "✅ Optimisation complete (binaryen $PINNED_VERSION)."
