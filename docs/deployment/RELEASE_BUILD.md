# Release build, fresh checkout to staging

How to get from `git clone` to a verified, deployable `dist/`, what each prerequisite is for,
and which build warnings are accepted (with the reason). Written for Release 1/5 (Build → Test →
Deploy). Companion docs: [DEPLOYMENT_CONFIG.md](DEPLOYMENT_CONFIG.md) (hosting path rules),
[../wasm/BUILD_NOTES.md](../wasm/BUILD_NOTES.md) (native toolchain), [../BUILD_HEALTH.md](../BUILD_HEALTH.md).

## The fresh-checkout recipe

```bash
git clone <repo> && cd web_sequencer
git submodule update --init --depth 1 jc303_wasm third_party/eurorack third_party/stmlib
pnpm install --frozen-lockfile          # no postinstall downloads; works network-restricted
pnpm run setup:emsdk                    # pinned emcc → .cache/emsdk (linux-x64; skip if you have emsdk 6.0.13)
pnpm run build                          # = build:release
```

`pnpm run build` runs, in order: every native world (`build:native` — AssemblyScript, the
`hyphon_native` voice module in both link profiles, Rubber Band, mix bus), the strict WASM
export-map checks, `vendor:pyodide`, `tsc -b && vite build`, the native-artifacts manifest, and
`scripts/check-release-dist.mjs` (budgets, worklet invariants, Pyodide and notices present, no
source maps). It exits non-zero if any of them fails.

