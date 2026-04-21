# Copilot instructions — Hyphon (web_sequencer)

Purpose

Short, focused guidance to help Copilot-style assistants (and future sessions) work effectively in this repository: where to find build/test/lint commands, the runtime/build boundaries for the multiple audio engine toolchains, and project-specific conventions that commonly confuse automated tools.

Quick commands

- Install: `npm install`
- Dev server (dev build may invoke WASM/emcc steps): `npm run dev`
- Full production build (runs WASM + Emscripten + Rust steps): `npm run build`
- Build only WASM pieces (high-level): `npm run build:wasm`
- Build Emscripten native pieces: `npm run build:emcc`
- Lint: `npm run lint`  (runs `eslint .`)
- Run tests (Vitest): `npm test`  (runs `vitest run`)
- Preview production build: `npm run preview`
- Deploy: `npm run deploy`

Run a single test (Vitest)

- Run a single test file: `npx vitest path/to/testfile.test.ts`
- Pass a path through npm: `npm run test -- path/to/testfile.test.ts`
- Run by test name/pattern: `npx vitest -t "partial test name"`

Playwright (E2E)

- Run all Playwright tests: `npx playwright test`
- Run a single spec: `npx playwright test tests/your.spec.ts`

High-level architecture (big picture)

- Frontend: React + TypeScript + Vite. Source: `src/` (alias `@` -> `/src`).
- "Four Worlds" audio engine strategy (separate build/toolchains):
  - AssemblyScript (assembly/ -> produces `src/wasm/*.wasm`) — oscillators, freezer, FFT, export helpers
  - Rust (rust-audio/ -> `public/rust-wasm/`) — high-precision synthesis
  - Emscripten C++ (emscripten/ -> `public/hyphon_native.js`, `rubberband.wasm`) — Rubberband, pyodide glue, native code
  - JC-303 submodule (jc303_wasm/) — TB-303 clone; builds to `public/jc303.*`
- Other runtimes: WebGPU (voice designer / GPU DSP), Pyodide (Python DSP/TTS), ONNX Runtime Web for TTS, and standard Web Audio for the final audio graph.
- Build outputs (generated): `src/wasm/`, `public/rust-wasm/`, `public/hyphon_native.js`, `public/jc303_*`. These are build artifacts — expect them to be missing on a fresh checkout.

Important runtime & build notes

- Vite dev server enforces Cross-Origin headers (COOP/COEP) required for SharedArrayBuffer and threaded WASM (see `vite.config.ts`).
- Many build scripts require native toolchains (emsdk, wasm-pack, asc). `npm run build` runs all heavy steps; it can fail if toolchain not present.
- `package.json` exposes granular build scripts (e.g., `build:wasm:oscillators`, `build:wasm:rust`, `build:emcc`) — use the specific one when you only changed that domain.
- WASM artifacts are generated — do not rely on committing them. If you change `assembly/*`, rebuild the corresponding `build:wasm:*` target.

Key conventions (project-specific)

- Central audio orchestration: `src/hooks/useAudioEngine.ts` — start here for backend resolution and fallback ladders.
- Per-domain code lives under distinct folders: AssemblyScript in `assembly/`, Rust in `rust-audio/`, Emscripten/C++ in `emscripten/`, JC-303 under `jc303_wasm/` (submodule). The build scripts are intentionally separate.
- Dynamic loading pattern: WASM and heavy modules are loaded with `import()` / top-level-await. Vite plugins (`vite-plugin-wasm`, `vite-plugin-top-level-await`) are enabled.
- Tests: Vitest config uses `happy-dom` and `vitest.setup.ts` to mock `AudioContext` / `AudioWorkletNode`. Expect tests to mock audio primitives.
- ESLint: TypeScript + React hooks rules are enforced; `no-unused-vars` is adjusted (see `eslint.config.js`).
- Alias `@` -> `/src` is configured in `vite.config.ts`.
- `public/` contains compiled binaries referenced by the app; missing files are often the cause of runtime "WASM not found" errors.

Places to look first when debugging audio/backends

- `src/hooks/useAudioEngine.ts` (primary)
- `src/hooks/audioEngine/**` (sub-hooks and fallback code)
- `src/engines/**` (engine wrappers and bridges)
- `src/audio-worklets/` and `public/audio-worklets/` (worklets)
- `assembly/` and `src/wasm/` (source and generated WASM)
- `public/` for generated binaries (rust-wasm, hyphon_native, jc303)
- Network console for ONNX / model downloads (TTS)

AI-assistant / repo docs to fuse into Copilot behavior

- `README.md` — quick start and major scripts (includes TTS model notes and quick commands).
- `AGENTS.md` / `claude.md` — contain the "Four Worlds" rule, SharedArrayBuffer/COOP+COEP requirement, and detailed build boundaries. Copilot sessions should respect those build-world boundaries and prefer touching TypeScript only unless explicitly asked to rebuild native/WASM pieces.

Practical tips for Copilot sessions (do this first)

- Use `package.json` scripts for authoritative commands. When in doubt, read `vite.config.ts` and `eslint.config.js` for environment expectations (COOP/COEP, optimizeDeps excludes).
- For test generation, prefer unit tests that run in the Vitest/happy-dom environment; use `vitest.setup.ts` to inspect how audio primitives are mocked.
- When patching audio engine selection/fallback logic, only modify the JavaScript/TS boundary (hooks/engine wrappers). Avoid changing assembly/rust/c++ sources unless a new change explicitly requires a corresponding WASM rebuild.

If you edit this file

- Keep the Build/Test/Lint commands up to date (source of truth: `package.json`).
- If you add new heavy build steps (new WASM or native outputs), document them here and the corresponding `build:*` script.

Relevant files & locations (short list)

- Main app: `src/` (`src/main.tsx`, `src/App.tsx`)
- Audio orchestration: `src/hooks/useAudioEngine.ts`, `src/hooks/audioEngine/`
- Engines: `src/engines/` and `assembly/` / `rust-audio/` / `emscripten/` / `jc303_wasm/`
- Tests: `src/__tests__/`, `src/components/__tests__/`, `tests/` (Playwright)
- Config: `vite.config.ts`, `eslint.config.js`, `vitest.setup.ts`, `playwright.config.ts`

License & contact

- See `README.md` for feature notes and TTS model download guidance. If uncertain about rebuilding native/WASM pieces, ask for help — those steps require extra environment setup.

----


## Playwright CI (configured)

A GitHub Actions workflow has been added: `.github/workflows/playwright-e2e.yml`. It runs the full Playwright E2E suite on push to `main` and on pull requests to `main`. Steps performed by the workflow:

- checkout
- npm ci
- npm run build
- install Playwright browsers (npx playwright install)
- serve `dist/` on port 5173 using `npx http-server`
- run `npx playwright test`

Warning: This workflow runs the full E2E suite and is resource-heavy; consider switching to a smoke subset for frequent PRs.

(End of copilot-instructions.md)
