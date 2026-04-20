# web_sequencer — Weekly Plan

## Today's focus
**2026-04-20 (Mon) — New Idea mode.** Build a **Hybrid Audio Engine Fallback HUD**: a runtime diagnostic surface that exposes which backend (WebGPU / WASM / Pyodide / Native) each subsystem actually resolved to, with per-engine latency and error counts. Highest leverage because every future WASM/WebGPU/Pyodide task gets easier to debug once the fallback chain is visible.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] Holographic knob WGSL render pass unification — single compute-driven render path so every knob shares lighting/material, kill drift between the 2D fallback and the 3D R3F path. (multi-day, per HOLOGRAPHIC_*.md)
- [ ] TTS per-bank cold-start preload + onnxruntime-web cache purge devtool — preload manifest per bank + a devtools action to wipe the ONNX session cache when switching banks. (half-day)

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] PR #457 "feat: Custom Waveform LFO" — open, needs review / merge or feedback.
- [ ] PR #458 "Palette: aria-label + title on icon-only buttons" — open, needs review / merge.
- [ ] Issue #330 "Live Keyboard UI arrangement" — piano layout with gapped accidentals row; plan draft already in `live-kbd-plan.md`.
- [ ] Repo hygiene flagged in `work_jan26.md`: missing CHANGELOG, LICENSE, CONTRIBUTING, Prettier config, PWA manifest/SW, coverage reports.
- [ ] Rubberband phoneme-aware time-stretch + ExpressiveVoiceProcessor.ts still pending per `RUBBERBAND_ENHANCEMENT_PLAN.md`.
- [ ] Stale `bug-report.md` at repo root references `useAudioEngine.ts:1393` but that file is now only 867 lines — delete or mark resolved.
- [ ] Dozens of one-off `fix*.py` / `patch*.py` / `update_*.py` scripts polluting repo root — candidate for archival into `tools/`.

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] 2026-04-19 — Replace native checkboxes with accessible ARIA switches (PR #456).
- [x] 2026-04-19 — Custom Sample Slicing UI with keyboard nav (PR #455).
- [x] 2026-04-18 — Palette: fix orphaned aria-describedby references in modals (PR #454).
- [x] 2026-04-18 — AI auto-mix assistant (PR #453).
- [x] 2026-04-17 — Palette: keyboard accessibility for custom radio groups (PR #452).
- [x] 2026-04-16 — Step-sequenced formant shifts (PR #451).
- [x] 2026-04-15 — Palette: tabpanel roles on tabbed interfaces (PR #450).
- [x] 2026-04-14 — Global convolution reverb effect.
- [x] 2026-04-14 — Palette: aria-labels pass across components.
- [x] 2026-04-13 — aria-busy on processing buttons (PR #445).
- [x] 2026-04-13 — Auto-slice by transients in SamplerPanel (PR #444).
- [x] 2026-04-12 — AdvancedNoteSelector + ScaleSelector (PR #443).

## Last run
<!-- Routine writes summary here each run. Overwrites previous. -->
Date: 2026-04-20
Mode: New Idea (no prior structured `weekly_plan.md`; Ideas section was empty; shipped week with no Fix First signal — stale `bug-report.md` confirmed obsolete against current code)
Focus: Hybrid Audio Engine Fallback HUD — runtime dashboard showing which backend each subsystem resolved to, with latency + error counts
Outcome: (to be filled at end-of-day)