| Prerequisite | Why | Failure you get without it |
|---|---|---|
| Submodules (`jc303_wasm`, `third_party/{eurorack,stmlib}`) | Open303 DSP and Plaits sources compiled into `hyphon_native` | the emcc world fails to find sources |
| Pinned Emscripten (`emscripten/toolchain.json`) | builds `public/hyphon_native*`, `rubberband.wasm`, `mix_bus.wasm`, `cpp_osc.wasm` (the `cpp-*` oscillator voices, #1665) | `emscripten/toolchain_env.sh` refuses any other emcc and prints how to install the pin |
| Rust stable + `rustup target add wasm32-unknown-unknown` | builds `public/rust_osc.wasm`, the `rust-*` oscillator voices (#1664) | `scripts/build-rust-osc.mjs` names the missing cargo / target; `check-release-dist` fails without the file |
| Network to `cdn.jsdelivr.net` (build time only) | `vendor:pyodide` vendors the same-origin Pyodide runtime (~76 MB) | `check-release-dist` **fails** (it used to only warn) |
| `pnpm install` | `asc` (AssemblyScript) lives in `node_modules`; `pnpm run …` puts it on PATH | — |

`wasm-pack` is **not** an npm dependency any more. Its postinstall downloaded a GitHub release
binary and failed `pnpm install` on restricted networks. Nothing needs it now: the Rust world
(`pnpm run build:wasm:rust`) builds with plain `cargo` and the crate has no dependencies.

### Building the web bundle without the native toolchain

`pnpm run build:web` (and a bare `vite build`) now run `scripts/check-build-prereqs.mjs` first.
If generated artifacts are missing it stops with the exact command to run instead of four
`UNRESOLVED_IMPORT` errors for `src/wasm/*.wasm?init`:

* the AssemblyScript outputs (`src/wasm/*`) need only `pnpm run build:wasm`;
* the Emscripten outputs need the pinned emcc, or restored CI artifacts (next section).

### Native artifacts

The native outputs are build products, not committed (only the export maps are). Two ways to
get a matching set:

1. **Build them** — `pnpm run setup:emsdk && pnpm run build:native`. `setup:emsdk` downloads the same
   `wasm-binaries.tar.xz` release build that `emsdk install 6.0.13` would (the build hash comes from
   emsdk's own `emscripten-releases-tags.json`, the tarball from `storage.googleapis.com`), unpacks it
   into `.cache/emsdk/`, and writes an `emsdk_env.sh` that `emscripten/toolchain_env.sh` finds on its
   own. No emsdk checkout and no git access to GitHub are needed. linux-x64 only; elsewhere use emsdk.
2. **Restore the CI-built set** — the `Integration + native tests` job uploads a `native-artifacts`
   artifact (the same files the CI cache holds, plus `.cache/native/` with the stamps and
   `native-artifacts.json`). Download it into the repo root (`gh run download <run-id> -n native-artifacts`),
   then `pnpm run build:release:changed` skips every world whose inputs still match, and
   `check_wasm_export_map --require-artifacts` stays strict either way.

`pnpm run check:native` reports which worlds are missing or stale and prints the rebuild command.

## Warnings in `pnpm run build`

Zero unexplained. Each remaining one, and why it stays:

| Warning | Source | Status |
|---|---|---|
| `Module "fs" has been externalized for browser compatibility` | `xmWriter.saveToFile` Node-only dynamic import | **Fixed** — specifier is no longer a literal (`/* @vite-ignore */`) |
| `[INEFFECTIVE_DYNAMIC_IMPORT] CloudStorage.ts …` | `useSongStorage` dynamically imported a module that is statically imported elsewhere in the entry graph | **Fixed** — static import (the module was already in that chunk; no size change) |
| `Browserslist: browsers data (caniuse-lite) is 11 months old` | stale transitive `caniuse-lite` in the lockfile | **Fixed** — lockfile bump of `caniuse-lite` only |
| `dist/pyodide/ is empty` (check-release-dist) | `vendor:pyodide` was not in the release path | **Fixed** — `build:release` vendors it; the gate now fails instead of warning |
| `Some chunks are larger than 500 kB` | `index-*.js` (entry, ~1.0 MB raw / 217 KB brotli) and `Studio3D-*.js` (lazy three.js, ~0.9 MB raw) | **Accepted.** The raw 500 kB figure is not the cost that matters; `dist-budget.json` gates the compressed wire size (entry ≤ 262,000 B brotli, whole `assets/` ≤ 2,000,000 B) and `check-release-dist` fails the build when exceeded. Splitting the entry further is a performance project, not release hygiene |
| `clang++: warning: treating 'c' input as 'c++' (-Wdeprecated)` ×3 | Rubber Band build compiles bundled kissfft/speex `.c` files under `-std=c++17` | **Accepted.** Changing how those files are compiled changes the shipped DSP binary (render-parity risk) for no functional gain |
| `Last converge was suboptimal.` | `asc --converge` on `fft.ts` | **Accepted.** Informational from the optimizer: the output is valid; it only means a further optimize pass would still shrink it |
| `[PLUGIN_TIMINGS]` | Vite 8 build profiler note | Informational, not a warning |

## Asset paths and the subpath

The app is hosted under a subdirectory and built with `base: './'`; see
[DEPLOYMENT_CONFIG.md](DEPLOYMENT_CONFIG.md). Audit result: every runtime fetch, worker, worklet
and image URL goes through `import.meta.env.BASE_URL` or a `?url`/`?worker` import. One stray
literal (`moduleUrl: "/rubberband.js"` posted to the Rubber Band worklet; nothing read it, and the
file does not exist) was removed. `src/__tests__/noAbsoluteAssetPaths.test.ts` now fails on a new
root-absolute `fetch('/…')`, `new Worker('/…')`, `addModule('/…')` or `'/name.ext'` asset literal
(the oscillator panel art table is allow-listed: it is rebased by `oscillatorPanelImageUrl`).

To check a build under a subpath: `pnpm exec vite preview --base /hyphon/` and open
`http://localhost:4173/hyphon/`.

## Bundle size baseline

```bash
node scripts/analyze-bundle.mjs --json > base.json    # on the base commit's dist/
pnpm run bundle:compare base.json                     # on yours: markdown delta, never fails
```

The gate itself is `dist-budget.json` via `check-release-dist.mjs` (printed at the end of
`pnpm run build`). Brotli sizes and headroom for the Release 1/5 build are recorded in the
State of the App report on the issue.

## Deploying and verifying

`deploy.py` zips `dist/` and POSTs it to the deploy host; it re-runs `check-release-dist.mjs` first.

```bash
DEPLOY_TOKEN=… python deploy.py                       # production
DEPLOY_TOKEN=… DEPLOY_STAGING_ENDPOINT=… \
  python deploy.py --target staging --verify-url https://<host>/<staging-folder>/
```

`--target staging` never falls back to production: with `DEPLOY_STAGING_ENDPOINT` unset it refuses.
The staging folder is a server-side resource (it must exist on the deploy host and be served with
the isolation headers below); the manual `Staging deploy` workflow
(`.github/workflows/staging-deploy.yml`) builds a ref, deploys it there and runs the check.

### The header check

The app needs `SharedArrayBuffer` (pthread `hyphon_native.wasm`), so the production host must send
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` and a
`Cross-Origin-Resource-Policy` header. Vite dev/preview set them; a static host only does if
configured, and nothing used to check.

```bash
pnpm run check:deploy-headers -- https://<host>/<folder>/ --expect-sha "$(git rev-parse HEAD)"
```

For `index.html` and `hyphon_native.wasm` (add more with `--path`) it prints the response headers,
fails on a non-200, a missing/incorrect COOP/COEP/CORP, wasm not served as `application/wasm` or
`index.html` not served as UTF-8 `text/html`, and, with `--expect-sha`, when
`native-artifacts.json`'s `sources.gitHead` is not the commit you built. That file is how you read
"the SHA served by the live bundle": `curl -s <url>/native-artifacts.json | jq .sources.gitHead`.
