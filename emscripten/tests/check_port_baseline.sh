#!/bin/bash
# Bit-exact baseline check for a #1344 voice-core port.
#
# Builds emscripten/tests/port_baseline/<engine>_dump.cpp twice with host g++,
# once against the emscripten/ tree at <ref> (the pre-port wrapper) and once
# against the working tree, renders the same fixed pattern through the C API
# both expose, and requires the two renders to be byte-identical. A port is a
# refactor; any difference is a regression until explained.
#
# Not a CI gate: once a port lands, <ref> already contains it. Run it on the
# port's branch before review.
#
# Usage: bash emscripten/tests/check_port_baseline.sh <engine> [ref]   (ref defaults to origin/main)
set -euo pipefail

ENGINE="${1:?usage: check_port_baseline.sh <engine> [ref]}"
REF="${2:-origin/main}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HARNESS="$SCRIPT_DIR/port_baseline/${ENGINE}_dump.cpp"
[ -f "$HARNESS" ] || { echo "No harness at $HARNESS" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/base"
git -C "$REPO_ROOT" archive "$REF" emscripten | tar -x -C "$TMP/base"

# jc303 wraps the rosic engine from the jc303_wasm submodule (same sources for
# both builds; only the wrapper differs).
EXTRA=()
if [ "$ENGINE" = "jc303" ]; then
    DSP="$REPO_ROOT/jc303_wasm/src/dsp"
    compgen -G "$DSP/open303/*.cpp" > /dev/null || {
        echo "jc303 needs the jc303_wasm submodule: git submodule update --init jc303_wasm" >&2
        exit 2
    }
    EXTRA=(-I "$DSP/open303" -I "$DSP" "$DSP"/open303/*.cpp)
fi

# Each tree builds against its own emscripten stub: older refs still include
# <emscripten/bind.h>, which the working tree's stub no longer provides.
build() {
    local tree="$1" out="$2"
    g++ -std=c++17 -O2 -w \
        -I "$tree/tests/emscripten_stub" \
        -I "$tree" \
        "$HARNESS" "${EXTRA[@]}" -o "$out"
}

echo "Building $ENGINE baseline harness against $REF…"
build "$TMP/base/emscripten" "$TMP/base.bin"
echo "Building $ENGINE baseline harness against the working tree…"
build "$REPO_ROOT/emscripten" "$TMP/work.bin"

"$TMP/base.bin" "$TMP/base.f32" >/dev/null
"$TMP/work.bin" "$TMP/work.f32" >/dev/null

if cmp -s "$TMP/base.f32" "$TMP/work.f32"; then
    echo "PASS: $ENGINE renders bit-identical to $REF ($(( $(stat -c %s "$TMP/work.f32") / 4 )) samples)"
    exit 0
fi

echo "FAIL: $ENGINE render differs from $REF"
node -e '
const fs = require("fs");
const a = new Float32Array(fs.readFileSync(process.argv[1]).buffer.slice(0));
const b = new Float32Array(fs.readFileSync(process.argv[2]).buffer.slice(0));
let first = -1, max = 0, count = 0;
for (let i = 0; i < Math.min(a.length, b.length); i++) {
  const d = Math.abs(a[i] - b[i]);
  if (a[i] !== b[i]) { count++; if (first < 0) first = i; if (d > max) max = d; }
}
console.log(`  lengths ${a.length} vs ${b.length}; ${count} differing samples, first at ${first}, max |diff| ${max}`);
' "$TMP/base.f32" "$TMP/work.f32"
exit 1
