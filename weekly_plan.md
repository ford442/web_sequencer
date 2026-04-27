# web_sequencer — Weekly Plan

## Today's focus
**TTS per-bank cold-start preload + onnxruntime-web cache purge devtool** — Add a deterministic preload manifest that warms the ONNX session for each TTS bank at app init (or on a background idle tick), eliminating per-bank cold-start stutter. Pair it with a devtools action that can wipe the ONNX session cache on demand for debugging bank-switch quality regressions.
**2026-04-27 (Sun) — User Idea mode.** Picked from Ideas section: "TTS per-bank cold-start preload + onnxruntime-web cache purge devtool." Half-day scope, aligns with active TTS per-bank focus area, decoupled from holographic knob and WASM pipeline work.

## Ideas
- [done — 2026-04-27] **Verify bug-report.md staleness** — confirmed stale: `useAudioEngine.ts` is 938 lines; the try/catch at line 1393 no longer exists. `bug-report.md` can be deleted.
- [ ] **Holographic knob renderer perf audit** — profile WebGPU/R3F knob rendering with many simultaneous knobs; identify bottlenecks; optimize. Multi-day.
- [ ] Holographic knob WGSL render pass unification — single compute-driven render path so every knob shares lighting/material, kill drift between the 2D fallback and the 3D R3F path. (multi-day, per HOLOGRAPHIC_*.md)
- [in progress — 2026-04-27] TTS per-bank cold-start preload + onnxruntime-web cache purge devtool — preload manifest per bank + a devtools action to wipe the ONNX session cache when switching banks. (half-day)

## Backlog
- [ ] **Palette: SamplerPanel `<fieldset>` conversion** — Convert `BASIC` and `ENGINE` grouping `div` elements in `src/components/SamplerPanel.tsx` to accessible `<fieldset>`/`<legend className="sr-only">` structures to match `DrumMachine.tsx` and `SynthPart.tsx`.
- [ ] **PR #479 "feat(audio): Master Bus Compressor"** — open draft (Jules, Apr 26), needs review/merge or feedback.
- [ ] **PR #480 "⚡ Bolt: Optimize MainSequencer re-renders"** — open draft (Bolt, Apr 27), needs review/merge or feedback.
- [ ] **Open issue #330** Live Keyboard UI arrangement — CSS-grid piano-shape layout; Jules-labeled, still unimplemented. Plan draft in `live-kbd-plan.md`.
- [ ] **Issue #465** Docs consolidation — Phase 1 (DOCS.md root index, zero-move) is the immediate deliverable; Phase 2 (physical migration to `docs/`) deferred. Phase 1 spec fully written in the issue.
- [ ] **Hybrid Audio Engine Fallback HUD** — runtime dashboard showing which backend (WebGPU / WASM / Pyodide / Native) each subsystem resolved to, with latency + error counts. Last week's focus; not yet started. Medium scope (full day).
- [ ] **Gesture Controls** — pinch-to-zoom on sequencer timeline (from `agent_plan.md` Domain B).
- [ ] **Repo hygiene** — 30+ `*.md` files at repo root; Phase 1 resolved by issue #465 DOCS.md index.
- [ ] Rubberband phoneme-aware time-stretch + `ExpressiveVoiceProcessor.ts` pending per `RUBBERBAND_ENHANCEMENT_PLAN.md`.
- [ ] Dozens of one-off `fix*.py` / `patch*.py` / `update_*.py` scripts at repo root — candidate for archival into `tools/`.

## Done
- 2026-04-27 — PR #457 "feat: Custom Waveform LFO" confirmed merged (commit ed7a44b / PR #461).
- 2026-04-27 — PR #458 / PR #475 "Palette: aria-label + title on icon-only buttons" confirmed merged.
- 2026-04-27 — `bug-report.md` staleness confirmed: `useAudioEngine.ts` is 938 lines; referenced line 1393 does not exist. File can be deleted.
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
Date: 2026-04-27
Mode: User Idea
Focus: TTS per-bank cold-start preload + onnxruntime-web cache purge devtool
Outcome: (to be filled at end-of-day)
