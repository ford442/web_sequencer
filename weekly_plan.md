# web_sequencer — Weekly Plan

## Today's focus
**2026-07-13 — FIX FIRST mode.** Last week's escalated CI-hardening **largely EXECUTED this time** (unlike 06-29, which never ran): `ci.yml` now has a **`Type-check (tsc)` step** (`pnpm exec tsc -b`), **lint is un-masked** (`continue-on-error: true` gone — comment now reads "failures here must be fixed rather than masked"), **`debug_build.yml` was deleted** (perma-red workflow resolved by removal; only `ci.yml` + `playwright-e2e.yml` remain), and **`@babel/helper-plugin-utils` was dropped from `package.json`**. `useAudioEngine.ts` is back to a 1048-line file with `as any` down 21→16. Real progress.

**But the foundation is cracked again — and it's the exact recurrence the backlog warned about.** Dropping `@babel/helper-plugin-utils` from `package.json` was **not accompanied by a lockfile regen**, so `pnpm-lock.yaml` still carries the orphan entry (5 refs). Live evidence from `main` run **29243396503** (job 86794492928, 2026-07-13 10:38Z):
- Step 7 **`pnpm install --frozen-lockfile` FAILS** in ~1s with **`ERR_PNPM_OUTDATED_LOCKFILE — pnpm-lock.yaml is not up to date with package.json`**. Failure reason names the exact delta: the lockfile specifier set includes `@babel/helper-plugin-utils` but `package.json` does not.
- **Every downstream gate is SKIPPED**: `Build WASM`, **`Type-check (tsc)`**, `Lint (ESLint)`, `Test (Vitest)` — all `skipped`. The type-gate that landed this week **has never actually run on main**; install dies before it.
- **All recent main runs are `failure`** (#1017–#1031, 2026-07-13) — the merge spree (#909/#914/#915/#917/#918/#919/#921) has been landing on a red, install-broken `main`, so none of it is CI-validated. In-flight fix commits (`eb70561` "fix remaining lint errors", `d043baa` "missing commas in Harmonizer") were never gate-checked either.

This is the **second lockfile-caused CI break** (first was 2026-06-22). The standing backlog item — a `pnpm install --frozen-lockfile` pre-push hook — would have caught both.

**Primary task — restore green `main`, then finally install the guardrail so this can't recur:**
1. **Regenerate `pnpm-lock.yaml`** so it matches `package.json` (run `pnpm install` locally to drop the orphan `@babel/helper-plugin-utils` entry — 5 refs — then commit the lockfile). Nothing else should change in the lockfile.
2. **Let the now-live gate run for the first time.** Once install passes, `build:wasm → tsc -b → lint → vitest` execute on main for the first time in a week. **Fix whatever real errors they surface** — residual type drift, lint failures from the un-validated merge spree, the last 16 `as any` in `useAudioEngine.ts` (strip them against `src/types.ts`; add a genuinely-missing prop only if one is actually absent — do not re-add casts).
3. **Install the pre-push / pre-merge `--frozen-lockfile` guardrail** (husky pre-push hook or a dedicated `lockfile-check` CI job that runs `pnpm install --frozen-lockfile` on PRs) so a stale lockfile fails **before** merge, not after. This closes the standing "Green-CI guardrail" backlog item for good.
4. **Verify:** `pnpm install --frozen-lockfile` clean, `pnpm exec tsc -b` clean (0 errors), `pnpm run build` green, `pnpm test` green, and both live workflows (`CI`, `Playwright E2E`) green on the fix branch before merge.

**Why this over anything else:** `main` has been red at the install step for a week; the CI gate you just built cannot protect anything because it never runs. Regenerating one lockfile un-blocks the entire gate and reveals the true state of the merge spree. No new features until install is green, the gate has run, and the lockfile guardrail exists so this is the *last* time a manifest edit silently reds `main`.

## CI toolchain log
**Why this over anything else:** every other audit signal is clean (#720 closed, knob work shipped). The only cracked thing is the build gate, and it's invalidating a week of merged work silently.
**2026-07-06 — FIX FIRST mode (escalated).** Last week's 2026-06-29 Fix First was a **planning run only** — the dispatch was generated and the plan commit merged (PR #819), but the kimi-cli swarm to execute the CI type-gate hardening **never ran**. `.swarm-state.md` is still the stale 2026-06-22 CI-restoration state; nothing from 06-29 landed. Meanwhile the merge spree kept going (#826/#828/#848/#850…), and the foundation degraded from "green CI can't see type drift" to **"the primary audio hook does not parse."**

**Hard evidence gathered this run:**
- **`src/hooks/useAudioEngine.ts` has a genuine syntax error** — `esbuild` fails with `Expected ")" but found ";"` at **line 1013** (unbalanced `(` in the `playSamplerVoice` / `playBufferSource` region above it). The file **does not compile**. PR #850 (Jules, today) confirms it independently: *"useAudioEngine.ts has a pre-existing bracket/parse issue on main which continues to cause linting errors."*
- **CI masks it three ways:** `ci.yml` runs `lint` with **`continue-on-error: true`** (so the parse error is swallowed), still runs **no `tsc`** at all, and vitest degrades gracefully around missing WASM — so `main`'s "Lint + Test" badge is green over a non-parsing hot-path file. Perf PRs keep landing on top of it.
- **`debug_build.yml` is RED on every main run** (confirmed 3/3 latest: runs 28778224743 / 28777879606 / 28777465392) — the **`Setup Rust` step is still mis-indented** (6-space nested under `setup-node`'s `with:`). Never fixed. A perma-red check masks any *new* red X.
- **21 `as any` casts** now in `useAudioEngine.ts` (was 4 last week) — the type surface has been fully defeated in the audio hot path.
- **`@babel/helper-plugin-utils`** still in `package.json` (line 38) despite `.swarm-state.md` claiming it was removed — the stale-state/reality gap.

**Primary task — repair the audio-engine foundation, then install the gate that would have caught it:**
1. **Fix the parse error in `src/hooks/useAudioEngine.ts`** (start at the `esbuild` pointer L1013 `Expected ")"`; find the unbalanced `(` above in the `playSamplerVoice`/`playBufferSource` region). The file must parse and `tsc -b` clean. **This is #1 — nothing else matters until it compiles.**
2. **Strip the 21 `as any` casts** in that file once it parses; restore real typing against `src/types.ts` (add a genuinely-missing prop to `types.ts` only if one is actually absent — do not paper over with casts).
3. **Add a `tsc -b` step to `ci.yml`** (after `build:wasm`) so a non-parsing / type-broken file fails the **main** gate, not just the flaky E2E build.
4. **Flip `lint` off `continue-on-error: true`** in `ci.yml` once the file lints clean — the swallowed-error mode is what let this hide.
5. **Fix `debug_build.yml`** — correct the `Setup Rust` indentation to a sibling step (or delete the workflow if redundant with `ci.yml`); confirm it loads and goes green.
6. **Drop unused `@babel/helper-plugin-utils`** from `package.json` devDeps.
7. **Verify:** `pnpm exec tsc -b` clean (0 errors), `pnpm run build` green, all three workflows (`CI`, `Playwright E2E`, `debug_build`) green on the fix branch before merge.

**Why this over anything else:** `main` is shipping a non-compiling primary audio hook behind a green badge, and every perf PR this week rebased onto it. This is the definition of a cracked foundation. No new features until the hook parses, the `as any` band-aids are gone, and `ci.yml` actually type-checks + fails on lint errors.

## CI toolchain log
- **2026-07-13 — reconcile: last week's 2026-07-06 escalated Fix First MOSTLY EXECUTED — but the babel-dep removal re-broke install.** Verified live on `origin/main` (HEAD `9c9e850`): (a) **`ci.yml` now has a `Type-check (tsc)` step** (`pnpm exec tsc -b`) — the primary goal landed ✅; (b) **lint un-masked** — `continue-on-error: true` removed, comment now "failures here must be fixed rather than masked" ✅; (c) **`debug_build.yml` deleted** — the perma-red workflow resolved by removal (only `ci.yml` + `playwright-e2e.yml` remain) ✅; (d) **`@babel/helper-plugin-utils` removed from `package.json`** ✅; (e) `useAudioEngine.ts` present at 1048 lines, `as any` down 21→16 (partial). **NEW BREAK:** the babel removal was **not** paired with a lockfile regen → `pnpm-lock.yaml` still lists `@babel/helper-plugin-utils` (5 refs) → `pnpm install --frozen-lockfile` fails with **`ERR_PNPM_OUTDATED_LOCKFILE`** on every main run (run 29243396503 / job 86794492928, 10:38Z). All downstream steps — `build:wasm`, `tsc`, `lint`, `vitest` — **SKIPPED**. So the new gate has literally never run on main, and #909–#921 merged onto a red/unvalidated `main`. This is the 2nd lockfile-caused break (1st = 06-22); today's escalated Fix First = regen lockfile → run the live gate → fix surfaced errors → install the `--frozen-lockfile` guardrail.
- **2026-07-06 — reconcile: last week's 2026-06-29 Fix First DID NOT EXECUTE.** Only the plan commit merged (PR #819); the kimi-cli CI-hardening swarm never ran. `.swarm-state.md` is still the stale 2026-06-22 state. Consequences verified live this run: (a) `ci.yml` **still has no `tsc`** and still runs `lint` with **`continue-on-error: true`**; (b) `debug_build.yml` **still perma-red** on every main run (`Setup Rust` still mis-indented — 3/3 latest runs = failure); (c) `@babel/helper-plugin-utils` **still in `package.json`**; (d) **NEW & worse — `src/hooks/useAudioEngine.ts` no longer parses** (`esbuild`: `Expected ")" but found ";"` @ L1013), independently confirmed by Jules in PR #850. The `as any` count in that file grew 4 → **21**. Escalated Fix First; see Today's focus.
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
- [ ] **Green-CI guardrail (follow-up to today)** — add a CI step (or husky/pre-push) that runs `pnpm install --frozen-lockfile` locally so a stale lockfile fails before merge, not after. Consider a `lockfile-check` job.
- [ ] **vitest 4 migration (if pinned back today)** — if today's fix reverts vitest to 2.x, track the deliberate v4 upgrade as its own task (config/API surface, happy-dom compat).
- [in progress — 2026-07-13] **Green-CI guardrail** — the type-safety half **LANDED** (07-13 reconcile: `tsc` step added, lint un-masked, `debug_build.yml` deleted, parse error fixed). Remaining live gaps: (1) **`pnpm-lock.yaml` stale** (orphan `@babel/helper-plugin-utils`, 5 refs) → `ERR_PNPM_OUTDATED_LOCKFILE` → main red at install, new gate never runs → **today's Fix First #1**; (2) **no `--frozen-lockfile` pre-push/pre-merge guardrail** — this is the 2nd lockfile break (1st 06-22); the hook that would prevent both **still doesn't exist** → today's Fix First #3; (3) **last 16 `as any`** in `useAudioEngine.ts` not stripped; (4) the tsc/lint/vitest gate needs its **first real pass** against the un-validated #909–#921 merge spree once install is green.
- [ ] **vitest 4 / vite 6 forward migration (deferred deliberately)** — `main` is pinned to `vitest 2.1.9` / `vite ^5.4.21`. Track the v4/v6 bump as its own task (vitest-4 `Reflect.construct` mock breakage, `vite/module-runner` export, `@fast-check/vitest` peer compat — all documented in the 2026-06-22 toolchain log above).
- [ ] **Drop unused `@babel/helper-plugin-utils`** from `package.json` devDeps (grep-confirmed unused in `src/`; accidental dep from #793). Tiny; fold into today's branch or a hygiene pass.
- [ ] **Epic #773 — ReBirth RBS v1.5/2.0 song fidelity** (opened 2026-06-18 by `cursor`). 8 child issues: #774 real-fixture corpus + golden suite, #775 DEVL packed-struct parser (`rbs.h`), #776 PCF + per-pattern 303 param extraction, #777 per-track TRAK controller tables, #778 v1.5 subset support, #779 32-pattern banks beyond 8 slots, #780 RbsExporter (write `.rbs`), #781 E2E import→song-mode→automation. This is the next big theme after CI is green.
- [ ] **Repo hygiene** — 13 root `*.md` (several stale: `plan2.md`, `test_plan.md`/`test_plan2.md`, `lfo_sync_plan.md`, `grok.md`, `copilot-session-*.md`, `agent_plan.md`, `claude.md`) + **18 root one-off `.py` scripts**, most of them prior throwaway brace/TS-error patchers: `fix_braces2.py`, `fix_missing_brace.py`, `fix_ts_errors[1-5].py`, `patch_engine*.py`, `patch_exact_manual17-20.py`. **These are archaeological evidence of earlier failed attempts to hand-patch the exact `useAudioEngine.ts` parse error that is today's Fix First** — do NOT run them against the file; kimi-cli fixes it properly, these get archived. `DOCS.md` already exists (populate it as the index) + archive scripts into `tools/archive/`. **= Today's decoupled Copilot issue (B), re-scoped 07-06 (original RBS test+docs scope is already satisfied — see Done).**
- [ ] Rubberband phoneme-aware time-stretch + `ExpressiveVoiceProcessor.ts` pending per `RUBBERBAND_ENHANCEMENT_PLAN.md`.
- ~~RBS import test+docs polish~~ → **DONE (verified 2026-07-06)**, see Done. Remaining RBS work is feature-sized (Epic #773 children #778/#779/#780 — v1.5 subset, 32-pattern banks, full TRAK song-mode export), not test/docs polish.

## Done
- 2026-07-13 — **CI type-safety hardening (2026-07-06 escalated Fix First) — LANDED (with one regression).** Verified live on `origin/main`: `ci.yml` gained a **`Type-check (tsc)` step** (`pnpm exec tsc -b`); **lint un-masked** (`continue-on-error: true` removed); **`debug_build.yml` deleted** (perma-red workflow resolved by removal); **`@babel/helper-plugin-utils` dropped from `package.json`**; `useAudioEngine.ts` parse issue resolved (file present, 1048 lines) and `as any` cut 21→16. The 06-06/06-29 planning-only cycle finally converted to landed change. **Carried into today's Fix First:** (1) the babel removal left `pnpm-lock.yaml` stale → install fails → the new gate has never run (regen lockfile); (2) the gate, once live, still needs its first real pass against the merge spree; (3) last 16 `as any` not yet stripped; (4) the `--frozen-lockfile` pre-push guardrail still doesn't exist (this is the break it would prevent).
- 2026-07-06 — **RBS importer/parser test+docs — VERIFIED ALREADY COMPLETE.** Reconciled the standing "RBS import test+docs polish" backlog item against actual repo state (was drafted as the decoupled Copilot issue): the harness is mature — **14 test files** (`RbsParser.property.test.ts` fuzz + structured roundtrips via fast-check, `RbsCorpus.test.ts` 7-fixture golden corpus, `RbsImporter.snapshot.test.ts`, `.edge`/`.boundaries`/`.fidelity`, `RbsExporter.test.ts` export→import roundtrip, DEVL/PCF/TRAK/V15) — and **`docs/audio-engine/RBS_IMPORT_PIPELINE.md`** (174 lines: pipeline table, error-code table, field-mapping highlights, testing strategy, export chunk table, Playwright E2E table). Three chat models (Gemini/Grok/Kimi) independently recommended exactly this shape (synthetic byte fixtures via factory, semantic assertions over golden snapshots, fast-check crash guards + structured roundtrips, `pool: forks`) — confirming the existing harness is modern and sound. Nothing to build; Copilot slot re-pointed to repo hygiene.
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
Focus: Restore green CI on `main`. CI/Playwright/debug_build all failing since 2026-06-21 at the `pnpm install --frozen-lockfile` step — `pnpm-lock.yaml` is stale vs `package.json` (commit `2c36d10` / PR #793 bumped vitest `^2.1.3 → ^4.1.9` major + added `@babel/helper-plugin-utils` without regenerating the lockfile). Lint/Test/Build/E2E all SKIPPED → the week's feature merges (formant vocoder #793, granular jitter #791, drum-retrigger #792, spectral morph #785) are unvalidated.
Outcome: Planning run. #720 confirmed CLOSED (completed 2026-06-15) → prior Fix First resolved. New epic #773 (RBS fidelity, 8 children #774–#781) reconciled into Backlog. weekly_plan.md updated (Today's focus = green CI, Done reconcile, Backlog refresh). Dispatch: kimi-cli swarm = lockfile reconcile + run the masked gate + fix surfaced failures; decoupled Copilot issue = repo hygiene (root docs/scripts archival, no source/test-config overlap with kimi); Claude Code = whole-stack build→deploy→smoke (after lockfile fix); Jules wrap-up template. Noah notified via push (red CI). Chat-history tools (recent_chats/conversation_search) still unavailable — context from repo + GitHub MCP + plan file only.
| 2026-06-22 | ✅ green CI restored | Fix First: main CI red since 06-21 (stale pnpm-lock.yaml — vitest 2→4 bump in #793 without lockfile regen). Fix landed via conservative fork (vitest pinned 2.1.9); `ci.yml` green & stable. |
| 2026-06-29 | _(pending)_ | Fix First: main CI green but **never type-checks** (`ci.yml` has no `tsc`); merge-spree type drift slipped past it (vocoder formant `TS2339`, patched late w/ `as any`). Plus `debug_build.yml` perma-red (malformed YAML). Plan = add `tsc` gate + fix workflow + strip `as any`. Noah notified. **NOTE (07-06): this plan was never executed — only the plan commit merged.** |
| 2026-07-06 | _(pending)_ | Fix First (escalated): last week's CI-hardening swarm never ran. Verified live — `useAudioEngine.ts` **does not parse** (esbuild `Expected ")"` @ L1013, confirmed by Jules PR #850); `ci.yml` still has no `tsc` + runs `lint` `continue-on-error:true`; `debug_build.yml` still perma-red (3/3 latest = failure); `as any` in the hook 4→21; babel dep still present. Plan = fix parse error → strip `as any` → add `tsc` gate → un-mask lint → fix `debug_build.yml` → drop babel dep. Noah notified. |

| 2026-07-13 | _(pending)_ | Fix First: last week's CI-hardening **landed** (`tsc` step added, lint un-masked, `debug_build.yml` deleted, babel dep dropped from package.json, parse error fixed). But dropping the babel dep without a lockfile regen left `pnpm-lock.yaml` stale → `ERR_PNPM_OUTDATED_LOCKFILE` → main red at install → tsc/lint/vitest all SKIPPED (gate never runs). 2nd lockfile break. Plan = regen lockfile → run the live gate → fix surfaced errors + last 16 `as any` → add `--frozen-lockfile` guardrail. Noah notified. |

## Last run
Date: 2026-07-13
Mode: Fix First
Focus: Restore green `main`, then install the lockfile guardrail. Last week's 07-06 escalated Fix First MOSTLY EXECUTED (first cycle to actually land): `ci.yml` gained a `Type-check (tsc)` step, lint un-masked (`continue-on-error` removed), `debug_build.yml` deleted, `@babel/helper-plugin-utils` dropped from `package.json`, `useAudioEngine.ts` parse error fixed, `as any` cut 21→16. BUT the babel removal wasn't paired with a lockfile regen → `pnpm-lock.yaml` still carries the orphan entry (5 refs) → `pnpm install --frozen-lockfile` fails with `ERR_PNPM_OUTDATED_LOCKFILE` on every main run (run 29243396503 / job 86794492928, 10:38Z); `build:wasm`, `tsc`, `lint`, `vitest` all SKIPPED. The new gate has never run on main, and #909–#921 merged onto a red/unvalidated `main`. 2nd lockfile-caused break (1st 06-22). Primary task: (1) regen `pnpm-lock.yaml`, (2) let the live gate run + fix surfaced tsc/lint/vitest errors + strip last 16 `as any`, (3) add a `--frozen-lockfile` pre-push/pre-merge guardrail, (4) verify install + tsc + build + test + both workflows green.
Outcome: Planning run. Reconciled: 07-06 escalated Fix First → LANDED (moved to Done with the one lockfile regression carried forward). weekly_plan.md updated (Today's focus = lockfile regen + live-gate pass + guardrail; CI toolchain log reconcile; Done entry; Backlog: Green-CI guardrail → type half landed, lockfile + guardrail + 16 `as any` remain; wins table 07-13 row; Last run). Dispatch: kimi-cli swarm = regen lockfile + run the now-live gate + fix surfaced errors + strip `as any` + add `--frozen-lockfile` guardrail (scoped to `pnpm-lock.yaml`, `package.json`, `.github/workflows/`, `.husky/`, `src/hooks/useAudioEngine.ts`, `src/types.ts`); decoupled Copilot issue = repo hygiene (root `*.md` + one-off `fix*/patch*.py` archival into `tools/archive/` — zero overlap with lockfile/workflows/audio hook); Claude Code = whole-stack build→deploy→smoke (after lockfile fix). Jules wrap-up template provided. Noah notified via push. **Context gap:** chat-history tools (`recent_chats`/`conversation_search`) unavailable in this environment (4th consecutive run) — context from repo state + GitHub Actions MCP + plan file only; no visibility into Noah's in-week chat mentions.

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
