# Hyphon Documentation Index

This directory contains all project documentation organized by topic.
For a quick-start overview see the root [README.md](../README.md).

---

## Audio Engine (`audio-engine/`)

| File | Summary |
|------|---------|
| [HARMONIZER_IMPLEMENTATION.md](audio-engine/HARMONIZER_IMPLEMENTATION.md) | Vocal harmonizer engine design and implementation details |
| [JC303_STACK_OVERFLOW_FIX.md](audio-engine/JC303_STACK_OVERFLOW_FIX.md) | Fix for stack overflow in the JC-303 TB-303 clone WASM build |
| [MULTISAMPLE_GENERATOR_DESIGN.md](audio-engine/MULTISAMPLE_GENERATOR_DESIGN.md) | Design notes for the multisample generator |
| [MULTISAMPLE_IMPLEMENTATION_SUMMARY.md](audio-engine/MULTISAMPLE_IMPLEMENTATION_SUMMARY.md) | Implementation summary for multisample generation |
| [OPEN303_FALLBACK_MODES.md](audio-engine/OPEN303_FALLBACK_MODES.md) | Fallback synthesis modes for the Open303 engine |
| [OPEN303_STACK_OVERFLOW_FIX.md](audio-engine/OPEN303_STACK_OVERFLOW_FIX.md) | Stack overflow fix for the Open303 C++ build |
| [OPENMP_IMPLEMENTATION.md](audio-engine/OPENMP_IMPLEMENTATION.md) | OpenMP threading setup for Emscripten builds |
| [OPENMP_RUBBERBAND_PATCHES.md](audio-engine/OPENMP_RUBBERBAND_PATCHES.md) | Patches applied to Rubberband library for OpenMP support |
| [RUBBERBAND_ANALYSIS.md](audio-engine/RUBBERBAND_ANALYSIS.md) | Analysis of Rubberband pitch/time-stretch library integration |
| [RUBBERBAND_DESIGN.md](audio-engine/RUBBERBAND_DESIGN.md) | Architectural design for Rubberband integration |
| [RUBBERBAND_ENHANCEMENT_PLAN.md](audio-engine/RUBBERBAND_ENHANCEMENT_PLAN.md) | Full enhancement plan for Rubberband (sections 1–10) |
| [RUBBERBAND_INTEGRATION_GUIDE.md](audio-engine/RUBBERBAND_INTEGRATION_GUIDE.md) | User guide for the Rubberband integration |
| [SUSTAIN_PROCESSOR_RUBBERBAND_GUIDE.md](audio-engine/SUSTAIN_PROCESSOR_RUBBERBAND_GUIDE.md) | Guide for sustain-processor AudioWorklet with Rubberband |
| [jc303-fix-plan.md](audio-engine/jc303-fix-plan.md) | Plan for fixing JC-303 WASM issues |
| [jc303-technical-analysis.md](audio-engine/jc303-technical-analysis.md) | Technical analysis of JC-303 stack and build issues |

---

## UI / Visual (`ui/`)

| File | Summary |
|------|---------|
| [HOLOGRAPHIC_COMPARISON.md](ui/HOLOGRAPHIC_COMPARISON.md) | Visual comparison of holographic vs flat knob rendering |
| [HOLOGRAPHIC_KNOBS.md](ui/HOLOGRAPHIC_KNOBS.md) | Holographic 3D knob UI implementation documentation |
| [HOLOGRAPHIC_USER_GUIDE.md](ui/HOLOGRAPHIC_USER_GUIDE.md) | User guide for the holographic knob interface |
| [IMPLEMENTATION_SUMMARY_3D_KNOBS.md](ui/IMPLEMENTATION_SUMMARY_3D_KNOBS.md) | Implementation summary for 3D holographic knobs |
| [kbd-plan.md](ui/kbd-plan.md) | Planning notes for keyboard input handling |
| [live-kbd-plan.md](ui/live-kbd-plan.md) | Plan for the live on-screen keyboard feature |
| [progress-bar-critique.md](ui/progress-bar-critique.md) | Critique and analysis of progress-bar UX |
| [progress-bar-design.md](ui/progress-bar-design.md) | Design specification for the progress bar component |
| [programmatic_composer.md](ui/programmatic_composer.md) | Notes on the programmatic composition interface |

