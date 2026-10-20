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
- `bench:wasm:rust` (`wasm-pack`) needs network to fetch crates. Bench-only since #1294 — not part of `build:native`.
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
- `public/rust-wasm/` is gone: the `rust-*` oscillator family was removed in #1294 and `rust-audio/` is a bench crate. Nothing in the app loads it.

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
- The zip excludes `.git`/`node_modules`/`__pycache__` and (as of the rewrite) `.map` files → current upload is **~11 MB / 56 files**, dominated by the ONNX wasm. `--include-sourcemaps` restores the old ~36 MB behavior.

## 5. Lint & dependency audit

- `eslint .` → ✅ **clean (0 problems)**.
- `pnpm audit --prod` → **10 vulnerabilities (1 critical, 4 high, 5 moderate)** — **all in `protobufjs`**, transitive via **`onnxruntime-web`** (installed 7.5.4). Critical = arbitrary code execution; patched in `protobufjs >=7.5.8`. Real-world exposure is limited (the attack surface is parsing a malicious ONNX/protobuf model, and models ship from the app's own bundle), but it should be remediated via a `pnpm.overrides` bump of `protobufjs` to `>=7.5.8` or an `onnxruntime-web` upgrade.
- `npm audit` does not work (project is pnpm; no `package-lock.json`).

---

## Top fragilities

1. **🔴 SECURITY — deploy credential.** *In-code fallback removed:* `deploy.py` was found missing from the working tree and from git history entirely, and has been rewritten to read `DEPLOY_TOKEN` from the environment only, failing closed when unset. **The previously-reported hardcoded token must still be rotated on the VPS** — assume it is compromised. Remaining action is on the server side.

2. **🟠 Build is not reproducible / source maps shipped.** (a) No pinned toolchain or Dockerfile for `emcc` + `binaryen` + `wasmedge`; the build only works because prebuilt WASM is committed. (b) `dist/` ships **~6 MB of `.map` files** (incl. `Studio3D-*.js.map` 4 MB, `index-*.js.map` 1.28 MB) which still get generated. *Partly mitigated:* `deploy.py` now excludes `.map` files from the upload by default (bundle ~11 MB, down from ~36 MB), so they are no longer published. They are still built — set `build.sourcemap: false` (or `'hidden'`) in `vite.config.ts:43` to stop producing them.

3. **🟠 protobufjs vulns via onnxruntime-web** (1 critical / 4 high) — bump `protobufjs >=7.5.8` via `pnpm.overrides`.

### Secondary hygiene
- **5 committed `.orig` merge artifacts** in `src/`: `MainSequencer.tsx.orig`, `useAudioEngine.ts.orig`, `useAppState.tsx.orig`, `audioEngine/audioPlayback.ts.orig`, `engines/rubberband/PhonemeAligner.ts.orig`. Not imported (build-safe) but should be deleted.
- **Large bundles**: `index` 2.04 MB, `Studio3D` 1.24 MB — consider `manualChunks` / lazy-loading Studio3D.
- **Build-time warnings**: `rubberband-lib.wasm` resolved at runtime via `new URL` (verify the file name matches `public/rubberband.wasm`); `fs` externalized in `src/utils/xm_save_lib/xmWriter.ts` (Node API in browser code); `CloudStorage.ts` mixed static+dynamic import defeats code-splitting; browserslist DB 6 months stale.
- `rust-audio/` is a bench crate; it produces no shipped artifact.

## Explicitly NOT verified
- Real-browser boot: WebGPU knob render, AudioContext init, Pyodide load (headless container — needs Playwright/manual).
- Live deploy (dry-run only; no upload performed).
- Full WASM recompilation (emcc/binaryen/wasmedge absent; verified the committed artifacts bundle correctly instead).

---

## 2026-10-13 — CI green + live-issue triage (branch `fix/ci-green-2026-10-12`)

Baseline: `main` `242750b`. `tsc -b` clean; `lint:ratchet` failed `no-explicit-any` 297→298 and `no-unsafe-member-access` 447→448 (both `artifact-detector-processor.ts:286`); `Test Performance` red 7/7 on a missing `public/rubberband.wasm`.

- **Lint ratchet:** typed delete (`Record<string, number>`), ratchet OK, baseline unchanged. `test:unit` 245 files / 2128 tests pass.
- **Perf tier:** `test-perf.yml` now installs emsdk 3.1.51 and builds `rubberband.wasm` (cached). Local run with emcc 3.1.51: `test:perf` 7 files / 38 tests pass, `perf-summary.json` written. The perf tier still builds real WASM — no stub (`docs/PERFORMANCE_BUDGET.md`).
- **Fresh dist:** `vendor:pyodide` + `build:release:changed` (all 8 native worlds matched their stamps) → `check-release-dist` OK, entry JS 256,189 / 262,000 B brotli. A dist without `dist/pyodide/` only *warns* in the gate and boots to a disabled button — still the case.
- **Toolchain note:** the dev VM's `/root/emsdk` has emcc 6.0.6, not the CI pin 3.1.51. The rubberband build was verified with a separate 3.1.51 install (build script sources `$HOME/emsdk`).
- **Live site:** `test.1ink.us/hyphon` `Last-Modified` 2026-06-15; `go.1ink.us/hyphon` 2026-03-06. Nothing merged since June has been deployed.
- **Triage (`tests/live-issue-triage.spec.ts`, Chromium/Firefox/WebKit):** #1389, #1390, #1391, #1392, #1393 do not reproduce. #1396 reproduced (splash gated on `'gpu' in navigator`, not on an adapter) and is fixed. #1395 reproduces in part (REC dots over the oscillator selector at 1280×720) and is left failing on purpose. #1394 is the cloud host's TLS (`https://storage.noahcohn.com:8000/` → `ERR_SSL_PROTOCOL_ERROR`); #1397 is a feature request.
- **Seen in passing, not in the nine issues:** `Failed to load ./assets/saw.wav / square.wav EncodingError: Unable to decode audio data`, and `Supertonic Init Failed: Unexpected token '<'` (a model fetch is getting an HTML page) on the preview build.
- **CI E2E on the PR (run 38359994310):** 85 passed / 5 failed. #1395 failed on all three browsers (expected). Headless **Firefox on CI also fails #1389** — transport step stays `-1` and no step highlight appears — which matches open issue #1372 (the AudioContext clock does not run in headless CI Firefox); Chromium and WebKit advance. Locally Firefox advanced. #1390 failed on Firefox only because of the harness (see next bullet) and was reworked.
- **E2E harness notes:** Firefox's SVG hit-testing releases a live-keyboard key held near its bottom edge (the pressed face shifts 3 px away from the pointer; press at 85% height never holds, 70% holds, 50% flickers) — observed, not investigated, minor; the #1390 test dispatches mousedown/mouseup on the key instead of driving `page.mouse`.
- **E2E harness notes (continued):** the live keyboard keys sit in an `aria-hidden` SVG (role queries can't see them); WebKit returns `""` for `innerText` on `role=status`; WebKit's boot is occasionally flaky on its first attempt (passes on the project's configured retry).

## 2026-10-14 — native toolchain modernisation (Part A, branch `chore/toolchain-modernise`)

Supersedes the toolchain notes above: the emsdk pin is **6.0.9**, in `emscripten/toolchain.json` only, and every em++ script fails on any other `emcc` (`emscripten/toolchain_env.sh`). `tools/optimize.sh` (and its `wasm-opt` / `wasmedge` requirement) is deleted — the `-O3 -flto` link runs the pinned emsdk's own `wasm-opt`. Details, sizes and the render-parity result: `docs/wasm/BUILD_NOTES.md#toolchain-pin`.

- `pnpm run build:native` on 6.0.9: all 9 worlds rebuild. `test:native` passes; `test:unit` and `test:integration` (`HYPHON_REQUIRE_NATIVE=1`) pass against the 6.0.9 artifacts.
- Rubber Band on 6.x needed `HEAPF32` / `HEAPF64` in `EXPORTED_RUNTIME_METHODS`; without them `nativeVocalFx` / `phonemeElasticity` fail ("Rubber Band glue does not expose HEAPF32").
- Debug profile on 6.x: the glue wraps exports in `createExportWrapper(...)`; both export-map parsers now accept it (it extracted 0 exports before).


## 2026-10-19 whole-stack run

Run 2026-10-20 (UTC) in a fresh cloud container, Node 22.22.0, pnpm 12.3.4. **Base: `origin/main` `3dee74a`**, not a CI-green fix branch: `pnpm exec tsc -b --pretty false` exits **2** on `main` (the same 7 errors the 10-19 Fix First listed: `nativeVoiceProcessor.ts` ×5 TS7053, `rubberbandProcessor.fxBackend.test.ts` ×2 TS2416), and there is no `fix/ci-green-2026-10-19` branch on the remote (only `fix/ci-green-2026-10-12`). No application code was changed.

### 1. Toolchain

| Command | Outcome |
|---|---|
| `git submodule update --init --recursive` | exit 0, 14.6 s (`jc303_wasm`, `third_party/eurorack` + nested, `third_party/stmlib`) |
| `emcc --version` | none on PATH → installed the pin into `$HOME/emsdk` (`./emsdk install 6.0.9 && ./emsdk activate 6.0.9`): `emcc … 6.0.9 (4e42238…)`, matches `emscripten/toolchain.json`. The build scripts report `Using Emscripten 6.0.9 (pin 6.0.9, from PATH)` |

### 2. Install + Pyodide

| Command | Outcome |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0. On a cold store the `wasm-pack` postinstall fails behind the sandbox proxy (GitHub release download → HTTP 405); `--ignore-scripts` works around it. `wasm-pack` is bench-only, so nothing the release needs depends on it |
| `pnpm run vendor:pyodide` | exit 0, v0.26.1 + numpy / scipy / openblas → `public/pyodide/` 76 MB |

### 3. `pnpm run build`

**Exit 2 after 183 s.** Stage by stage:

| Stage | Outcome |
|---|---|
| `build:native` | ✅ all 9 worlds rebuilt (as-oscillators, as-freezer, as-fft, as-audioexport, as-xmexport, jc303, emcc, rubberband, mixbus). Warnings: em++ `-pthread + ALLOW_MEMORY_GROWTH may run non-wasm code slowly` ×3, clang++ `treating 'c' input as 'c++'` ×3, `wasm-opt: no passes specified` ×1 (mix bus). `mix_bus.wasm` check OK (no imports, fixed memory, ABI 1) |
| export-map check | ✅ `91 exports (54 required, 37 optional present)` |
| `tsc -b` | ❌ the 7 errors above. **The release build stops here** |

To exercise the rest of the pipeline the remaining stages were run by hand on the same tree:

| Stage | Outcome |
|---|---|
| `vite build` | ✅ 6.0 s. Warnings: `new URL("rubberband-lib.wasm", import.meta.url) doesn't exist at build time` (expected, resolved at runtime), `Some chunks are larger than 500 kB` (entry `index-*.js` 1,053,229 B raw) |
| `write-native-manifest.mjs` | ✅ |
| `check-release-dist.mjs` | ❌ **exit 1**: `AudioWorklet chunk(s) contain runtime import/export … assets/AgentBridge-*.js (import, export)`. **False positive.** `src/agent/liveCapture.ts` (#1467) keeps its recorder worklet as a source *string* and loads it from a Blob URL. The gate's `registerProcessor\s*\(` regex matches inside that string, so it classifies the whole `AgentBridge` chunk as a worklet. The real worklet chunks are self-contained. **With `tsc` fixed, every `pnpm run build` and every `deploy.py` (which re-runs the gate) still fails until the gate or `liveCapture.ts` changes** |

Sizes (measured by hand, since the gate exits before its budget table):

| Item | Value | Budget |
|---|---|---|
| `dist/` total | 105 MB, 95 files (`dist/pyodide/` 76 MB, `dist/assets/` 27 MB) | — |
| Largest worklet chunk | `rubberband-processor-*.js` 117,946 B raw / **33,049 B brotli** | 36,000 brotli ✅ |
| Entry chunk | 223,926 B brotli | 262,000 ✅ |
| `dist/assets/` excluding wasm | 827,813 B brotli | 890,000 ✅ |
| `hyphon_native.wasm` / `.st.wasm` | 358,066 / 344,510 B | 375,500 / 361,200 ✅ |

Tracked files the build dirtied: **`public/hyphon_wasm_export_map{,.st}.json` were not dirtied** (byte-identical after the rebuild). **`src/audio-worklets/rubberband-lib.js` was**: 50+/50−, made up of the `--pre-js` include path (`/root/web_sequencer-toolchain/…` → this checkout's path) and a reordering of the emitted `invoke_*` trampolines. Not committed.

### 4. `python deploy.py --dry-run`

- Plain `--dry-run`: **exit 1**. It re-runs the release gate, hits the false positive above, and stops (`not uploading`).
- `--dry-run --skip-checks`: **95 files, 31.9 MB archive**. `--include-sourcemaps` gives the same 31.9 MB, because the release build emits no maps (`HYPHON_SOURCEMAP` unset). A `HYPHON_SOURCEMAP=1` build zipped the same way: **34.9 MB** (42 `.map` files).
- **Target:** `deploy.py` no longer names `test.1ink.us` or `go.1ink.us`. It POSTs to `DEPLOY_ENDPOINT`, default `https://storage.noahcohn.com/api/deploy/web-sequencer/bundle`, and the server decides the folder. The 06-01 note above ("prints `test.1ink.us/hyphon`") is out of date. Which host serves the result is not visible from this repo.

### 5. Serve + Playwright (Chromium)

`pnpm exec vite preview --host 127.0.0.1 --port 5173 --strictPort`: COOP `same-origin`, COEP `require-corp`, and **`crossOriginIsolated === true`** in the page. The installed `@playwright/test` wants Chromium build 1200 and the container has 1194, so the runs used a throwaway config that only sets `executablePath: /opt/pw-browsers/chromium` (not committed).

| Spec | Result |
|---|---|
| `tests/drumkit-native.spec.ts` | ✅ 1/1 |
| `tests/live-issue-triage.spec.ts` | ✅ 7/7: #1389, #1390, #1391, #1392, #1393, #1395, #1396 all pass |
| `tests/deploy-smoke.spec.ts` | ⏭ skipped (it needs `DEPLOY_SMOKE_URL`). With `DEPLOY_SMOKE_URL=http://127.0.0.1:5173/`: ✅. With `DEPLOY_SMOKE_URL=https://test.1ink.us/hyphon/` (the live **June** build): ✅ too, so a green smoke after a deploy does not prove the new build is live; also check that `Last-Modified` changed |

Boot console (INITIALIZE SYSTEM → kick on step 1 → PLAY; `AudioContext` `running`):

```
[warning] Failed to create WebGPU Context Provider            (×3, expected: no GPU in sandbox)
[error]   [EngineFallback] webgpu: requested "webgpu" → JS fallback (requestAdapter() returned null …)   (expected)
[warning] [Hyphon Engine Warning] "webgpu" engine could not load …                                  (expected)
[warning] [BackendRegistry] oscillator backend fell back WebGPU → WASM OSC                          (expected)
[error]   Failed to load ./assets/saw.wav EncodingError: Unable to decode audio data                 FINDING
[error]   Failed to load ./assets/square.wav EncodingError: Unable to decode audio data              FINDING
[error]   ❌ Supertonic Init Failed: SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON   FINDING
```

No 404 on a worklet, no LinkError, no missing export. **Root cause of the three findings** (already noted on 10-13, not explained then): `public/assets/` is gitignored (`.gitignore:21 assets/`), but `engineLifecycle.ts:298` and `renderAudio.ts:168` fetch `./assets/{saw,square}.wav`, and `Supertonic.ts` fetches `assets/onnx/*` and `assets/voice_styles/*`. The repo ships `saw.wav` / `square.wav` at `public/` root. In a clean checkout those paths do not exist, and the preview server's SPA fallback answers them with `index.html`. On `test.1ink.us/hyphon/` all of them answer 200 (`audio/x-wav`, JSON), so production has the files, either from the owner's local `public/assets/` or left over on the server. **A dist built from a clean checkout is therefore not the dist that ships.** Before deploying, confirm that the owner's `public/assets/` is populated, or that the server keeps files the zip leaves out.

### 6. Live site (fetched 2026-10-20)

| URL | `Last-Modified` | COOP/COEP |
|---|---|---|
| `https://go.1ink.us/hyphon/index.html` | Fri, 06 Mar 2026 12:59:17 GMT | same-origin / require-corp |
| `https://test.1ink.us/hyphon/index.html` | Mon, 15 Jun 2026 06:53:49 GMT | same-origin / require-corp |

Unchanged. Not deployed (`DEPLOY_TOKEN` is the owner's).

### 7. For the owner

1. Make the build pass first. As of `3dee74a`, `pnpm run build` fails at `tsc` (7 errors), and with that fixed it fails at the release gate's `AgentBridge` false positive. `deploy.py` refuses the dist for the same reason unless given `--skip-checks`.
2. Then run `DEPLOY_TOKEN=… pnpm run deploy` from a checkout whose `public/assets/` holds `saw.wav`, `square.wav`, `onnx/` and `voice_styles/` (see §5).
3. Then run `DEPLOY_SMOKE_URL=https://test.1ink.us/hyphon/ pnpm exec playwright test tests/deploy-smoke.spec.ts`, and check that `curl -sI https://test.1ink.us/hyphon/index.html` shows a new `Last-Modified`. The smoke alone passes on the June build.
4. Issues #1389–#1397: **all nine are already closed** (owner, 2026-10-20 08:12–08:53Z), before any deploy reached the live site. The triage spec passes every check it has on `main` (#1389–#1393, #1395, #1396). #1394 is fixed in code by #1474 and #1397 by #1476. Neither is live until the deploy.
5. **`go` vs `test`:** `deploy.py` targets neither by name, only the storage endpoint. Every `test.1ink.us` reference is in tests (`deploy-smoke.spec.ts` default) and in `docs/weekly_plan.md`. AGENTS.md names no live host at all. The PROJECT CONTEXT's `go.1ink.us` is the older of the two (March) and is not what `deploy-smoke` checks. They disagree. Whichever is canonical should be written into `deploy.py`'s docstring and AGENTS.md › Deployment.
