# web_sequencer — Weekly Plan

## Today's focus
**2026-06-29 — FIX FIRST mode.** Last week's lockfile fix **landed and works** — `main` CI (`ci.yml` = Lint + Test) is green and stable across the week's merge spree (#793, #814, #816, #817, #818…). But the foundation is still cracked in a way the green CI badge **hides**: the main CI gate **never runs `tsc`** — it does `install → build:wasm → lint → vitest` and nothing type-checks. The only workflow that type-checks is **Playwright E2E** (via `pnpm run build` → `tsc -b`), and it's the flaky/slow one gated behind a browser install. Consequences observed this week:
- The formant-vocoder / spectral merges introduced **`TS2339` type regressions** (`vocoderFormantShift/Preservation/Attack/Release` not on the param union) that sailed past green CI and only flickered red in **E2E across #814/#816/#818**. They were patched late by adding the props to `src/types.ts` (good) **plus 4 dead `(noteParams as any)` casts left in `src/hooks/useAudioEngine.ts`** (band-aid — the types now exist, the casts defeat them).
- **`debug_build.yml` (Diagnostic Build & Test) is RED on every single run** (`total_jobs: 0`) — malformed YAML: the **`Setup Rust` step is mis-indented** (6 spaces, nested under `setup-node`'s `with:` instead of a sibling step), so the workflow never loads. A permanently-red check on every commit masks any *new* red X.

**Primary task — harden the CI type-safety surface (closes standing backlog "Green-CI guardrail"):**
1. **Add a `tsc` type-check step to `ci.yml`** (e.g. `pnpm exec tsc -b --noEmit` after `build:wasm`, before or beside lint) so type regressions fail the **main** gate, not just the flaky E2E build.
2. **Fix `debug_build.yml`** — correct the `Setup Rust` indentation so it's a sibling step; confirm the workflow actually loads and runs (or, if it's redundant with `ci.yml`, make the deliberate call to delete it rather than leave it perma-red).
3. **Remove the `as any` type-escape band-aids** in `src/hooks/useAudioEngine.ts` (4 vocoder casts + audit sibling spectral casts) now that `src/types.ts` declares the properties; restore real typing in the audio hot path.
4. **Verify:** `pnpm exec tsc -b` clean (0 errors), `pnpm run build` green, and all three workflows (`CI`, `Playwright E2E`, `debug_build`) green on the fix branch before merge.

**Why this over anything else:** the big CI win landed, but the gate that proves it is incomplete — it can't catch type drift, and the merge spree already exploited that gap with `as any` escapes. Fixing the gate now prevents the next silent type regression and clears the always-red diagnostic check. No new feature ideas until the type gate exists.

## CI toolchain log
- **2026-06-29 — reconcile: last week's CI fix LANDED (different fork than logged).** The version that actually merged to `main` **pinned `vitest` back to `2.1.9`** and kept `vite ^5.4.21` (the conservative fork from `.swarm-state.md`, NOT the vitest-4/vite-6 forward migration logged below). `@babel/helper-plugin-utils` is **still present** in `package.json` and **still unused in `src/`** (grep-confirmed) — the logged "dropped" never happened; carry as a tiny cleanup. Net: main `ci.yml` install/lint/test gate is green and stable. **Gap exposed:** `ci.yml` runs `build:wasm → lint → vitest` only — **no `tsc`**. That's today's FIX FIRST.
- **2026-06-22 — vitest 4 + vite 6 forward migration (the FIX FIRST primary task).** Chose the *migrate-forward* fork over pinning vitest back. Changes:
  - `package.json`: `vite ^5.4.21 → ^6.3.6` (vitest 4 requires vite 6's `./module-runner` export — the root of the `ERR_PACKAGE_PATH_NOT_EXPORTED` crash), kept `vitest ^4.1.9`, **dropped `@babel/helper-plugin-utils`** (referenced nowhere in source — accidental dep from #793). Regenerated `pnpm-lock.yaml` (now resolves vite 6.4.3 / vitest 4.1.9; `--frozen-lockfile` will pass).
  - **vitest 4 mock breakage:** vitest 4 invokes `vi.fn().mockImplementation(...)` via `Reflect.construct` when used with `new`, so arrow-function implementations throw "is not a constructor". Converted the constructable mocks to `function` expressions in `vitest.setup.ts` (`AudioContext`, `Worker`), `SingingVoiceManager.test.ts` (`SingingVoice`), `VoiceEditor.test.tsx` (`VoiceDesigner`), `Open303Config.test.ts` (`AudioWorkletNode`).
  - **Genuine pre-existing bug surfaced & fixed:** esbuild 0.25 (pulled in by vite 6) rejected `src/hooks/audioEngine/audioPlayback.ts` with `Unexpected "}"` at line 562 — a real orphaned closing brace in `createPlayDrum` left behind when the "retrigger loop" was removed (line 428 comment). `tsc` agrees (TS1128). esbuild 0.21 under vite 5 had silently tolerated it; this was never validated because CI couldn't install. Removed the stray brace.
  - **Result:** full suite green under vitest 4 / vite 6 — **1128 passed, 3 skipped, 104 files (1 skipped)**. Validated locally after building the 5 AssemblyScript wasm targets (`oscillators`, `trackFreezer`, `fft`, `audioExport`, `xmExport`) that suites import via `?init` (CI's `Build WASM` step does this).
  - **Still red elsewhere (NOT this migration's scope, separate merge-spree fallout):** `tsc -b` reports pre-existing errors in untouched files — `NoteSelector.tsx` (`"vocoderMix"` not in param union), node-builtin/`global`/`Buffer` type resolution in some test files (`engineInitPaths`, `trackFreezer`, `CloudStatus`, `xmWriter`). These block `tsc -b && vite build` and need a follow-up pass.

## GPU compute log
- **2026-06-22 — WebGpuBackend GPU-resident op chaining (`runChain`).** Added `runChain(ops[], data, dims, params[])` to `src/services/WebGpuBackend.ts`. It ping-pongs between two persistent STORAGE buffers across all ops in a *single* command submission and reads back exactly **once** at the end (one `mapAsync`), eliminating the per-op `outputBuffer → readbackBuffer → mapAsync` round trip that `runOp()` pays for every op. Each op gets its own 16-byte uniform buffer (passes coexist in one submit, so they can't share a mutable uniform). `runOp()` is untouched for single-op callers.
  - **Pooled allocator:** adopted the size-bucketed (4KB) pool pattern from `WebGpuOscillator.ts` — `storagePool` (STORAGE|COPY_SRC|COPY_DST ping-pong pair) + `readPool` (MAP_READ|COPY_DST), capped at 4/bucket, plus a `destroy()` teardown. Replaces fresh per-call STORAGE allocations on the chain path. (Full unification of both classes onto one shared pool left as a follow-up — kept this change small.)
  - **Fallback + telemetry preserved:** returns `null` when WebGPU is unavailable (callers fall back to CPU, same contract as `runOp`); registers `webgpu-compute` resolution on init and `logEngineFallback(...)` on adapter/device/alloc/dispatch failure, mirroring the oscillator's telemetry. Stays OFFLINE/precompute — never awaited on the audio worklet thread.
  - **Call site:** `VoiceDesigner._runGpuChain()` + new `dspMangle()` (sharpen→quantize→tremolo) demonstrate composing ops with no intermediate readback; degrades to the existing per-op CPU fallback when GPU is down or `runChain` returns null.
  - **Tests:** `src/services/WebGpuBackend.test.ts` (6 cases) — empty/unavailable contracts, one pass per op + single readback, ping-pong wiring (op N output === op N+1 input), unknown-op error path, pool reuse across calls. Verified all 10 GPU tests green under vitest 2.1.9 (the repo's installed vitest 4.1.9 is incompatible with vite 5.4.21 — the documented red-CI mismatch above; full `tsc --noEmit` is clean: 0 errors).

## Ideas
- [done — 2026-04-27] **Verify bug-report.md staleness** — confirmed stale; file deleted.
- [done — 2026-05-25] **Holographic knob GPU context unification** — `KnobGPUContext.ts` singleton + `MagicKnob.tsx` ported.
- [done — 2026-06-01] **Holographic knob WGSL/2D drift-kill** — `knobMaterial.ts` shared contract consumed by WGSL + Canvas2D; `knobMaterial.contract.test.ts` guards palette/geometry/bloom parity.

## Backlog
- [in progress — 2026-06-29] **Green-CI guardrail** — the lockfile half is moot (vitest pinned, lockfile consistent). The live half is the **missing `tsc` type gate in `ci.yml`** → today's FIX FIRST. Also still worth a `lockfile-check` / `pnpm install --frozen-lockfile` pre-push hook so a future stale lockfile fails before merge.
- [ ] **vitest 4 / vite 6 forward migration (deferred deliberately)** — `main` is pinned to `vitest 2.1.9` / `vite ^5.4.21`. Track the v4/v6 bump as its own task (vitest-4 `Reflect.construct` mock breakage, `vite/module-runner` export, `@fast-check/vitest` peer compat — all documented in the 2026-06-22 toolchain log above).
- [ ] **Drop unused `@babel/helper-plugin-utils`** from `package.json` devDeps (grep-confirmed unused in `src/`; accidental dep from #793). Tiny; fold into today's branch or a hygiene pass.
- [ ] **Epic #773 — ReBirth RBS v1.5/2.0 song fidelity** (opened 2026-06-18 by `cursor`). 8 child issues: #774 real-fixture corpus + golden suite, #775 DEVL packed-struct parser (`rbs.h`), #776 PCF + per-pattern 303 param extraction, #777 per-track TRAK controller tables, #778 v1.5 subset support, #779 32-pattern banks beyond 8 slots, #780 RbsExporter (write `.rbs`), #781 E2E import→song-mode→automation. This is the next big theme after CI is green.
- [ ] **Repo hygiene** — 13 root `*.md` files + 9+ one-off `fix*.py` / `patch*.py` / `update_*.py` / `replace_helpers*.py` scripts at repo root. Candidate: `DOCS.md` index + archive scripts into `tools/`. **= Today's decoupled Copilot issue (B).**
- [ ] Rubberband phoneme-aware time-stretch + `ExpressiveVoiceProcessor.ts` pending per `RUBBERBAND_ENHANCEMENT_PLAN.md`.
- [ ] RBS import test+docs polish — expand Vitest coverage for parser/importer/scheduler + document automation architecture (now subsumed/expanded by epic #773).

## Done
- 2026-06-29 — **Restore green CI on `main` (2026-06-22 Fix First) — LANDED & VERIFIED.** Fix merged via the conservative fork (vitest pinned `2.1.9`, lockfile regenerated, stray brace in `audioPlayback.ts` removed, `vocoderMix` added to property-change unions). `ci.yml` (Lint + Test) green and stable across the week's merges (#793/#814/#816/#817/#818). The week's previously-unvalidated feature spree (formant vocoder #793, granular jitter #791, drum-retrigger #792, spectral morph #785, spectral resynthesis #814) is now CI-validated. Follow-up cracks (missing `tsc` gate, perma-red `debug_build.yml`, `as any` band-aids) carried into today's Fix First.
- 2026-06-15 — **Issue #720 — Oscillator fallback audit CLOSED (completed)** by ford442. The prior Fix First lead task landed during the week; all 6 degrading engines addressed. (Routine primed it 2026-06-15; closed 13:50 same day.)
- 2026-06-22 — _Reconciled, landed-but-UNVALIDATED this week (CI red — validation pending today's fix):_ formant-preserving vocoder phase 1 (PR #793), granular position jitter (PR #791), drum-retrigger optimization (PR #792), spectral morph automation (PR #785), audio inner-loop param hoisting (#786), + accessibility/palette batch (ScaleSelector #788, AutomationLane ARIA #787, modal close buttons #782/#784, focus rings).
- 2026-06-15 — **Palette: aria-labels on oscillator variant buttons** (PR #760, merged — commits `6b0f753` / `9ca0e24`). Closes prior sprint target #3.
- 2026-06-15 — **Vocal Pitch Envelope** (PR #759, Jules): `pitchAttack`, `pitchDecay`, `pitchAmount` on `Note` / `SamplerParams`; `SingingVoice.ts` setters; `ExpressiveVoiceProcessor.ts` attack/decay envelope; `rubberband-processor.ts` per-step + global routing; UI knobs in `SamplerPanel` + per-step controls in `SamplerVoicePanel` / `SamplerPitchControls` / `ContextMenuNode`.
- 2026-06-15 — **Time-Stretch Envelope** wiring completed (PRs #756, #757): `timeStretchEnvDepth` per-step + global path through `SingingVoice` → rubberband worklet.
- 2026-06-15 — **Palette: standardize focus rings** (PR #758).
- 2026-06-01 — Holographic knob render-pass PLUMBING + shared `knobMaterial.ts` contract on `main`.
- 2026-06-01 — Backlog reconcile: PRs #506 & #507 confirmed closed-unmerged; GitHub issue count reset.
- 2026-05-25 — Holographic knob GPU context unification (PR #617 context).
- 2026-05-18 — jc303/Open303 WASM pipeline stabilized (PRs #569 + #572).
- 2026-05-18 — Live keyboard drum voices with MIDI pitch shifting (PR #571).
- 2026-05-18 — Vocal Harmony Parallel Bus (PR #568).
- 2026-05-18 — Palette: decorative UI hidden from screen readers (PR #567).
- 2026-05-11 — Gesture Controls: pinch/scroll zoom on sequencer (PR #513).
- 2026-05-11 — BottomBar Accessibility Enhancements (PR #511).
- 2026-05-04 — TTS per-bank cold-start preload + onnxruntime-web cache purge devtool.
- 2026-05-04 — SamplerPanel `<fieldset>` conversion (PR #483 + a11y passes).
- 2026-05-04 — Master Bus Compressor (PR #479), MainSequencer re-render optimization (PR #480).
- 2026-05-04 — Hybrid Audio Engine Fallback HUD: `EngineHUD.tsx` + `engineTelemetry` (Ctrl+Shift+E / `?hud=1`).
- 2026-04-27 — Custom Waveform LFO, aria-label passes, step-sequenced reverb types, AdvancedNoteSelector Escape, DrumMachine memoization.
- 2026-04-20 — Accessible ARIA switches (PR #456).
- 2026-04-19 — Custom Sample Slicing UI (PR #455), orphaned aria-describedby fix (PR #454).
- 2026-04-18 — AI auto-mix assistant (PR #453).
- 2026-04-17 — Keyboard accessibility for custom radio groups (PR #452).
- 2026-04-16 — Step-sequenced formant shifts (PR #451).
- 2026-04-15 — Global convolution reverb effect.
- 2026-04-14 — Palette: tabpanel roles (PR #450).
- 2026-04-13 — Auto-slice by transients (PR #444), aria-busy on processing buttons (PR #445).
- 2026-04-12 — AdvancedNoteSelector + ScaleSelector (PR #443).
- 2026-05-31 — consonantEmphasis TTS control (PR #693 merged).
- 2026-05-30 — RBS → Hyphon importer scaffolding (PRs #685/#686 merged).

## Claude Wins / Post-Run Notes
_(Running log — fill in at end of each weekly session.)_

| Date | Shipped | Notes |
|------|---------|-------|
| 2026-06-01 | (incomplete) | Holographic-knob drift-kill started; `knobMaterial.ts` contract landed but session ended before full verification. |
| 2026-06-16 | _(pending)_ | Prep: plan refreshed, tests green after `pnpm run build:wasm`, issue #720 primed. |
| 2026-06-22 | ✅ green CI restored | Fix First: main CI red since 06-21 (stale pnpm-lock.yaml — vitest 2→4 bump in #793 without lockfile regen). Fix landed via conservative fork (vitest pinned 2.1.9); `ci.yml` green & stable. |
| 2026-06-29 | _(pending)_ | Fix First: main CI green but **never type-checks** (`ci.yml` has no `tsc`); merge-spree type drift slipped past it (vocoder formant `TS2339`, patched late w/ `as any`). Plus `debug_build.yml` perma-red (malformed YAML). Plan = add `tsc` gate + fix workflow + strip `as any`. Noah notified. |

## Last run
Date: 2026-06-29
Mode: Fix First
Focus: Harden the CI type-safety surface. Last week's lockfile fix landed (main `ci.yml` green & stable, vitest pinned 2.1.9), but `ci.yml` runs only `build:wasm → lint → vitest` — **no `tsc`**. Type regressions from the formant-vocoder/spectral merge spree (`vocoderFormantShift/Preservation/Attack/Release` → `TS2339`) sailed past green CI, surfaced only as flaky red in the E2E build, and were patched late by adding the props to `src/types.ts` PLUS 4 dead `(noteParams as any)` casts in `src/hooks/useAudioEngine.ts`. Separately, `debug_build.yml` is red on every run (`total_jobs: 0`) due to a mis-indented `Setup Rust` step. Primary task: add a `tsc` step to `ci.yml`, fix `debug_build.yml`, strip the `as any` band-aids, verify all three workflows green.
Outcome: Planning run. Reconciled: 2026-06-22 "restore green CI" → DONE & verified (conservative fork merged, not the vitest-4 forward migration that was logged). New cracks identified from live CI logs (run 28349610499 debug_build `total_jobs:0`; run 28349131219 E2E `TS2339` vocoder errors). weekly_plan.md updated (Today's focus = CI type gate, Done reconcile, Backlog: Green-CI guardrail → in progress + vitest-4 deferred + babel dep cleanup, wins table). Dispatch: kimi-cli swarm = add `tsc` gate + fix `debug_build.yml` + strip `as any` (scoped to `.github/workflows/` + `ci.yml` + `useAudioEngine.ts` + `types.ts`); decoupled Copilot issue = repo hygiene (root `*.md` + one-off `fix*/patch*/replace_helpers*.py` archival into `tools/` — zero overlap with workflows/audio engine); Claude Code = whole-stack build→deploy→smoke. Jules wrap-up template provided. Noah notified via push. **Context gap:** chat-history tools (`recent_chats`/`conversation_search`) unavailable in this environment — context from repo state + GitHub Actions MCP + plan file only; no visibility into Noah's in-week chat mentions.

## Prep checklist (before each weekly Claude session)
- [ ] Refresh this file (date + 3–4 scoped targets)
- [ ] `pnpm install --frozen-lockfile && pnpm run build:wasm && pnpm run lint && pnpm test`
- [ ] `main` clean and pushed; optional branch `claude-YYYY-MM-DD` for PR-based output
- [ ] Prime the lead issue with reproduction notes
- [ ] Point Claude at: `weekly_plan.md`, lead issue, latest feature merge, `AGENTS.md`

## Issue #720 repro notes (paste as issue comment if desired)
Diagnostics already on `main`: fallback transitions log via `logEngineFallback()` in `src/utils/engineTelemetry.ts` (console prefix `[EngineFallback]`). Runtime HUD: **Ctrl+Shift+E** or `?hud=1` (`EngineHUD.tsx`).

**Repro checklist (fresh checkout / CI-like env):**
1. `pnpm install --frozen-lockfile && pnpm run build:wasm && pnpm run build:emcc` — without WASM artifacts, engines fail at import/init.
2. Dev server must serve COOP/COEP headers (Vite config) for threaded `hyphon_native.wasm` / JC-303 pthread variants.
3. User gesture required to resume `AudioContext` before worklet engines initialize.

**Per-engine likely failure points (code audit, 2026-06-16):**
| Engine | Bridge | Common failure |
|--------|--------|----------------|
| Open303 / JC303 | `Open303Oscillator.ts`, `open303-processor` | `hyphon_native.wasm` fetch/timeout, worklet init error |
| Prophecy | `ProphecyOscillator.ts`, `prophecy-processor` | same native wasm + worklet path |
| Rust | `RustOscillator.ts` | `public/rust-wasm/` missing |
| WebGPU | `WebGpuOscillator.ts` | `navigator.gpu` null, device creation fail |
| Pyodide | `usePyodideEngine.ts` | CDN load / `window.Module` bootstrap |
| WASM (AS) | `WasmOscillator.ts` | `src/wasm/oscillators.wasm` not built |

## Context packet for 2026-06-16 run
| Resource | Why |
|----------|-----|
| `weekly_plan.md` (this file) | Sprint scope + backlog state |
| [Issue #720](https://github.com/ford442/web_sequencer/issues/720) | Oscillator fallback audit — lead task |
| PR #759 merge (`8234a1e` / `c266138`) | Vocal pitch envelope — params + file map |
| `AGENTS.md` | Build/test/commit conventions, Four Worlds rule |
| [PR #760](https://github.com/ford442/web_sequencer/pull/760) | Open a11y follow-up (review or merge) |
| `src/utils/engineTelemetry.ts` + `EngineHUD.tsx` | Fallback diagnostics tooling already on `main` |

**Vocal pitch envelope file map (PR #759):**
- Types: `src/types.ts` (`pitchAttack`, `pitchDecay`, `pitchAmount` on `Note` + `SamplerParams`)
- Engine: `src/engines/SingingVoice.ts`, `src/engines/rubberband/ExpressiveVoiceProcessor.ts`
- Worklet: `src/audio-worklets/rubberband-processor.ts`
- UI: `src/components/SamplerPanel.tsx`, `SamplerVoicePanel.tsx`, `SamplerPitchControls.tsx`, `ContextMenuNode.tsx`
- Hook wiring: `src/hooks/useAudioEngine.ts`, `src/hooks/audioEngine/sampleManagement.ts`
