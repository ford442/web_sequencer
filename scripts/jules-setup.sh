#!/bin/bash
# scripts/jules-setup.sh
# Jules setup for web_sequencer / Hyphon (WASM-heavy audio DAW)

set -euo pipefail

echo "🚀 [Jules] Setting up web_sequencer / Hyphon environment..."

echo "📦 Installing dependencies..."
if npm ci --no-audit --no-fund --prefer-offline; then
  echo "✅ npm ci succeeded"
else
  echo "⚠️ Falling back to npm install..."
  npm install --no-audit --no-fund --prefer-offline
fi

# === Intentionally omitted from normal setup (too heavy/slow) ===
# - Full WASM/Emscripten/Rust builds (build:wasm, build:emcc, etc.)
# - ONNX model downloads (~235 MB)
# Only run these when needed:
#   npm run build:wasm && npm run build:emcc
#   bash download_models.sh   # only if TTS features are in scope

echo "✅ [Jules] web_sequencer / Hyphon environment ready!"