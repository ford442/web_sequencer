#!/bin/bash
# scripts/jules-setup.sh
# web_sequencer temporary version

set -euo pipefail

echo "🚀 [Jules] Setting up web_sequencer / Hyphon environment..."

if command -v pnpm >/dev/null 2>&1 && [ -f pnpm-lock.yaml ]; then
  echo "📦 Using pnpm install --frozen-lockfile..."
  pnpm install --frozen-lockfile
elif [ -f package-lock.json ]; then
  echo "📦 Using npm ci..."
  npm ci --no-audit --no-fund --prefer-offline || npm install --no-audit --no-fund --legacy-peer-deps --force --prefer-offline
else
  echo "📦 No lockfile — using npm install with force..."
  npm install --no-audit --no-fund --legacy-peer-deps --force --prefer-offline
fi

echo "✅ [Jules] web_sequencer environment ready!"