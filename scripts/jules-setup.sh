#!/bin/bash
# scripts/jules-setup.sh
# web_sequencer temporary version

set -euo pipefail

echo "🚀 [Jules] Setting up web_sequencer / Hyphon environment..."

if [ -f package-lock.json ]; then
  echo "📦 Using npm ci..."
  npm ci --no-audit --no-fund --prefer-offline || npm install --no-audit --no-fund --legacy-peer-deps --force --prefer-offline
else
  echo "📦 No lockfile — using npm install with force..."
  npm install --no-audit --no-fund --legacy-peer-deps --force --prefer-offline
fi

echo "✅ [Jules] web_sequencer environment ready!"