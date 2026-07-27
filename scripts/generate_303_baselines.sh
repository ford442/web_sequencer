#!/usr/bin/env bash
# Phase-0 (#973): render open303-family + jc303 canonical baselines + spectrograms.
#
# Usage (from repo root):
#   bash scripts/generate_303_baselines.sh
#
# Outputs:
#   docs/audio-engine/303-baseline/*.wav
#   docs/audio-engine/303-baseline-spectra/*.png
#   docs/audio-engine/303-baseline-spectra/baseline_metrics.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$ROOT/emscripten/tests"
OPEN303_DSP="$ROOT/jc303_wasm/src/dsp/open303"
OUT_WAV="$ROOT/docs/audio-engine/303-baseline"
OUT_SPEC="$ROOT/docs/audio-engine/303-baseline-spectra"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT_WAV" "$OUT_SPEC"

echo "Compiling tb303_baseline_dump (open303 family)…"
g++ -std=c++17 -O2 -Wall -Wextra \
    -I "$SCRIPT_DIR/emscripten_stub" \
    "$SCRIPT_DIR/tb303_baseline_dump.cpp" \
    -o "$TMP/tb303_baseline_dump"

echo "Rendering open303-family baseline WAVs…"
"$TMP/tb303_baseline_dump" "$OUT_WAV"

echo "Compiling tb303_jc303_baseline_dump (rosic soft oracle)…"
# Suppress third-party rosic strict-aliasing / unused-param noise; our dump stays -Wall.
g++ -std=c++17 -O2 -Wall -Wextra \
    -Wno-strict-aliasing -Wno-unused-parameter -Wno-aggressive-loop-optimizations \
    -I "$SCRIPT_DIR/emscripten_stub" \
    -I "$OPEN303_DSP" \
    -I "$ROOT/jc303_wasm/src/dsp" \
    "$SCRIPT_DIR/tb303_jc303_baseline_dump.cpp" \
    "$OPEN303_DSP"/*.cpp \
    -o "$TMP/tb303_jc303_baseline_dump"

echo "Rendering jc303 soft-oracle WAV…"
"$TMP/tb303_jc303_baseline_dump" "$OUT_WAV"

echo "Generating spectrograms + vs soft-oracle deltas…"
python3 "$ROOT/scripts/303_spectrogram.py" \
    --input-dir "$OUT_WAV" \
    --output-dir "$OUT_SPEC" \
    --reference "$OUT_WAV/jc303_canonical.wav"

echo "Done."
