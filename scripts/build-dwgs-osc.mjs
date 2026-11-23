#!/usr/bin/env node
/**
 * Build the `dwgs-*` oscillator family (#1666): dwgs-audio/ → public/dwgs_osc.wasm.
 *
 *   pnpm run build:wasm:dwgs
 *
 * Needs a Rust toolchain with the wasm32 target, like the Rust OSC (no wasm-pack,
 * no wasm-bindgen — the crate is a no_std cdylib with a plain C ABI):
 *   rustup target add wasm32-unknown-unknown
 *
 * Every codegen/link flag is set here, from emscripten/wasm_memory_budget.json
 * (`dwgsOsc`), so the fixed memory size has one source of truth. RUSTFLAGS from
 * the environment would replace them, so it is cleared. Unlike the Rust OSC no
 * target feature is passed: the DWGS kernel is scalar on purpose.
 *
 * The linked module is then checked by tools/check_dwgs_osc_module.mjs — a
 * build that produced a growable, importing or SIMD module fails here, not in
 * the browser.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DWGS_OSC_BUDGET, checkDwgsOscModule } from '../tools/check_dwgs_osc_module.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = path.join(ROOT, 'dwgs-audio');
const TARGET = 'wasm32-unknown-unknown';
const BUILT = path.join(CRATE, 'target', TARGET, 'release', 'dwgs_osc.wasm');
const OUT = path.join(ROOT, 'public', 'dwgs_osc.wasm');

const PAGE = 65536;

/** The flags, exported for src/__tests__/dwgsOscModule.test.ts. */
export function dwgsOscRustflags(budget = DWGS_OSC_BUDGET) {
  const bytes = budget.initialMemoryPages * PAGE;
  return [
    '-C', `link-arg=--initial-memory=${bytes}`,
    '-C', `link-arg=--max-memory=${bytes}`,
    '-C', `link-arg=-zstack-size=${budget.stackSizeBytes}`,
  ];
}

function fail(message) {
  console.error(`[build-dwgs-osc] ${message}`);
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
  env.CARGO_ENCODED_RUSTFLAGS = dwgsOscRustflags().join('\x1f');

  console.log(`[build-dwgs-osc] ${cargo.stdout.trim()} → ${path.relative(ROOT, OUT)}`);
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
  const problems = checkDwgsOscModule(bytes);
  if (problems.length) {
    fail(`${path.relative(ROOT, BUILT)} failed tools/check_dwgs_osc_module.mjs:\n  - ${problems.join('\n  - ')}`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log(`[build-dwgs-osc] ${path.relative(ROOT, OUT)}: ${bytes.length} B, checked`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
