# web_sequencer — Weekly Plan

## Today's focus
**2026-06-22 — FIX FIRST mode.** `main` CI is RED and has been since 2026-06-21. Root cause: commit `2c36d10` (formant vocoder, PR #793) bumped `vitest` `^2.1.3 → ^4.1.9` (a MAJOR upgrade) and added `@babel/helper-plugin-utils ^7.29.7` in `package.json` **without regenerating `pnpm-lock.yaml`** (lockfile still resolves vitest 2.1.9). `pnpm install --frozen-lockfile` fails on the first CI step, so **Lint, Test, Build WASM, and Playwright E2E are all SKIPPED** across CI / Playwright E2E / debug_build. The week's entire feature merge spree (formant vocoder #793, granular position jitter #791, drum-retrigger optimization #792, spectral morph automation #785, accessibility batch) has landed on a main that cannot even install deps in CI — **none of it is validated.** Cracked foundation; no new ideas until CI is green.

**Primary task — restore green CI on `main`:**
1. Reconcile `pnpm-lock.yaml` with `package.json` (regenerate via `pnpm install`).
2. Decision fork on the vitest major bump: prefer **regenerate → run full suite on vitest 4**; if v4 breaks too much config/API, **pin vitest back to `^2.1.3`** as the unblock and file a follow-up for the v4 migration. Decide whether `@babel/helper-plugin-utils` is a real direct dep or accidental — drop it if unused.
3. With install fixed, run the gate that's been masked for days — `pnpm run lint`, `pnpm test`, `pnpm run build` (incl. `build:wasm` / `build:emcc`), Playwright E2E — and fix whatever the merge spree actually broke underneath.
4. Confirm CI green on `main` (or on the fix branch before merge).

**Why this over anything else:** every other audit signal is clean (#720 closed, knob work shipped). The only cracked thing is the build gate, and it's invalidating a week of merged work silently.

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
- [ ] **Green-CI guardrail (follow-up to today)** — add a CI step (or husky/pre-push) that runs `pnpm install --frozen-lockfile` locally so a stale lockfile fails before merge, not after. Consider a `lockfile-check` job.
- [ ] **vitest 4 migration (if pinned back today)** — if today's fix reverts vitest to 2.x, track the deliberate v4 upgrade as its own task (config/API surface, happy-dom compat).
- [ ] **Epic #773 — ReBirth RBS v1.5/2.0 song fidelity** (opened 2026-06-18 by `cursor`). 8 child issues: #774 real-fixture corpus + golden suite, #775 DEVL packed-struct parser (`rbs.h`), #776 PCF + per-pattern 303 param extraction, #777 per-track TRAK controller tables, #778 v1.5 subset support, #779 32-pattern banks beyond 8 slots, #780 RbsExporter (write `.rbs`), #781 E2E import→song-mode→automation. This is the next big theme after CI is green.
- [ ] **Repo hygiene** — 13 root `*.md` files + 9+ one-off `fix*.py` / `patch*.py` / `update_*.py` / `replace_helpers*.py` scripts at repo root. Candidate: `DOCS.md` index + archive scripts into `tools/`. **= Today's decoupled Copilot issue (B).**
- [ ] Rubberband phoneme-aware time-stretch + `ExpressiveVoiceProcessor.ts` pending per `RUBBERBAND_ENHANCEMENT_PLAN.md`.
- [ ] RBS import test+docs polish — expand Vitest coverage for parser/importer/scheduler + document automation architecture (now subsumed/expanded by epic #773).

## Done
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
| 2026-06-22 | _(pending)_ | Fix First: main CI red since 06-21 (stale pnpm-lock.yaml — vitest 2→4 bump in #793 without lockfile regen). Plan set to restore green CI; Noah notified. |

## Last run
Date: 2026-06-22
Mode: Fix First
Focus: Restore green CI on `main`. CI/Playwright/debug_build all failing since 2026-06-21 at the `pnpm install --frozen-lockfile` step — `pnpm-lock.yaml` is stale vs `package.json` (commit `2c36d10` / PR #793 bumped vitest `^2.1.3 → ^4.1.9` major + added `@babel/helper-plugin-utils` without regenerating the lockfile). Lint/Test/Build/E2E all SKIPPED → the week's feature merges (formant vocoder #793, granular jitter #791, drum-retrigger #792, spectral morph #785) are unvalidated.
Outcome: Planning run. #720 confirmed CLOSED (completed 2026-06-15) → prior Fix First resolved. New epic #773 (RBS fidelity, 8 children #774–#781) reconciled into Backlog. weekly_plan.md updated (Today's focus = green CI, Done reconcile, Backlog refresh). Dispatch: kimi-cli swarm = lockfile reconcile + run the masked gate + fix surfaced failures; decoupled Copilot issue = repo hygiene (root docs/scripts archival, no source/test-config overlap with kimi); Claude Code = whole-stack build→deploy→smoke (after lockfile fix); Jules wrap-up template. Noah notified via push (red CI). Chat-history tools (recent_chats/conversation_search) still unavailable — context from repo + GitHub MCP + plan file only.

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
