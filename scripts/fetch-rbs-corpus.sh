#!/usr/bin/env bash
# Download reference ReBirth .rbs files for local corpus testing (#774).
# Files are stored in test-fixtures/rbs/corpus/ (gitignored) — not shipped in main.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/test-fixtures/rbs/corpus"
BASE="https://raw.githubusercontent.com/nsauzede/jsynth/master"

mkdir -p "$DEST"

download() {
  local remote="$1"
  local local_name="$2"
  local out="${DEST}/${local_name}"
  echo "→ ${local_name}"
  curl -fsSL "${BASE}/${remote}" -o "$out"
  if ! file "$out" | grep -q 'RBS Song'; then
    echo "ERROR: ${local_name} is not a ReBirth RBS file" >&2
    exit 1
  fi
}

download "ReBirth%201.0%20Default%20Song.rbs" "jsynth_ReBirth_1.0_Default_Song.rbs"
download "Silent%20Default%20Song.rbs" "jsynth_Silent_Default_Song.rbs"
download "Untitled%20song%202.rbs" "jsynth_Untitled_song_2.rbs"
download "on_the_run.rbs" "jsynth_on_the_run.rbs"
download "TGV%27s%20KiloMix%20%2798.rbs" "jsynth_kilo.rbs"

echo ""
echo "Downloaded $(ls -1 "$DEST"/*.rbs 2>/dev/null | wc -l) files to ${DEST}"
echo "Run corpus tests: RBS_FIXTURE_DIR=${DEST} pnpm exec vitest run src/__tests__/RbsCorpus.test.ts"
