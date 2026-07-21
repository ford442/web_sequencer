# Documentation index

Single entry point for all **live** Hyphon / web_sequencer documentation. Stale planning scratch and dead one-off patch scripts live under [docs/archive/](docs/archive/) and [tools/archive/](tools/archive/) respectively.

---

## Start here

| Audience | Read first |
|----------|------------|
| New contributors | [README.md](README.md) → [AGENTS.md](AGENTS.md) |
| AI agents (Claude, Copilot, Jules) | [AGENTS.md](AGENTS.md) → [claude.md](claude.md) |
| Architecture deep-dive | [docs/DEVELOPER_CONTEXT.md](docs/DEVELOPER_CONTEXT.md) |
| Subsystem docs by topic | [docs/README.md](docs/README.md) (mirrors tables below) |

---

## Root documents (active)

| File | Description |
|------|-------------|
| [README.md](README.md) | Project overview, features, quick-start, TTS model setup |
| [AGENTS.md](AGENTS.md) | Agent guide: architecture, Four Worlds build rule, commands, pitfalls |
| [CHANGELOG.md](CHANGELOG.md) | Release and feature changelog |
| [claude.md](claude.md) | Claude-specific dev guide: stack, structure, debugging |
| [agent_plan.md](agent_plan.md) | Living roadmap and prioritized feature backlog |
| [weekly_plan.md](weekly_plan.md) | Current weekly focus, ideas, and completed tasks |
| [DOCS.md](DOCS.md) | This index |

---

## `docs/` — general

| File | Description |
|------|-------------|
| [docs/README.md](docs/README.md) | Subsystem doc index (duplicate navigation aid) |
| [docs/DEVELOPER_CONTEXT.md](docs/DEVELOPER_CONTEXT.md) | Onboarding context and architecture overview |
| [docs/features-implementation.md](docs/features-implementation.md) | Feature implementation tracking notes |
| [docs/plan.md](docs/plan.md) | High-level project planning notes |
| [docs/automation.md](docs/automation.md) | Automation scheduler + RBS import architecture |

---

## `docs/audio-engine/`

| File | Description |
|------|-------------|
| [HARMONIZER_IMPLEMENTATION.md](docs/audio-engine/HARMONIZER_IMPLEMENTATION.md) | Vocal harmonizer engine design |
| [JC303_STACK_OVERFLOW_FIX.md](docs/audio-engine/JC303_STACK_OVERFLOW_FIX.md) | JC-303 WASM stack overflow fix |
| [303-voices.md](docs/audio-engine/303-voices.md) | Selectable TB-303 voice catalog, WASM registry, migration, and tests |
| [jc303-prophecy.md](docs/audio-engine/jc303-prophecy.md) | Open303/JC303 switching and Prophecy routing |
| [jc303-fix-plan.md](docs/audio-engine/jc303-fix-plan.md) | JC-303 WASM fix plan |
| [jc303-technical-analysis.md](docs/audio-engine/jc303-technical-analysis.md) | JC-303 build/stack technical analysis |
| [PLAYBACK_STABILITY.md](docs/audio-engine/PLAYBACK_STABILITY.md) | Song-mode playback jitter thresholds and stress tests |
| [MULTISAMPLE_GENERATOR_DESIGN.md](docs/audio-engine/MULTISAMPLE_GENERATOR_DESIGN.md) | Multisample generator design |
| [MULTISAMPLE_IMPLEMENTATION_SUMMARY.md](docs/audio-engine/MULTISAMPLE_IMPLEMENTATION_SUMMARY.md) | Multisample implementation summary |
| [OPEN303_FALLBACK_MODES.md](docs/audio-engine/OPEN303_FALLBACK_MODES.md) | Open303 fallback synthesis modes |
| [OPEN303_STACK_OVERFLOW_FIX.md](docs/audio-engine/OPEN303_STACK_OVERFLOW_FIX.md) | Open303 C++ stack overflow fix |
| [OPENMP_IMPLEMENTATION.md](docs/audio-engine/OPENMP_IMPLEMENTATION.md) | OpenMP threading for Emscripten |
| [OPENMP_RUBBERBAND_PATCHES.md](docs/audio-engine/OPENMP_RUBBERBAND_PATCHES.md) | Rubberband OpenMP patches |
| [RBS_IMPORT_PIPELINE.md](docs/audio-engine/RBS_IMPORT_PIPELINE.md) | RBS import pipeline documentation |
| [RUBBERBAND_ANALYSIS.md](docs/audio-engine/RUBBERBAND_ANALYSIS.md) | Rubberband library integration analysis |
| [RUBBERBAND_DESIGN.md](docs/audio-engine/RUBBERBAND_DESIGN.md) | Rubberband architectural design |
| [RUBBERBAND_ENHANCEMENT_PLAN.md](docs/audio-engine/RUBBERBAND_ENHANCEMENT_PLAN.md) | Rubberband enhancement plan (sections 1–10) |
| [RUBBERBAND_INTEGRATION_GUIDE.md](docs/audio-engine/RUBBERBAND_INTEGRATION_GUIDE.md) | Rubberband user/integration guide |
| [SUSTAIN_PROCESSOR_RUBBERBAND_GUIDE.md](docs/audio-engine/SUSTAIN_PROCESSOR_RUBBERBAND_GUIDE.md) | Sustain-processor + Rubberband worklet guide |

