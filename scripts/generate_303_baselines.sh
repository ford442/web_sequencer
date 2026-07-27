#!/usr/bin/env bash
# Phase-0 (#973): render open303-family canonical baselines + spectrograms.
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
OUT_WAV="$ROOT/docs/audio-engine/303-baseline"
OUT_SPEC="$ROOT/docs/audio-engine/303-baseline-spectra"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT_WAV" "$OUT_SPEC"

echo "Compiling tb303_baseline_dump…"
g++ -std=c++17 -O2 -Wall -Wextra \
    -I "$SCRIPT_DIR/emscripten_stub" \
    "$SCRIPT_DIR/tb303_baseline_dump.cpp" \
    -o "$TMP/tb303_baseline_dump"

echo "Rendering baseline WAVs…"
"$TMP/tb303_baseline_dump" "$OUT_WAV"

echo "Generating spectrograms…"
python3 "$ROOT/scripts/303_spectrogram.py" \
    --input-dir "$OUT_WAV" \
    --output-dir "$OUT_SPEC"

echo "Done."
