# BUILD_HEALTH.md — web_sequencer pipeline hygiene pass

**Date:** 2026-06-01  **Branch:** `claude/gallant-carson-8737B`  **Mode:** verification only (no source changes)
**Environment:** ephemeral CI-like container (Node 22, pnpm 11, cargo 1.94). **Not** a full build host.

---

## 1. Build status & timings

| Stage | Result | Time | Notes |
|---|---|---|---|
| `tsc -b` | ✅ pass (0 errors) | ~17s | |
| `vite build` | ✅ pass | ~33.7s | 734 modules; built from **committed** WASM artifacts |
| **Full `npm run build`** | ❌ **not reproducible here** | — | blocked at `build:emcc`, `build:wasm:jc303`, `optimize` |

**The full clean build cannot complete in a vanilla container.** Missing toolchain:
- `emcc` (Emscripten) — required by `build:emcc` and `build:wasm:jc303` (`tools/build_jc303_omp.sh`). **Genuinely absent** (not an npm dep).
- `wasm-opt` (binaryen) **and** `wasmedge` — required by `tools/optimize.sh`, which `exit 1`s if `wasm-opt` is missing and tries a `curl | bash` network install of `wasmedge` (fails offline).
- `build:wasm:rust` (`wasm-pack`) needs network to fetch crates.
- `asc` / `wasm-pack` themselves are fine via `node_modules` (npx-runnable).

The repo **commits prebuilt WASM** (`src/wasm/*.wasm`, `public/*.wasm`), which is why `vite build` succeeds despite the missing compilers — but it also **masks** that the WASM stages are unreproducible without a documented/pinned toolchain.

## 2. WASM asset status (dist/)

| Asset | Location in dist/ | Hashed? | Real or stub |
|---|---|---|---|
| oscillators / audioExport / xmExport (AssemblyScript) | `dist/assets/*-<hash>.wasm` | ✅ content-hashed | real |
| ONNX runtime `ort-wasm-simd-threaded.jsep` | `dist/assets/*-<hash>.wasm` (**23.8 MB**) | ✅ content-hashed | real |
| **jc303 / Open303** (`jc303.wasm`, `jc303-single.wasm` 69 KB, `jc303-threaded.wasm` 83 KB) | `dist/` root (from `public/`) | ⚠️ **NOT hashed** | ✅ **real, not a stub** (69–83 KB) |
| `hyphon_native.wasm` (Emscripten, 1.38 MB), `rubberband.wasm` (431 KB) | `dist/` root (from `public/`) | ⚠️ not hashed | real |

- **jc303 stub check: PASS** — the 69 KB/83 KB sizes confirm a real Open303 build, not a stub fallback.
- **Regression vs. plan history:** the weekly-plan Done note claimed jc303 WASM was "promoted to a Vite content-hashed asset." In the current `dist/` it is served **un-hashed from `public/`**. Cache-busting on redeploy therefore relies on the fixed path, not a content hash → **stale-cache risk** for jc303 after a redeploy. The hashing that did land applies to the **AssemblyScript** wasm, not jc303. Recommend confirming whether un-hashed jc303 is intended.
- `public/rust-wasm/` is **empty** → the Rust audio WASM (`build:wasm:rust`) output is neither committed nor buildable here. Verify the app degrades gracefully when it's absent.

## 3. Boot status (static serve)

- `vite preview` → **HTTP 200**, `index.html` 1741 B. ✅
- `index.html` uses **relative asset paths** (`./assets/index-*.js`) — `vite.config.ts base:"./"` is correct for a `/hyphon/` subdirectory deploy. ✅
- **Runtime external deps loaded from CDNs** in `index.html`: Pyodide (`cdn.jsdelivr.net/pyodide/v0.26.1`) and Google Fonts. If the host or user network blocks these, the Pyodide DSP/drums fallback and fonts break. ⚠️
- **NOT verifiable headless** (no real browser): WebGPU knob render on first paint, AudioContext init, actual Pyodide load. These need a real-browser/Playwright pass.

