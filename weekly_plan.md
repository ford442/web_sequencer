# web_sequencer — Weekly Plan

## Today's focus
**2026-06-01 (Mon) — User Idea mode.** Finish the holographic-knob drift-kill: last week's *plumbing* landed (HardwareModule routes through `KnobGPUContext` singleton, per-knob canvas, ResizeObserver, 2D palette contract — all on `main`, build passing), but the idea's core goal is still open. The two render paths still hardcode **independent palettes** and provably drift:
- WGSL (`KnobGPUContext.ts`): base `vec3f(0,0.9,1.0)`, arc `mix(vec3(0,0.6,0.5) → vec3(0.2,1.0,0.8))`, ×1.5 bloom, transparent bg.
- 2D (`HardwareModule.renderWith2D`): ring `#00e5ff`, arc `#00e5ff → #00897b`, solid `#0d0f13` bg, no bloom — comment admits it "approximates" the WGSL look.

**Task:** extract a single `knobMaterial` source-of-truth module (palette stops, ring/arc geometry, 270° sweep angles, bloom factor, background) consumed by **both** the WGSL uniform packing in `KnobGPUContext` *and* `renderWith2D`, so the two paths derive from identical constants and cannot drift. Verify `MagicKnob` (already singleton-ported) inherits the same contract.

## Ideas
- [done — 2026-04-27] **Verify bug-report.md staleness** — confirmed stale: `useAudioEngine.ts` is 938 lines; the try/catch at line 1393 no longer exists. `bug-report.md` can be deleted.
- [done — 2026-05-25] **Holographic knob GPU context unification** — `KnobGPUContext.ts` singleton fully implemented (shared `GPURenderPipeline`, single batched RAF, per-knob `uniformBuffer`+`bindGroup`, `register`/`unregister` API); `MagicKnob.tsx` fully ported. N-device anti-pattern retired.
- [in progress — 2026-06-01] Holographic knob WGSL render pass unification — single compute-driven render path so every knob shares lighting/material, kill drift between the 2D fallback and the WebGPU canvas path. (multi-day; depends on perf audit findings)
  - Plumbing/singleton routing landed 2026-05-25 (see Done). Remaining = shared `knobMaterial` constants module so WGSL + 2D fallback can't visually drift. This is today's focus.

## Backlog
- [ ] **Duplicate Copilot PRs #685 & #686** — both "[WIP] Map Rebirth .rbs data to Hyphon internal models" (open drafts, May 30). Close one to avoid divergence; #685 has the better task checklist.
- [ ] **PR #693** "feat(tts): add consonantEmphasis control" — open Jules draft (May 31), needs review/merge or feedback.
- [ ] **GitHub reports 0 OPEN issues** (API, 2026-06-01) — prior backlog refs #330 (live-keyboard CSS grid), #465 (DOCS.md index), #672 (RBS test+docs) appear closed/resolved or were never filed as issues. VERIFY before re-actioning; #672 is cited as a "parser" issue by PRs #685/#686 so likely closed-on-merge.
- [ ] **Repo hygiene** — 30+ `*.md` files + dozens of one-off `fix*.py` / `patch*.py` / `update_*.py` scripts at repo root. Candidate: DOCS.md zero-move root index + archive scripts into `tools/`.
- [ ] Rubberband phoneme-aware time-stretch + `ExpressiveVoiceProcessor.ts` pending per `RUBBERBAND_ENHANCEMENT_PLAN.md`.
- [ ] RBS import test+docs polish (was issue #672) — expand Vitest coverage for parser/importer/scheduler + document automation architecture. Partly in flight via Copilot PRs #685/#686.

## Done
- 2026-06-01 — Holographic knob render-pass PLUMBING landed on `main`: `HardwareModule.tsx` routes all knobs through `KnobGPUContext` singleton (per-knob `<canvas>`, `register`/`unregister`, ResizeObserver sizing, ~320 lines of per-component WebGPU init removed), `renderWith2D` extracted as standalone fn with a contracted palette. Build passes. NOTE: visual-drift kill (shared material contract) is NOT done — carried into today's focus.
- 2026-06-01 — Backlog reconcile: PRs #506 & #507 confirmed CLOSED-unmerged (2026-05-15), removed from backlog. GitHub reports 0 open issues — #330/#465/#672 flagged for verification.
- 2026-05-25 — Holographic knob GPU context unification: `KnobGPUContext.ts` singleton + `MagicKnob.tsx` fully ported (PR #617 context: WASM memory fix also landed).
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
Date: 2026-06-01
Mode: User Idea
Focus: Finish holographic-knob drift-kill — extract a shared `knobMaterial` constants module (palette/geometry/bloom/bg) consumed by BOTH the WGSL uniform packing in KnobGPUContext AND HardwareModule.renderWith2D, so the WebGPU and 2D-fallback paths derive from identical constants and cannot drift.
Outcome: (to be filled at end-of-day)
Prior-run note: 2026-05-25 plumbing/singleton routing landed on main (build passing), but the visual-drift goal was left open — verified 2026-06-01 by diffing WGSL vs renderWith2D palettes (independently hardcoded). Hence continued, not new.
