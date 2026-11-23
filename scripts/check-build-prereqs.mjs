#!/usr/bin/env node
/**
 * Fail early, with an actionable message, when the generated native artifacts a
 * web build imports are missing.
 *
 * `vite build` on a fresh checkout otherwise dies with four opaque
 * `UNRESOLVED_IMPORT` errors for src/wasm/*.wasm?init (AssemblyScript output that
 * is generated, not committed). Run by `build:web` and, via the
 * `hyphon-build-prereqs` plugin in vite.config.ts, by every `vite build`.
 *
 * Existence only. Staleness is `pnpm run check:native`'s job.
 *
 *   node scripts/check-build-prereqs.mjs
 */
import { defaultRepoRoot, defineWorlds, evaluateAll, readStamps } from './native-worlds.mjs';

const repoRoot = defaultRepoRoot();
const worlds = defineWorlds(repoRoot);
const missing = evaluateAll(repoRoot, worlds, readStamps(repoRoot)).filter(
  (r) => r.status === 'missing',
);

if (missing.length === 0) process.exit(0);

const byToolchain = (tc) =>
  missing.filter((r) => worlds.find((w) => w.id === r.id)?.toolchain === tc);
const asc = byToolchain('asc');
const emcc = byToolchain('emcc');
const cargo = byToolchain('cargo');

const out = ['[build-prereqs] generated artifacts are missing — the web build cannot succeed yet.'];
for (const r of missing) out.push(`  - ${r.id}: ${r.missingOutputs.join(', ')}`);
out.push('');
if (asc.length) {
  out.push('AssemblyScript (src/wasm/*) — needs only `pnpm install`:');
  out.push('    pnpm run build:wasm');
}
if (emcc.length) {
  out.push('Emscripten (public/hyphon_native*, rubberband.wasm, mix_bus.wasm) — needs the pinned emcc:');
  out.push('    pnpm run setup:emsdk && pnpm run build:native     # no emsdk checkout / git needed');
  out.push('  (or restore a CI-built set — see docs/deployment/RELEASE_BUILD.md#native-artifacts)');
}
if (cargo.length) {
  out.push('Rust (public/rust_osc.wasm, the rust-* oscillators) — needs cargo + the wasm32 target:');
  out.push('    rustup target add wasm32-unknown-unknown && pnpm run build:wasm:rust');
}
out.push('Everything at once: `pnpm run build` (= build:release).');
console.error(out.join('\n'));
process.exit(1);