---

## `docs/ui/`

| File | Description |
|------|-------------|
| [VISUAL_STYLE_GUIDE.md](docs/ui/VISUAL_STYLE_GUIDE.md) | Design tokens, bevels, LEDs, typography |
| [HELP_DISCOVERY.md](docs/ui/HELP_DISCOVERY.md) | In-app help, tooltips, what's-new banner |
| [MOBILE_UX.md](docs/ui/MOBILE_UX.md) | Mobile layout and touch UX notes |
| [HOLOGRAPHIC_KNOBS.md](docs/ui/HOLOGRAPHIC_KNOBS.md) | Holographic 3D knob implementation |
| [HOLOGRAPHIC_USER_GUIDE.md](docs/ui/HOLOGRAPHIC_USER_GUIDE.md) | User guide for holographic knobs |
| [HOLOGRAPHIC_COMPARISON.md](docs/ui/HOLOGRAPHIC_COMPARISON.md) | Holographic vs flat knob comparison |
| [IMPLEMENTATION_SUMMARY_3D_KNOBS.md](docs/ui/IMPLEMENTATION_SUMMARY_3D_KNOBS.md) | 3D knob implementation summary |
| [kbd-plan.md](docs/ui/kbd-plan.md) | Keyboard input planning |
| [live-kbd-plan.md](docs/ui/live-kbd-plan.md) | Live on-screen keyboard plan |
| [progress-bar-design.md](docs/ui/progress-bar-design.md) | Progress bar design spec |
| [progress-bar-critique.md](docs/ui/progress-bar-critique.md) | Progress bar UX critique |
| [programmatic_composer.md](docs/ui/programmatic_composer.md) | Programmatic composition interface notes |

---

## `docs/tts/`

| File | Description |
|------|-------------|
| [TTS_DEPLOYMENT.md](docs/tts/TTS_DEPLOYMENT.md) | TTS deployment, assets, troubleshooting |
| [TTS_IMPLEMENTATION_SUMMARY.md](docs/tts/TTS_IMPLEMENTATION_SUMMARY.md) | Per-bank TTS implementation |
| [TTS_PER_BANK_VERIFICATION.md](docs/tts/TTS_PER_BANK_VERIFICATION.md) | Manual per-bank TTS testing |
| [TTS_VISUAL_GUIDE.md](docs/tts/TTS_VISUAL_GUIDE.md) | TTS voice designer visual guide |
| [VOCAL_WORKSTATION_PLAN.md](docs/tts/VOCAL_WORKSTATION_PLAN.md) | Vocal workstation feature plan |

