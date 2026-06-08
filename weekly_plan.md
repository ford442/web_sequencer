# web_sequencer — Weekly Plan

## Today's focus
**2026-06-08 (Mon) — Fix First mode.** Diagnose and repair the hybrid audio engine fallback chain (a core active focus area). Issue **#720** (filed by Noah 2026-06-05) reports that **6 of 8 oscillator engines silently fall back to the default JS voice**: Open303, JC303, Rust, Prophecy, Pyodide, and WebGPU all fail to initialize. Only JS (Native) and PCM 303 work. This is a cracked foundation — building new features on top of a degraded engine stack is wasted effort, so the fix outranks any new idea.

**Task:** Work through #720 engine-by-engine. For each failing engine determine the root cause (WASM load/instantiation failure, AudioWorklet registration error, missing/renamed binary asset, Pyodide bootstrap failure, WebGPU device/adapter unavailability) using the existing `engineTelemetry` + EngineHUD instrumentation. Make each fallback **loud** (console warn/error with the real reason) instead of silent, then fix the initialization path. Expand engine-init test coverage. Last week's knob drift-kill landed clean (see Done) — it is NOT the blocker.

## Ideas
- [done — 2026-04-27] **Verify bug-report.md staleness** — confirmed stale: `useAudioEngine.ts` is 938 lines; the try/catch at line 1393 no longer exists. `bug-report.md` can be deleted.
- [done — 2026-05-25] **Holographic knob GPU context unification** — `KnobGPUContext.ts` singleton fully implemented (shared `GPURenderPipeline`, single batched RAF, per-knob `uniformBuffer`+`bindGroup`, `register`/`unregister` API); `MagicKnob.tsx` fully ported. N-device anti-pattern retired.
- [done — 2026-06-08] Holographic knob WGSL render pass unification — single shared-material render path; drift between 2D fallback and WebGPU canvas killed via `knobMaterial.ts` source-of-truth module. Both paths now derive palette/geometry/bloom/sweep from `KNOB_MATERIAL` (KnobGPUContext bakes it into WGSL via string interpolation; HardwareModule.renderWith2D reads it directly). `MagicKnob` inherits the contract through `KnobGPUContext.register()`. Build + all tests pass.

<!-- Ideas list is currently exhausted — all items Done. Add new ideas here during the week. -->
- [ ]

## Backlog
- [ ] **Issue #720 — Oscillator fallback audit (CRITICAL, today's focus).** 6/8 engines (Open303, JC303, Rust, Prophecy, Pyodide, WebGPU) silently fall back to JS voice. See Today's focus.
- [ ] **Overlapping Spectral/Time-Stretch UI PRs #717 & #724** — both add `timeStretchEnvDepth` / `spectralPan*` controls to `NoteSelector.tsx` (#717 also touches SamplerPanel). #717 (2026-06-04, non-draft) vs #724 (2026-06-06, draft). Divergence risk — pick one, close the other. #717 is broader (global + per-step); #724 is per-step group only.
- [ ] **PR #693** "feat(tts): add consonantEmphasis control" — open Jules draft (May 31, updated 2026-06-06), still needs review/merge or feedback.
- [ ] **Old #685/#686 (.rbs mapping dupes)** — no longer in open-PR list as of 2026-06-08; treat as closed/merged. Removed from active watch.
- [ ] **Repo hygiene** — 30+ `*.md` files + dozens of one-off `fix*.py` / `patch*.py` / `update_*.py` scripts at repo root. Candidate: DOCS.md zero-move root index + archive scripts into `tools/`.
- [ ] Rubberband phoneme-aware time-stretch + `ExpressiveVoiceProcessor.ts` pending per `RUBBERBAND_ENHANCEMENT_PLAN.md`.
- [ ] RBS import test+docs polish (was issue #672) — expand Vitest coverage for parser/importer/scheduler + document automation architecture. Partly in flight via Copilot PRs #685/#686.

## Done
- 2026-06-08 — **Holographic knob drift-kill COMPLETE.** `src/components/knobMaterial.ts` created as single source of truth (`KNOB_MATERIAL`: palette stops, ring/arc/needle geometry as body-radius fractions, −3π/4 sweep start, 3π/2 total, ×1.5 bloom + `rgbToHex`/`rgbToWgsl`/`wgslAngleToCanvas` helpers). `KnobGPUContext.ts` bakes it into the WGSL shader via template-string interpolation (uniform buffer stays 32 bytes, no pipeline recreation); `HardwareModule.renderWith2D()` reads every draw param from it and the start-angle bug (`-0.75π` → correct WGSL→canvas conversion) was fixed so 2D and WebGPU sweeps now match exactly. `MagicKnob` inherits via `KnobGPUContext.register()`. No stray color literals remain in either render path. `tsc -b` + `vite build` + `npm test` (925 passing, 1 skipped) all green. (kimi-cli, see `.swarm-state.md` Iteration 3.)
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
Date: 2026-06-08
Mode: Fix First
Focus: Diagnose + repair hybrid audio engine fallback chain (issue #720 — 6/8 oscillator engines silently fall back to JS voice). Make fallbacks loud, fix each init path, expand engine-init test coverage.
Outcome: (to be filled at end-of-day)
Prior-run note: 2026-06-01 knob drift-kill landed clean and verified (knobMaterial.ts on main, build + 925 tests green — see Done). That foundation is solid; today pivots to the engine stack because #720 (filed 2026-06-05) reports the audio fallback chain is broken — that outranks new feature work.
Decoupled track (Copilot/Jules): issue B = Playwright visual-regression harness for the holographic knob to lock in the just-landed drift-kill. Touches test infra + knob testids only — no overlap with kimi-cli's audio-engine files.
