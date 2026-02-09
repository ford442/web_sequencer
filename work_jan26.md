# Web Sequencer (Hyphon DAW) - Work Plan Jan 26

## Current State
Advanced 32-step DAW with hybrid audio (WebGPU/WASM/Pyodide), TTS sampler, 3D studio, cloud sync, XM export. Strong docs/tests/build/deploy.

## Missing Basics
- `CHANGELOG.md`
- `LICENSE`
- `CONTRIBUTING.md`
- GitHub Actions CI/CD (lint/test/PR checks)
- Prettier config
- Test coverage reports (e.g., Vitest + coverage badge)
- PWA manifest/service worker

## Priority Tasks
### High Priority (Next Sprint)
1. **Rubberband Completion**  
   - Phoneme-aware time-stretch (Montreal Aligner)  
   - ExpressiveVoiceProcessor.ts (vibrato/breath)  
   - SIMD opts + rebuild WASM  
   *Files: RUBBERBAND_ENHANCEMENT_PLAN.md, emscripten/*

2. **Holographic UI**  
   - 3D knobs (R3F) with gesture controls  
   - Comparison vs 2D (perf/UI tests)  
   *Files: HOLOGRAPHIC_*.md, src/components/HardwareModule.tsx*

### Medium Priority
4. **MIDI Input**  
   - Web MIDI API hook  
   - Map to sequencer/synth params  

5. **Mobile Support**  
   - Touch-optimized knobs/sequencer  
   - Responsive layout + orientation lock  

6. **Perf Benchmarks**  
   - Lighthouse CI  
   - Audio latency metrics  
   *Ref: PERFORMANCE_MIGRATION_STRATEGY.md*

### Low Priority
7. **More Exports** (WAV loop finder, MIDI)  
8. **Voice Mixer Web Port** (Pyodide GUI)  
9. **Accessibility** (ARIA labels, keyboard nav)  
10. **Polyphony Sequencing**  
   - Multi-note/chord per step  
   - Velocity layers/poly aftertouch  
11. **ReBirth-338 RBS Import**  
   - Reverse-engineer/parse RBS binary (DataView: steps, knobs, patterns)  
   - Map imported data to Hyphon patterns/tracks/knobs  
   - Implement knob automation: save/edit per-step param curves  
   - UI: File picker + import preview/apply  
   *Files: src/utils/rbsParser.ts, App.tsx pattern state, PatternLoader.tsx*  

## Validation Steps
- Run `npm test` + manual audio/TTS/cloud tests  
- Verify all WASM rebuilds (`npm run build`)  
- Deploy preview + Lighthouse score >90  

*Estimated Effort: 2-3 days per high-priority task. Start with Rubberband rebuild.*