---

## `docs/wasm/`

| File | Description |
|------|-------------|
| [BUILD_NOTES.md](docs/wasm/BUILD_NOTES.md) | WASM build configuration and known issues |

---

## `docs/deployment/`

| File | Description |
|------|-------------|
| [CLOUD_API_VERIFICATION.md](docs/deployment/CLOUD_API_VERIFICATION.md) | Cloud storage REST API verification |
| [DEPLOYMENT_CONFIG.md](docs/deployment/DEPLOYMENT_CONFIG.md) | Server and SFTP deployment config |

---

## `docs/refactoring/`

| File | Description |
|------|-------------|
| [APP_REFACTORING_SUMMARY.md](docs/refactoring/APP_REFACTORING_SUMMARY.md) | App.tsx extraction refactor summary |
| [PERFORMANCE_MIGRATION_STRATEGY.md](docs/refactoring/PERFORMANCE_MIGRATION_STRATEGY.md) | WebGPU/WASM performance migration |
| [REFACTORING_SUMMARY.md](docs/refactoring/REFACTORING_SUMMARY.md) | General refactoring notes |
| [SECTIONS_3_4_SUMMARY.md](docs/refactoring/SECTIONS_3_4_SUMMARY.md) | Rubberband sections 3 & 4 summary |
| [streamlining.md](docs/refactoring/streamlining.md) | Build and dev workflow streamlining |

---

## `docs/archive/` — historical (not maintained)

Completed sprints, stale planning scratch, and session transcripts. **Not** indexed for day-to-day work.

| File | Description |
|------|-------------|
| [IMPLEMENTATION_COMPLETE.md](docs/archive/IMPLEMENTATION_COMPLETE.md) | OpenMP / Rubberband sprint completion |
| [IMPLEMENTATION_SUMMARY.md](docs/archive/IMPLEMENTATION_SUMMARY.md) | Historical implementation snapshot |
| [INTEGRATION_SUMMARY.md](docs/archive/INTEGRATION_SUMMARY.md) | TTS integration details (historical) |
| [PR_SUMMARY.md](docs/archive/PR_SUMMARY.md) | Holographic knobs PR summary |
| [work_jan26.md](docs/archive/work_jan26.md) | January 26 work log |
| [plan2.md](docs/archive/plan2.md) | Formant envelope planning scratch (archived) |
| [test_plan.md](docs/archive/test_plan.md) | Formant filter test planning scratch |
| [test_plan2.md](docs/archive/test_plan2.md) | Formant envelope test planning scratch |
| [lfo_sync_plan.md](docs/archive/lfo_sync_plan.md) | LFO sync feature planning scratch |
| [grok.md](docs/archive/grok.md) | Grok assistant guide (superseded by AGENTS.md) |
| [copilot-session-4c69e623-….md](docs/archive/copilot-session-4c69e623-937a-417f-a6f2-f94dc628f01f.md) | Copilot session transcript |

---

## `tools/archive/` — dead scripts (do not run)

One-off Python/bash patchers from the `audioPlayback.ts` parse-error incident. See [tools/archive/README.md](tools/archive/README.md).

---

## Build & test (quick reference)

Detailed commands live in [AGENTS.md](AGENTS.md).

```bash
pnpm install --frozen-lockfile
pnpm run dev              # WASM prebuild + Vite
pnpm test                 # Vitest
pnpm run lint
npx tsc -b
pnpm run build            # Production
```

---

## Notes for agents

- **Entry point:** this file (`DOCS.md`), then [AGENTS.md](AGENTS.md) for build boundaries and pitfalls.
- **Four Worlds:** never mix AssemblyScript, Rust, Emscripten, and JC-303 toolchains (see AGENTS.md).
- **COOP/COEP:** required for threaded WASM (`SharedArrayBuffer`).
- **Do not run** anything under `tools/archive/`.