---

## TTS / Voice Synthesis (`tts/`)

| File | Summary |
|------|---------|
| [TTS_DEPLOYMENT.md](tts/TTS_DEPLOYMENT.md) | Complete TTS deployment guide, asset requirements, and troubleshooting |
| [TTS_IMPLEMENTATION_SUMMARY.md](tts/TTS_IMPLEMENTATION_SUMMARY.md) | Per-bank TTS feature implementation details |
| [TTS_PER_BANK_VERIFICATION.md](tts/TTS_PER_BANK_VERIFICATION.md) | Manual testing guide for per-bank TTS functionality |
| [TTS_VISUAL_GUIDE.md](tts/TTS_VISUAL_GUIDE.md) | Visual guide and examples for the TTS voice designer |
| [VOCAL_WORKSTATION_PLAN.md](tts/VOCAL_WORKSTATION_PLAN.md) | Plan for the vocal workstation feature set |

---

## WASM Builds (`wasm/`)

| File | Summary |
|------|---------|
| [BUILD_NOTES.md](wasm/BUILD_NOTES.md) | Notes on WASM build configuration and known issues |

---

## Deployment (`deployment/`)

| File | Summary |
|------|---------|
| [CLOUD_API_VERIFICATION.md](deployment/CLOUD_API_VERIFICATION.md) | Verification steps for the cloud storage REST API |
| [DEPLOYMENT_CONFIG.md](deployment/DEPLOYMENT_CONFIG.md) | Server and SFTP deployment configuration reference |

---

## Refactoring (`refactoring/`)

| File | Summary |
|------|---------|
| [APP_REFACTORING_SUMMARY.md](refactoring/APP_REFACTORING_SUMMARY.md) | Summary of the App.tsx component-extraction refactor |
| [PERFORMANCE_MIGRATION_STRATEGY.md](refactoring/PERFORMANCE_MIGRATION_STRATEGY.md) | Strategy for migrating to WebGPU/WASM performance paths |
| [REFACTORING_SUMMARY.md](refactoring/REFACTORING_SUMMARY.md) | General codebase refactoring notes |
| [SECTIONS_3_4_SUMMARY.md](refactoring/SECTIONS_3_4_SUMMARY.md) | Summary of Rubberband sections 3 & 4 implementation |
| [streamlining.md](refactoring/streamlining.md) | Notes on streamlining the build and dev workflow |

---

## Archive (`archive/`)

Completed or historical documents kept for reference.

| File | Summary |
|------|---------|
| [IMPLEMENTATION_COMPLETE.md](archive/IMPLEMENTATION_COMPLETE.md) | Completion record for the OpenMP / Rubberband integration sprint |
| [IMPLEMENTATION_SUMMARY.md](archive/IMPLEMENTATION_SUMMARY.md) | High-level implementation summary (historical snapshot) |
| [INTEGRATION_SUMMARY.md](archive/INTEGRATION_SUMMARY.md) | Technical integration details for the TTS system (historical) |
| [PR_SUMMARY.md](archive/PR_SUMMARY.md) | PR description for the holographic knobs feature |
| [work_jan26.md](archive/work_jan26.md) | Work log from January 26 planning session |

---

## General (`docs/`)

| File | Summary |
|------|---------|
| [DEVELOPER_CONTEXT.md](DEVELOPER_CONTEXT.md) | Developer onboarding context and architecture overview |
| [features-implementation.md](features-implementation.md) | Feature implementation tracking and notes |
| [plan.md](plan.md) | High-level project planning notes |