## 4. Deploy target — [VERIFY] gap RESOLVED

From `deploy.py`:
- Flow: zip `dist/` → `POST https://storage.noahcohn.com/api/deploy/web-sequencer/bundle` (Contabo VPS) → server extracts into remote folder **`hyphon`**.
- `deploy.py main()` prints the target as **`test.1ink.us/hyphon`**. PROJECT CONTEXT lists the live URL as `go.1ink.us/hyphon` — **discrepancy (`test` vs `go`)**; confirm which is canonical.
- Legacy `deploy_old.py` used direct SFTP + a separate `wasm.noahcohn.com` upload for JC-303 assets; the new path drops that (per docstring, deploy those independently if needed).
- The zip includes **everything** in `dist/` (excludes only `.git`/`node_modules`/`__pycache__`) → current upload is **~36 MB**, of which ~6 MB is source maps (see fragility #2) and 23.8 MB is the ONNX wasm.

## 5. Lint & dependency audit

- `eslint .` → ✅ **clean (0 problems)**.
- `pnpm audit --prod` → **10 vulnerabilities (1 critical, 4 high, 5 moderate)** — **all in `protobufjs`**, transitive via **`onnxruntime-web`** (installed 7.5.4). Critical = arbitrary code execution; patched in `protobufjs >=7.5.8`. Real-world exposure is limited (the attack surface is parsing a malicious ONNX/protobuf model, and models ship from the app's own bundle), but it should be remediated via a `pnpm.overrides` bump of `protobufjs` to `>=7.5.8` or an `onnxruntime-web` upgrade.
- `npm audit` does not work (project is pnpm; no `package-lock.json`).

---

## Top fragilities

1. **🔴 SECURITY — hardcoded deploy credential.** `deploy.py:44-47` ships a fallback `DEPLOY_TOKEN` literal as the default when the env var is unset. The repo is **public**, so this token (granting deploy access to `storage.noahcohn.com`) is exposed. **Rotate the token on the VPS and remove the in-code fallback** (fail closed if `DEPLOY_TOKEN` is unset). Highest priority.

2. **🟠 Build is not reproducible / source maps shipped.** (a) No pinned toolchain or Dockerfile for `emcc` + `binaryen` + `wasmedge`; the build only works because prebuilt WASM is committed. (b) `dist/` ships **~6 MB of `.map` files** (incl. `Studio3D-*.js.map` 4 MB, `index-*.js.map` 1.28 MB) which the deploy zips and uploads publicly — exposes original source and bloats every deploy. Set `build.sourcemap: false` (or `'hidden'`) for the deploy build.

3. **🟠 protobufjs vulns via onnxruntime-web** (1 critical / 4 high) — bump `protobufjs >=7.5.8` via `pnpm.overrides`.

### Secondary hygiene
- **5 committed `.orig` merge artifacts** in `src/`: `MainSequencer.tsx.orig`, `useAudioEngine.ts.orig`, `useAppState.tsx.orig`, `audioEngine/audioPlayback.ts.orig`, `engines/rubberband/PhonemeAligner.ts.orig`. Not imported (build-safe) but should be deleted.
- **Large bundles**: `index` 2.04 MB, `Studio3D` 1.24 MB — consider `manualChunks` / lazy-loading Studio3D.
- **Build-time warnings**: `rubberband-lib.wasm` resolved at runtime via `new URL` (verify the file name matches `public/rubberband.wasm`); `fs` externalized in `src/utils/xm_save_lib/xmWriter.ts` (Node API in browser code); `CloudStorage.ts` mixed static+dynamic import defeats code-splitting; browserslist DB 6 months stale.
- `public/rust-wasm/` empty (rust-audio WASM absent).

## Explicitly NOT verified
- Real-browser boot: WebGPU knob render, AudioContext init, Pyodide load (headless container — needs Playwright/manual).
- Live deploy (dry-run only; no upload performed).
- Full WASM recompilation (emcc/binaryen/wasmedge absent; verified the committed artifacts bundle correctly instead).
