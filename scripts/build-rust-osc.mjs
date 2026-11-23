#!/usr/bin/env node
/**
 * Build the `rust-*` oscillator family (#1664): rust-audio/ → public/rust_osc.wasm.
 *
 *   pnpm run build:wasm:rust
 *
 * Needs a Rust toolchain with the wasm32 target (no wasm-pack, no wasm-bindgen —
 * the crate is a no_std cdylib with a plain C ABI):
 *   rustup target add wasm32-unknown-unknown
 *
 * Every codegen/link flag is set here, from emscripten/wasm_memory_budget.json
 * (`rustOsc`), so the fixed memory size has one source of truth. RUSTFLAGS from
 * the environment would replace them, so it is cleared; rust-audio/.cargo/
 * config.toml carries only `+simd128` for ad-hoc `cargo build` / IDE use.
 *
 * The linked module is then checked by tools/check_rust_osc_module.mjs — a build
 * that produced a growable, importing or scalar-only module fails here, not in
 * the browser.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUST_OSC_BUDGET, checkRustOscModule } from '../tools/check_rust_osc_module.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = path.join(ROOT, 'rust-audio');
const TARGET = 'wasm32-unknown-unknown';
const BUILT = path.join(CRATE, 'target', TARGET, 'release', 'rust_osc.wasm');
const OUT = path.join(ROOT, 'public', 'rust_osc.wasm');

const PAGE = 65536;

/** The flags, exported for src/__tests__/rustOscModule.test.ts. */
export function rustOscRustflags(budget = RUST_OSC_BUDGET) {
  const bytes = budget.initialMemoryPages * PAGE;
  return [
    '-C', 'target-feature=+simd128',
    '-C', `link-arg=--initial-memory=${bytes}`,
    '-C', `link-arg=--max-memory=${bytes}`,
    '-C', `link-arg=-zstack-size=${budget.stackSizeBytes}`,
  ];
}

function fail(message) {
  console.error(`[build-rust-osc] ${message}`);
  process.exit(1);
}

function main() {
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (cargo.error || cargo.status !== 0) {
    fail(
      'needs `cargo` on PATH (https://rustup.rs), then:\n'
      + `  rustup target add ${TARGET}`,
    );
  }

  const env = { ...process.env };
  delete env.RUSTFLAGS;
  // 0x1f is cargo's separator for CARGO_ENCODED_RUSTFLAGS (args may contain spaces).
  env.CARGO_ENCODED_RUSTFLAGS = rustOscRustflags().join('\x1f');

  console.log(`[build-rust-osc] ${cargo.stdout.trim()} → ${path.relative(ROOT, OUT)}`);
  const build = spawnSync(
    'cargo',
    ['build', '--release', '--locked', '--target', TARGET],
    { cwd: CRATE, env, stdio: 'inherit' },
  );
  if (build.error) fail(String(build.error));
  if (build.status !== 0) {
    fail(
      `cargo build exited ${build.status}. If the target is missing:\n`
      + `  rustup target add ${TARGET}`,
    );
  }

  const bytes = fs.readFileSync(BUILT);
  const problems = checkRustOscModule(bytes);
  if (problems.length) {
    fail(`${path.relative(ROOT, BUILT)} failed tools/check_rust_osc_module.mjs:\n  - ${problems.join('\n  - ')}`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log(`[build-rust-osc] ${path.relative(ROOT, OUT)}: ${bytes.length} B, checked`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
