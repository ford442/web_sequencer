# web_sequencer — Weekly Plan

## Today's focus
**Hybrid audio engine fallback resilience** — Add structured logging, a health-state model, and tests for the `WebGPU → WASM → Pyodide → Native` cascade in `useAudioEngine` so silent engine degradations become visible and recoverable. Scope: full-day.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] **Verify bug-report.md staleness** — confirm `useAudioEngine.ts:1393` try/catch compiles; delete the report if stale or patch if real. Half-day.
- [ ] **Holographic knob renderer perf audit** — profile WebGPU knob rendering with many simultaneous knobs; identify bottlenecks; optimize. Multi-day.

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] **Open PR #457** Custom Waveform LFO (Jules) — needs review/merge or rejection
- [ ] **Open PR #458** aria-label/title on icon buttons (Jules) — needs review/merge
- [ ] **Open issue #330** Live Keyboard UI arrangement — CSS-grid piano-shape layout; Jules-labeled, still unimplemented
- [ ] **Gesture Controls** — pinch-to-zoom on sequencer timeline (from `agent_plan.md` Domain B)
- [ ] **Repo hygiene** — 30+ `*.md` files at repo root need consolidation into `docs/`
- [ ] **Stale bug-report.md** — tracked syntax error in `useAudioEngine.ts`; likely already resolved but unverified

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- 2026-04-20 — Accessible ARIA switches replace native checkboxes (PR #456 merged)
- 2026-04-19 — Custom Sample Slicing UI with keyboard nav (PR #455 merged)
- 2026-04-19 — Fix orphaned `aria-describedby` refs in modals (PR #454 merged)
- 2026-04-18 — AI auto-mix assistant feature (PR #453 merged)
- 2026-04-17 — Keyboard accessibility for custom radio groups (PR #452 merged)
- 2026-04-16 — Step-sequenced formant shifts (PR #451 merged)
- 2026-04-15 — Global convolution reverb effect (PR prior)
- 2026-04-13 — Auto-slice by transients in SamplerPanel (PR #444 merged)
- Semantic radio group conversion in `CloudLibrary.tsx` (`<fieldset>`/`<legend>` wrapping; previous weekly_plan note)

## Last run
<!-- Routine writes summary here each run. Overwrites previous. -->
Date: 2026-04-20
Mode: New Idea
Focus: Hybrid audio engine fallback resilience — instrument and test the WebGPU → WASM → Pyodide → Native cascade.
Outcome: Pending (routine authored; kimi-cli swarm will execute).
