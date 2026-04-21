# Repository Streamlining Plan

This document collects observations about space, unused content, and general "bloat" in **web_sequencer**. The goal is to reduce clone/build times, make the repo easier to sync, and avoid shipping unneeded assets.

## Current Pain Points

- **Clone size** is large (~855 MB on disk locally) mostly due to:
  - large `node_modules/` (600+ MB) – though ignored, developers often install it accidentally
  - hefty `.git` history (~87 MB) containing old binary artifacts
  - the `jc303_wasm/` directory (∼72 MB) with fonts, PNGs, and compiled binaries
  - several pre-built WASM blobs in `public/` (jc303, pyodide etc.)
  - a handful of big PNGs in `concepts/` (up to 7 MB each) used only for design review

- **Tracked large files** that could be generated: 
  - `public/pyodide.asm.wasm` (~9 MB)
  - `public/jc303-*.wasm` and related worklet JS (1–1.4 MB each)
  - fonts and TTC/TTF files under `jc303_wasm/src/gui/amadeusp/resources` (13 MB each)
  - numerous PNGs under `jc303_wasm` for UI previews

- **Design assets** and prototypes in `concepts/` are versioned but not referenced by code.

- **Potential unused files** (not yet verified): a few `.xcf` and other GUI source files in `jc303_wasm` may not be required for building the main app.

## Proposed Cleanup Tasks

1. **Prune large artifacts from Git history**
   - Identify and remove any accidentally committed binaries using [BFG Repo Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) or `git filter-repo`.
   - After pruning, ask contributors to re‑clone or run `git reflog expire --expire=now --all && git gc --prune=now --aggressive`.

2. **Offload build outputs**
   - Stop tracking compiled WASM/JS blobs in `public/`; generate them during `npm run build:wasm` or CI.
   - Commit only the sources (`assembly/`, `rust-audio/`, `emscripten/`, `jc303_wasm/` where appropriate).
   - Optionally use a secondary branch or release assets if prebuilt binaries are needed for convenience.

3. **Use Git LFS or external storage** for large, rarely changed files:
   - Fonts (`.ttc`, `.ttf`) and big PNGs in `jc303_wasm`.
   - Consider moving `concepts/` images to GitHub wiki, a separate `docs/` repo, or an `assets` storage bucket.
   - Evaluate whether the `jc303_wasm` submodule itself should live in its own repository (it already is) and be sparse‑checked out by default.

4. **Remove/ignore unnecessary assets**
   - Add `concepts/` to `.gitignore` or convert it to a documentation-only directory outside main tree.
   - Clean up untracked GUI source files like `.xcf` if not part of the build.
   - Audit `src/components/assets` for unused images and delete them.

5. **Improve clone instructions**
   - Document `git clone --depth=1` and `git submodule update --init --depth=1` for faster checkouts.
   - Recommend `npm ci` instead of `npm install` to ensure reproducible installs without growing the lockfile.
   - If submodules are optional (e.g. `jc303_wasm`), suggest using sparse-checkout or skipping them until needed.

6. **Periodic maintenance**
   - Run `git gc` in CI or pre-commit hooks.
   - Add a `scripts/cleanup.sh` that reports large tracked files (`git rev-list --objects --all | sort -k2n | tail`).
   - Encourage contributors to inspect `git status` for accidentally added heavy files.

7. **Asset compression/optimization**
   - Losslessly compress PNGs (`pngcrush`, `optipng`) in `concepts/` and `jc303_wasm`.
   - Convert any very large images to vector (SVG) when feasible.

8. **Review third‑party libraries**
   - Consider pulling `pyodide`/`onnxruntime-web` from CDN at runtime or via `npm` dependencies rather than bundling the `.wasm` in repo.
   - For `node_modules`, rely on lockfile and ignore directory; do not commit vendor code.

## Follow‑up Checklist

- [ ] Run disk usage audit `du -sh *` quarterly.
- [ ] Add a `check-size` script printing git-tracked files >5 MB.
- [ ] Evaluate adding an automated warning if a commit includes files >1 MB.
- [ ] Decide on a strategy for the `jc303_wasm` submodule and implement accordingly.

> **Note:** these changes will reduce the repository's footprint and make it more pleasant for new developers to clone and work with. Any removal of tracked files must be coordinated with the team to avoid disrupting ongoing work.
