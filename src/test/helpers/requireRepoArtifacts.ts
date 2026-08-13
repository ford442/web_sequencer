import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Repo root — Vitest always runs from the package root. */
const REPO_ROOT = process.cwd();

/** Artifacts required before integration tests run (fail fast, no silent skip). */
export const INTEGRATION_ARTIFACTS = [
  'src/wasm/oscillators.wasm',
  'src/wasm/trackFreezer.wasm',
  'public/hyphon_native.js',
  'public/hyphon_native.wasm',
  'docs/audio-engine/303-baseline/jc303_canonical.wav',
] as const;

const BUILD_HINT = 'pnpm run build:wasm && pnpm run build:emcc';

/**
 * Throws when generated WASM / baseline fixtures are missing.
 * Call from integration setup or at the top of artifact-dependent suites.
 */
export function requireRepoArtifacts(
  paths: readonly string[] = INTEGRATION_ARTIFACTS,
): void {
  const missing = paths.filter((rel) => !existsSync(join(REPO_ROOT, rel)));
  if (missing.length === 0) return;

  throw new Error(
    `Missing required artifacts for integration tests:\n` +
      missing.map((p) => `  - ${p}`).join('\n') +
      `\n\nBuild them with: ${BUILD_HINT}`,
  );
}

/** Repo root for tests that read committed fixtures from disk. */
export function repoRoot(): string {
  return REPO_ROOT;
}
