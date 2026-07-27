#!/usr/bin/env bash
# Benchmark highfid-cpu offline render (Phase-2 / #975).
#
# Usage (from repo root):
#   bash scripts/benchmark_highfid303.sh
#
# Prints wall time for the canonical 4-step pattern at 1× / 2× / 4× and a
# 64-step stress pattern via a tiny host g++ harness.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Compile from emscripten/ so the #include "../highfid303_wrapper.cpp" in the
# generated bench resolves... actually include by absolute path instead.
cat > "$TMP/bench.cpp" <<EOF
#include <chrono>
#include <cstdio>
#include <cstring>
#include <vector>
#include "$ROOT/emscripten/highfid303_wrapper.cpp"

static void render(int steps, int oversample, int stepBlocks) {
  uintptr_t h = highfid303_create();
  highfid303_init(h, 48000.f, 128);
  highfid303_set_oversample(h, oversample);
  highfid303_set_param(h, 2, 0.35f);
  highfid303_set_param(h, 3, 0.70f);
  highfid303_set_param(h, 4, 0.55f);
  highfid303_set_param(h, 5, 0.50f);
  highfid303_set_param(h, 6, 0.70f);
  highfid303_set_param(h, 7, 0.80f);
  float block[128];
  const int notes[] = {36, 36, 39, 43, 36, 41, 39, 36};
  int prev = -1;
  for (int i = 0; i < steps; ++i) {
    const int n = notes[i % 8];
    const bool accent = (i % 4 == 1) || (i % 4 == 3);
    if (!(accent) && prev >= 0) highfid303_note_off(h, prev);
    highfid303_note_on(h, n, accent ? 120.f : 90.f);
    prev = n;
    for (int b = 0; b < stepBlocks; ++b) {
      highfid303_process(h, reinterpret_cast<uintptr_t>(block), 128);
    }
  }
  highfid303_destroy(h);
}

int main() {
  struct Case { const char* name; int steps; int os; int blocks; };
  const Case cases[] = {
    {"canonical-4step-1x", 4, 1, 57},
    {"canonical-4step-2x", 4, 2, 57},
    {"canonical-4step-4x", 4, 4, 57},
    {"stress-64step-4x", 64, 4, 20},
  };
  for (const auto& c : cases) {
    render(c.steps, c.os, c.blocks);
    const auto t0 = std::chrono::steady_clock::now();
    constexpr int reps = 5;
    for (int i = 0; i < reps; ++i) render(c.steps, c.os, c.blocks);
    const auto t1 = std::chrono::steady_clock::now();
    const double ms = std::chrono::duration<double, std::milli>(t1 - t0).count() / reps;
    std::printf("%-22s  %.2f ms (avg of %d)\\n", c.name, ms, reps);
  }
  return 0;
}
EOF

echo "Compiling highfid-cpu benchmark…"
g++ -std=c++17 -O2 -I "$ROOT/emscripten/tests/emscripten_stub" \
    "$TMP/bench.cpp" -o "$TMP/bench"

echo "=== highfid-cpu offline benchmark ==="
"$TMP/bench"
echo "Done."
