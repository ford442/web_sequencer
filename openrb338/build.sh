#!/usr/bin/env bash
# Build openrb338.wasm (GPL-3.0-only, opt-in; never part of build:native).
#
#   bash openrb338/build.sh            # -> openrb338/pkg/openrb338.wasm
#   bash openrb338/build.sh --verify   # also check it bit for bit against upstream openrb-338
#
# The output stays in openrb338/pkg/ (gitignored): nothing here copies it into public/, so no
# published build bundles it until the licence decision says so
# (docs/audio-engine/openrb338-voice.md).
set -euo pipefail
cd "$(dirname "$0")"

cargo build --release --target wasm32-unknown-unknown --lib
mkdir -p pkg
cp target/wasm32-unknown-unknown/release/hyphon_openrb338.wasm pkg/openrb338.wasm
echo "openrb338.wasm: $(wc -c < pkg/openrb338.wasm) bytes -> openrb338/pkg/openrb338.wasm"

if [[ "${1:-}" == "--verify" ]]; then
  cargo test --release
  cargo run --release --quiet --example reference_render -- target/reference
  node tools/verify-wasm.mjs pkg/openrb338.wasm target/reference
fi
