# Archived one-off patch scripts (removed)

The `fix_*`, `patch_*`, and related one-off Python/shell scripts from the `useAudioEngine.ts` / `audioPlayback.ts` TypeScript parse-error debugging saga were **deleted** from this directory. They were forensic history only — not part of build, CI, or dev workflow — and running them could corrupt source files.

**Recovery:** `git log -- tools/archive/` or `git checkout <commit> -- tools/archive/<file>`

**Enforcement:** `pnpm run check:root` (wired into `pnpm lint`) fails if new root-level `*.py` or non-allowlisted root `*.md` files appear.

**Supported workflows:** see root [README.md](../../README.md) and [AGENTS.md](../../AGENTS.md).
