#!/usr/bin/env node
// Builds the rust-audio bench crate (#1294). Bench-only: not part of
// `build:native`, `build:release` or CI.
//
// wasm-pack is deliberately NOT an npm dependency. Its npm package downloads a
// GitHub release binary in a postinstall, which fails `pnpm install` on any
// network-restricted machine (Release 1/5). Install it out of band instead:
//   cargo install wasm-pack --locked      (or https://rustwasm.github.io/wasm-pack/installer/)
//   rustup target add wasm32-unknown-unknown
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const crateDir = fileURLToPath(new URL('../rust-audio', import.meta.url));
const probe = spawnSync('wasm-pack', ['--version'], { stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
  console.error(
    'bench:wasm:rust needs `wasm-pack` on PATH (it is not an npm dependency).\n' +
      '  cargo install wasm-pack --locked\n' +
      '  rustup target add wasm32-unknown-unknown',
  );
  process.exit(1);
}
const r = spawnSync('wasm-pack', ['build', '--target', 'web', '--out-dir', 'pkg'], {
  cwd: crateDir,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
