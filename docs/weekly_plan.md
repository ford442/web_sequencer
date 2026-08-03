# web_sequencer — Weekly Plan

## Today's focus
**Fix First — stabilize the CI/test foundation before new feature work.**
Restore green Playwright E2E on `main` (#1036: WebKit launch flags + flaky `StartOverlay` gesture/autoplay race + missing `webServer` block in `playwright.config.ts`) and purge the 5 committed `.orig` merge artifacts polluting `src/` (#1039). No new features land on a red E2E matrix or a repo carrying merge scars.

Secondary (decoupled, for Copilot lane): master true-peak (ISP) limiter + LUFS/peak metering suite on the audio-graph output — touches `src/audio/graph/` + a new meter worklet, zero overlap with the test-fixture files kimi-cli will touch.

## Ideas
<!--
User-written ideas go here during the week. Routine prioritizes these over generated ideas.
Format: - [ ] Short description
This section was EMPTY at first run (no prior weekly_plan.md existed). The two unpicked
generated ideas below are seeded so future runs inherit them.
-->
- [ ] Master true-peak (ISP) limiter + LUFS/short-term/momentary metering suite on the master bus (`src/audio/graph/`) — generated 2026-08-03, decoupled Copilot lane today
- [ ] `OscillatorBackend` interface + deterministic non-silent fallback so WebGPU→WASM→Pyodide→Native never yields silence on a failed tier (#1035) — generated 2026-08-03
- [ ] AudioContext `latencyHint` + `sampleRate` negotiation policy (#1033) — generated 2026-08-03

## Backlog
<!-- Unfinished items, known bugs, deferred work. Reconciled from open GitHub issues + repo state. -->
- [ ] #1036 ci(e2e): restore green Playwright on main (WebKit flags + flaky StartOverlay) — **PROMOTED TO TODAY'S FOCUS**
- [ ] #1039 chore(repo): purge `.orig` merge artifacts + complete mega-module splits — **PARTIALLY IN TODAY'S FOCUS** (the `.orig` purge; mega-module splits deferred)
- [ ] #1038 epic(graph): visual modular patch bay for sends, returns, and engine routing
- [ ] #1037 feat(audio): master true-peak limiter + LUFS/peak metering suite (overlaps today's Copilot lane)
- [ ] #1035 foundation(engine): OscillatorBackend interface + deterministic non-silent fallback
- [ ] #1034 foundation(wasm): audit emcc INITIAL_MEMORY=512mb, pthread pool, AS wasm-gc flags
- [ ] #1033 foundation(audio): AudioContext latencyHint + sampleRate negotiation policy
- [ ] #1032 refactor: split `src/hooks/useAudioEngine.ts` into modules <700 lines
- [ ] #1031 refactor: split `src/hooks/audioEngine/audioPlayback.ts` into modules <700 lines
- [ ] #1030 refactor: split `src/components/__tests__/knobMaterial.contract.test.ts` into modules <700 lines
- [ ] Follow-ups from Unreleased CHANGELOG: #632 (per-voice 303 engine selection UI), #633 (Prophecy controls discoverability), #634 (engine/help visibility)

## Done
<!-- Completed items, archived with date. -->
- [x] CI unit gate restored green — 5/5 steps (install / build:wasm / tsc / lint / test = 1280 tests) — completed 2026-07-20 (per `.swarm-state.md`); pre-push husky guard added. NOTE: this covered the **unit/lint** gate, not the E2E/Playwright matrix, which remains red (see #1036).

## Last run
Date: 2026-08-03 (first run — no prior weekly_plan.md existed)
Mode: Fix First
Focus: Restore green Playwright E2E (#1036) + purge `.orig` merge artifacts (#1039)
Outcome: Plan generated. Dispatch produced for kimi-cli (E2E fix), Copilot issue (master limiter/LUFS lane), 3 chat-model expansions, Claude Code whole-stack pipeline exercise, Jules wrap-up template, and 2 Gemini review prompts. weekly_plan.md created and committed.
