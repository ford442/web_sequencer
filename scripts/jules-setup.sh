#!/bin/bash
# scripts/jules-setup.sh
# Jules setup for web_sequencer / Hyphon (aggressive fallback)

set -euo pipefail

echo "🚀 [Jules] Setting up web_sequencer / Hyphon environment..."

echo "📦 Installing dependencies (with force to bypass conflicts)..."

if npm ci --no-audit --no-fund --prefer-offline 2>/dev/null; then
  echo "✅ npm ci succeeded"
else
  echo "⚠️ npm ci failed — forcing install with legacy peer deps..."
  npm install --no-audit --no-fund --legacy-peer-deps --force --prefer-offline
fi

echo "✅ [Jules] web_sequencer / Hyphon environment ready!"