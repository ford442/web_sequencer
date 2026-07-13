#!/usr/bin/env bash
# Regenerate license-clear struct-accurate RBS fixtures in test-fixtures/rbs/generated/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
GENERATE_RBS_CORPUS=1 CI=true pnpm exec vitest run src/__tests__/rbs/generateCorpusFiles.test.ts --pool forks
echo "Done — see test-fixtures/rbs/generated/"
