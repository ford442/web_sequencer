# web_sequencer — Weekly Plan

## Today's focus
**2026-06-15 — FIX FIRST mode.** The prior sprint's lead task — **Issue #720, the oscillator fallback audit — is still OPEN and untouched.** 6 of 8 audio engines (Open303, JC303, Rust, Prophecy, Pyodide, WebGPU) silently degrade to the default JS voice. The hybrid engine fallback chain is a core focus area, so this counts as a cracked foundation: no new ideas until it's diagnosed and the highest-impact engines are restored.

**Primary task — Issue #720, per-engine fallback diagnosis & fix:**
- Use `src/utils/engineTelemetry.ts` (`logEngineFallback`, console prefix `[EngineFallback]`) + `src/components/EngineHUD.tsx` (Ctrl+Shift+E / `?hud=1`) to capture per-engine init failures from a fresh build.
- Diagnose each engine's distinct root cause (WASM fetch/timeout, worklet registration error, missing binary, `navigator.gpu` null, Pyodide CDN bootstrap) and fix the highest-impact engines first: Open303/JC303 native stack → Rust → Prophecy/WebGPU/Pyodide.
- Surface a user-visible warning when a fallback occurs, and add an init-path test per engine.

**Build precondition:** `pnpm install --frozen-lockfile && pnpm run build:wasm && pnpm run build:emcc` — without WASM/native artifacts every engine fails at import. Confirm COOP/COEP headers are served (threaded native wasm) and a user gesture resumes `AudioContext` before judging an engine "failed".

## Ideas
- [done — 2026-04-27] **Verify bug-report.md staleness** — confirmed stale; file deleted.
- [done — 2026-05-25] **Holographic knob GPU context unification** — `KnobGPUContext.ts` singleton + `MagicKnob.tsx` ported.
- [done — 2026-06-01] **Holographic knob WGSL/2D drift-kill** — `knobMaterial.ts` shared contract consumed by WGSL + Canvas2D; `knobMaterial.contract.test.ts` guards palette/geometry/bloom parity.

## Backlog
- [ ] **Issue #720** — Oscillator fallback audit (only open GitHub issue as of 2026-06-15). **= Today's focus (Fix First).**
- [ ] **Repo hygiene** — 30+ `*.md` files + dozens of one-off `fix*.py` / `patch*.py` / `update_*.py` / `replace_helpers*.py` scripts at repo root. Candidate: DOCS.md zero-move root index + archive scripts into `tools/`.
- [ ] Rubberband phoneme-aware time-stretch + `ExpressiveVoiceProcessor.ts` pending per `RUBBERBAND_ENHANCEMENT_PLAN.md`.
- [ ] RBS import test+docs polish — expand Vitest coverage for parser/importer/scheduler + document automation architecture (PRs #685/#686 merged; follow-up coverage still thin).

## Done
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

## Last run
Date: 2026-06-15
Mode: Fix First
Focus: Issue #720 — oscillator engine fallback audit (6/8 engines degrading to JS voice). Prior sprint's lead task carried over untouched.
Outcome: Planning run. Reconciled PR #760 (oscillator aria-labels) to Done. #720 still open and confirmed the only open GitHub issue → made it today's mandatory Fix First focus over any new ideas. Dispatch: kimi-cli swarm on the engine fallback chain; decoupled Copilot issue on RBS importer test coverage; Claude Code whole-stack build→deploy→smoke task; Jules wrap-up template. Chat-history tools (recent_chats/conversation_search) unavailable in this environment — context drawn from repo + plan file only.

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
