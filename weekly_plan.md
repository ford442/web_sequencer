# web_sequencer — Weekly Plan

## Today's focus
**2026-05-18 (Sun) — User Idea mode.** Continuing `[in progress — 2026-05-11]`: Holographic knob GPU context unification — `KnobGPUContext.ts` singleton was not created last week; `MagicKnob.tsx` still runs per-instance `GPUDevice` + per-instance RAF. Full implementation this week: singleton with shared `GPURenderPipeline` and one RAF loop, per-knob uniform buffer slot + bind group, register/unregister API, retire the N-device anti-pattern.

## Ideas
- [done — 2026-04-27] **Verify bug-report.md staleness** — confirmed stale: `useAudioEngine.ts` is 938 lines; the try/catch at line 1393 no longer exists. `bug-report.md` can be deleted.
- [in progress — 2026-05-11] **Holographic knob GPU context unification** — audit findings confirmed (per-instance GPUDevice + RAF); implementing `KnobGPUContext.ts` singleton with shared pipeline and batched draw loop. Multi-day.
- [ ] Holographic knob WGSL render pass unification — single compute-driven render path so every knob shares lighting/material, kill drift between the 2D fallback and the WebGPU canvas path. (multi-day; depends on perf audit findings)

## Backlog
- [ ] **PR #506** "Fix: Resolve TypeScript errors related to Note interface" — open (Jules, May 3), needs review/merge or feedback.
- [ ] **PR #507** "Palette: Fix orphaned aria-describedby in GamepadDebugger" — open (Jules, May 3), needs review/merge or feedback.
- [ ] **Open issue #330** Live Keyboard UI arrangement — CSS-grid piano-shape layout; Jules-labeled, still unimplemented. Plan draft referenced but `live-kbd-plan.md` not found at root — verify.
- [ ] **Issue #465** Docs consolidation — Phase 1 (DOCS.md root index, zero-move) is the immediate deliverable; Phase 2 (physical migration to `docs/`) deferred. Phase 1 spec fully written in the issue.
- [ ] **Repo hygiene** — 30+ `*.md` files at repo root; Phase 1 resolved by issue #465 DOCS.md index.
- [ ] Rubberband phoneme-aware time-stretch + `ExpressiveVoiceProcessor.ts` pending per `RUBBERBAND_ENHANCEMENT_PLAN.md`.
- [ ] Dozens of one-off `fix*.py` / `patch*.py` / `update_*.py` scripts at repo root — candidate for archival into `tools/`.

## Done
- 2026-05-18 — jc303/Open303 WASM pipeline stabilized: stub-WASM early detection, `Open303Manager` params wiring, WASM promoted to Vite content-hashed asset (PRs #569 + #572, Claude Code).
- 2026-05-18 — Live keyboard triggers drum voices with MIDI note pitch shifting (PR #571, Copilot).
- 2026-05-18 — Vocal Harmony Parallel Bus: dedicated parallel bus + glue compression + EQ for harmony voices; `isHarmonyVoice` routing out of main lead saturation path (PR #568, Jules).
- 2026-05-18 — Palette: decorative UI elements hidden from screen readers (PR #567).
- 2026-05-11 — Gesture Controls: pinch-to-zoom + scroll-wheel zoom on sequencer timeline (PR #513, Copilot).
- 2026-05-11 — BottomBar Accessibility Enhancements (PR #511, Jules).
- 2026-05-04 — TTS per-bank cold-start preload + onnxruntime-web cache purge devtool: `useTTSPreloader.ts` hook (idle-scheduled), `SupertonicService.purgeCache()` + `window.__devtools.purgeTTSCache()` devtools action, full test coverage landed (Jules, commit 52117f0, Apr 28).
- 2026-05-04 — SamplerPanel `<fieldset>` conversion: BASIC and ENGINE grouping divs converted to `<fieldset>`/`<legend className="sr-only">` (PR #483 merged, followed by Palette a11y passes PR #486/487).
- 2026-05-04 — PR #479 "feat(audio): Master Bus Compressor" — merged.
- 2026-05-04 — PR #480 "⚡ Bolt: Optimize MainSequencer re-renders" — merged.
- 2026-05-04 — Hybrid Audio Engine Fallback HUD: `EngineHUD.tsx` DOM overlay + `engineTelemetry` instrumentation for WebGPU/WASM/JS/WAV/Open303 backends with p50/p95 latency and error counts; Ctrl+Shift+E toggle + `?hud=1` URL param (commits d90609f + 4300794).
- 2026-04-27 — PR #457 "feat: Custom Waveform LFO" confirmed merged (commit ed7a44b / PR #461).
- 2026-04-27 — PR #458 / PR #475 "Palette: aria-label + title on icon-only buttons" confirmed merged.
- 2026-04-27 — `bug-report.md` staleness confirmed: `useAudioEngine.ts` is 938 lines; referenced line 1393 does not exist. File deleted.
- 2026-04-27 — SamplerPanel `useMemo` syntax error (`(174,6)`) confirmed resolved in current code; tsc passes cleanly.
- 2026-04-27 — PR #476 Step-Sequenced Reverb Types — type errors fixed and merged.
- 2026-04-27 — PR #477 AdvancedNoteSelector Escape key support merged.
- 2026-04-27 — PR #478 DrumMachine + SynthPart memoization optimization merged.
- 2026-04-20 — Accessible ARIA switches replace native checkboxes (PR #456 merged).
- 2026-04-19 — Custom Sample Slicing UI with keyboard nav (PR #455 merged).
- 2026-04-19 — Fix orphaned `aria-describedby` refs in modals (PR #454 merged).
- 2026-04-18 — AI auto-mix assistant feature (PR #453 merged).
- 2026-04-17 — Keyboard accessibility for custom radio groups (PR #452 merged).
- 2026-04-16 — Step-sequenced formant shifts (PR #451 merged).
- 2026-04-15 — Global convolution reverb effect.
- 2026-04-14 — Palette: tabpanel roles on tabbed interfaces (PR #450).
- 2026-04-13 — Auto-slice by transients in SamplerPanel (PR #444 merged).
- 2026-04-13 — aria-busy on processing buttons (PR #445).
- 2026-04-12 — AdvancedNoteSelector + ScaleSelector (PR #443).

## Last run
Date: 2026-05-18
Mode: User Idea (continuing)
Focus: Holographic knob GPU context unification — KnobGPUContext.ts singleton + MagicKnob.tsx refactor
Outcome: (to be filled at end-of-day)
