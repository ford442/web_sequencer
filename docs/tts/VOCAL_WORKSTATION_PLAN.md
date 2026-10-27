# Vocal Workstation Implementation Plan

> **Purpose**: Transform the sampler into a comprehensive vocal/singing workstation with TTS + RubberBand + per-step phoneme control + harmonizer layers + live painter.

This plan builds on the existing [RUBBERBAND_ENHANCEMENT_PLAN.md](../audio-engine/RUBBERBAND_ENHANCEMENT_PLAN.md) and integrates with the current implementation.

---

## Current Foundation (Already Implemented ✅)

| Feature | File | Status |
|---------|------|--------|
| RubberBand AudioWorklet Processor | `src/audio-worklets/rubberband-processor.ts` | ✅ |
| Multi-Resolution Pitch Caching | `src/engines/SingingVoice.ts` | ✅ |
| Expressive Voice Processor (Vibrato, Breath) | `src/engines/rubberband/ExpressiveVoiceProcessor.ts` | ✅ |
| PhonemeAligner (CTC + heuristic) | `src/engines/rubberband/PhonemeAligner.ts` | ✅ |
| FormantShifter | `src/engines/rubberband/FormantShifter.ts` | ✅ |
| Harmonize one-button (3rd/5th/octave + mix) | `SamplerPanel` + `HARMONIZE_PRESETS.layers` | ✅ |
| **Open303 Stack Overflow Fix** | `OPEN303_STACK_OVERFLOW_FIX.md` | ✅ |

---

## The 5 Phases

### Phase 1: Main Pitch Section + RubberBand Controls ✅ COMPLETE
**Goal**: Replace/extend current sampler bank controls with a clean holographic pitch panel

**Components**:
- `SamplerPitchControls.tsx` - New pitch control panel component
- Updates to `SamplerPanel.tsx` - Integration
- Updates to `SingingVoice.ts` - Wiring for new parameters

**New Parameters**:
| Parameter | Range | Description |
|-----------|-------|-------------|
| `rootNote` | 0-127 MIDI | Root note for pitch tracking |
| `coarse` | -24 to +24 st | Coarse pitch adjustment |
| `fine` | -50 to +50 ¢ | Fine pitch adjustment |
| `formant` | -12 to +12 st | Formant shift |
| `pitchAttack` | 0-2000 ms | Pitch envelope attack |
| `pitchDecay` | 0-2000 ms | Pitch envelope decay |
| `rbQuality` | Fast/Standard/Elastic | RubberBand quality mode |
| `stretchMode` | Time/Pitch/Formant | Stretch processing mode |
| `autoFollow` | boolean | Lock pitch to sequencer notes |

**Files to Modify**:
- `src/components/SamplerPitchControls.tsx` (NEW)
- `src/components/SamplerPanel.tsx`
- `src/types.ts` (extend SamplerBankParams)

---

### Phase 2: Per-Step Overrides + Visual Stretch (Melodic Lyric Mode) ✅ COMPLETE
**Goal**: Visual step height based on pitch + drag-to-set pitch in sequencer

**Components Created**:
| File | Purpose |
|------|---------|
| `src/components/MelodicStep.tsx` | Individual step with pitch-based height |
| `src/components/MelodicSequencerRow.tsx` | Sequencer row using melodic steps |

**Files Modified**:
- `src/types.ts` - Added `pitch`, `pitchOffset`, `phonemeIndex` to Note interface
- `src/components/MainSequencer.tsx` - Added `melodicMode` prop, renders MelodicSequencerRow for sampler
- `src/components/SamplerPanel.tsx` - Added melodic mode toggle UI

**Features Implemented**:
- ✅ Step height = pitch (taller = higher note, 40-220px range)
- ✅ Color-coded by note (C=red, D=orange, E=yellow, F=green, G=cyan, A=blue, B=purple)
- ✅ Drag up/down to change pitch (8px per semitone)
- ✅ Keyboard controls (↑/↓ = 1 semitone, PgUp/PgDn = 1 octave)
- ✅ Per-step pitch stored in pattern data (`note.pitch`)
- ✅ Phoneme index display on steps
- ✅ Melodic mode toggle in SamplerPanel
- ✅ Visual legend showing note colors

**Usage**:
1. Enable "Melodic Lyric Mode" in SamplerPanel
2. Click a step to activate it
3. Drag up/down to change pitch
4. Step height visually represents the note pitch

---

### Phase 3: Live Phoneme Painter ✅ COMPLETE
**Goal**: Visual phoneme editing with draggable pills

**Components Created**:
| File | Purpose |
|------|---------|
| `src/components/PhonemePainter.tsx` | Main phoneme editing interface |
| `PhonemePill` (internal) | Draggable phoneme representation |

**Features Implemented**:
- ✅ Waveform visualization with zoom (50%-500%)
- ✅ Draggable phoneme pills with color coding by type
- ✅ Per-phoneme pitch bend control (-100¢ to +100¢)
- Phoneme elasticity/stretch control (50%-150%) — listed here originally but not shipped until Phase 5 (#1273)
- ✅ Timeline ruler with second markers
- ✅ Click to select phoneme
- ✅ Visual legend (Vowel=purple, Plosive=red, Fricative=green, etc.)
- ✅ IPA-style phoneme display (e.g., "æ" for AE)
- ✅ Phoneme category coloring

**ARPABET Support**:
All standard ARPABET phonemes mapped to readable symbols:
- Vowels: AA, AE, AH, AO, AW, AY, EH, ER, EY, IH, IY, OW, OY, UH, UW
- Consonants: P, B, T, D, K, G, CH, JH, F, V, TH, DH, S, Z, SH, ZH, HH
- Nasals: M, N, NG
- Liquids: L, R, W, Y

---

### Phase 4: Instant Harmonizer Layers ✅ COMPLETE
**Goal**: One-button harmonization with multiple voice layers

**Shipped**:
- `HARMONIZE_PRESETS.layers` — 4 voices: dry + major 3rd + 5th + octave, formant spread, detune
- SamplerPanel **HARM** applies layers via `onHarmonize` (was previously unwired)
- Harmony **mix** slider maps to `busGain`
- Chord dropdown still retargets the three intervals (`layersIntervalsForChord`)
- Advanced editor remains `SamplerVoicePanel` / `HarmonizerPopover`

Live preview only; freeze/export of harmony layers is not in this slice.

---

### Phase 5: Phoneme Elasticity per Step ✅ COMPLETE (#1273)
**Goal**: Per-phoneme time stretching with "squish/stretch" handles

**How it works**:
- `PhonemeData.elasticity` (0.5–1.5, default 1) is stored on the step's `Note.phonemes` in the pattern JSON, next to pitch bend and volume.
- Elasticity **redistributes** time inside the note: a phoneme at 1.5 takes a bigger share and the others give it up, so the note still fills its step length (`src/engines/rubberband/phonemeElasticity.ts`).
- `PhonemeAligner.createSharedPhonemeBuffer` writes the result into stride slot 3, which used to be hard-coded to 1.0. The worklet multiplies it into that phoneme's stretch ratio (`src/audio-worklets/rubberband/phonemeData.ts`), the same way it reads pitch bend.
- Painter phonemes are matched to aligned segments **by time** (the midpoint of each segment), not by index. Adding, moving or deleting pills no longer shifts edits onto the wrong phoneme.
- `playSamplerVoice` now passes the step's painter phonemes to the worklet. Before this, pitch bend and volume edits were saved but never heard.

**UI**: a squish/stretch strip along the bottom of each pill (drag on the selected pill), a `↔N%` badge, an Elasticity slider in the selected-phoneme panel, and the `[` / `]` keys (hold Shift for ±25 %). The handlers live in `src/components/phoneme/usePhonemeEdits.ts`, `ElasticityHandle.tsx` and `ElasticityControl.tsx`.

**Tests**: `src/engines/rubberband/__tests__/phonemeElasticity.test.ts`, `src/__tests__/phonemeElasticity.integration.test.ts` (real worklet + wasm: the audible phoneme boundary moves from 0.50 s to 0.74 s at 1.5 / 0.5), `src/components/__tests__/PhonemePainterElasticity.test.tsx`, `tests/phoneme-elasticity.spec.ts`.

---

## Implementation Status

| Phase | Status | Date |
|-------|--------|------|
| Phase 1 | ✅ COMPLETE | 2026-02-23 |
| Phase 2 | ✅ COMPLETE | 2026-02-23 |
| Phase 3 | ✅ COMPLETE | 2026-02-23 |
| Alignment V1 (CTC) | ✅ COMPLETE | 2026-09-01 |
| Phase 4 | ✅ COMPLETE | 2026-09-01 |
| Phase 5 | ✅ COMPLETE | 2026-09-23 |
| V2 Concatenative vowel pack + offline Rubber Band host | ✅ COMPLETE | 2026-10-27 |
| V4 Offline neural vocoder | 📋 FOLLOW-UP | - |

---

## Integration Points

### Audio Engine (`SingingVoice.ts`)
```typescript
// Phase 1 wiring
const scale = Math.pow(2, (coarse + fine / 1200) / 12);
rubberBandProcessor.setPitchScale(scale);
formantShifter.shift(formant);
rubberBandProcessor.setQuality(rbQuality);
rubberBandProcessor.setStretchMode(stretchMode);
if (autoFollow) note.pitch = sequencerStepPitch;
```

### Sequencer (`MainSequencer.tsx`)
```typescript
// Phase 2 wiring
style={{
  height: `${40 + (pitch - 48) * 3}px`,
  borderTopColor: pitchColor(pitch),
}}
onPointerDown={(e) => startPitchDrag(e, stepIndex)}
```

### Pattern Data Structure (Extended)
```typescript
interface SamplerBankParams {
  // ... existing params ...
  
  // Phase 1
  rootNote?: number;
  coarse?: number;
  fine?: number;
  formant?: number;
  pitchAttack?: number;
  pitchDecay?: number;
  rbQuality?: 'Fast' | 'Standard' | 'Elastic';
  stretchMode?: 'Time' | 'Pitch' | 'Formant';
  autoFollow?: boolean;
  
  // Phase 5 shipped as PhonemeData.elasticity on the step's Note.phonemes, not here
}
```

---

## Dependencies

- `SingingVoice.ts` - ✅ Already exists
- `RubberBandProcessor.ts` - ✅ Already exists
- `PhonemeAligner.ts` - CTC forced align (onnxruntime-web wav2vec2) with heuristic fallback
- `FormantShifter.ts` - wired when `enableFormantShifting: true`

## Alignment backend (V1)

- **Model**: download-on-demand quantized wav2vec2-base CTC at `assets/onnx/wav2vec2-ctc.onnx` (Apache-2.0). Gitignored with other ONNX weights.
- **Algorithm**: CTC Viterbi of the letter sequence, G2P (CMU subset + letter rules) to ARPABET, word-level time mapping.
- **TTS priors**: `Supertonic.getLastTokenDurations()` passed into `prepareVocal` after generate.
- **Fallback**: existing energy/uniform heuristic when the ONNX is missing or inference fails.
- **Painter**: Phoneme Painter uses real `start`/`end` (normalized). After TTS generate, `prepareVocal` runs automatically.
- **Tolerance**: median phoneme boundary error vs the committed `ah ee` fixture must be **≤ 40 ms** (`ALIGNMENT_BOUNDARY_TOLERANCE_MS`).

## Follow-up PRs

### V2 — Concatenative hybrid ✅
- **Pack.** `public/assets/vowels/` (`manifest.json` + one looped 48 kHz WAV per vowel: ah ee eh oh oo ih uh), generated by `node scripts/generate-vowel-pack.mjs` — a formant synthesizer with a whole-sample pulse period, so the loop is exactly periodic. It is the only tracked directory under `public/assets/` (see `.gitignore`).
- **Loader.** `VowelLibrary.loadFromUrl` fetches through `fetchPublicJson` / `fetchPublicArrayBuffer` (`src/utils/publicAsset.ts`, on `resolvePublicAsset`). A missing or broken pack is a `disabled` library with a reason, shown in the Engine HUD as `vowel-samples`; banks stay on TTS. Loaded once per context after the singing voices (`src/services/vowelLibraryService.ts`).
- **Per bank.** `useVowelSamplesOnLongNotes` (default off; sampler panel, stretch mode, "LONG NOTES") and `minNoteDurationMs` (default 500). Shorter notes stay TTS; phoneme slice mode is never layered.
- **Per note.** `ConcatenativeHybrid.planNote` picks the phrase's last vowel (from the alignment; `ah` without one) and the sample nearest the note, tiles its loop so Rubber Band stretches it at most 2×, and places a cosine crossfade (`DEFAULT_CONCATENATIVE_CONFIG`, 50 ms) one crossfade length into that vowel. `playSamplerVoice` runs the loop on a second voice through the same trigger — Rubber Band pitch from the sample's pitch to the note, formants preserved, same FX strip — and two gains cross over (`samplerPlayback/vowelLayer.ts`). The worklet starts a note on message arrival, so the loop runs from note start under a gain of 0.
- **Rate.** The planner takes the context's `sampleRate`; nothing assumes 48 kHz. Offline, the pack is resampled to the export rate with the shared OfflineAudioContext resampler (`VowelLibrary.withSampleRate`).

### Offline vocal host (#1273 Part C) ✅
Freeze / stem export of a stretch bank go through `src/audio/offline/vocal/offlineVocalHost.ts`: the live `createPlaySamplerVoice` on an `OfflineAudioContext` at `resolveExportSampleRate`, with its own `SingingVoiceManager` (a second `rubberband.wasm` instance per voice, `docs/wasm/BUILD_NOTES.md#offline-vocal-host`). The render suspends at each hit, triggers it, waits on a `SYNC` round-trip to every voice and resumes, so phoneme timing, painter edits, formant shift, the rb_fx chain and the vowel crossfade are the live code at the same step. A module that fails to load reports the bank unsupported and leaves its stem out — no dry substitute. Still live-only: HARM layers and a note FX chain on a stretch bank (reported per bank in the export).

Tests: `src/engines/rubberband/__tests__/ConcatenativeHybrid.test.ts` (gate, manifest, rates), `src/audio/offline/vocal/__tests__/offlineVocalHost.test.ts` (export rate, scheduling, unsupported), `src/__tests__/vocalFreezeParity.integration.test.ts` (real wasm: a two-bar line's phoneme boundaries at 44.1 vs 48 kHz within `ALIGNMENT_BOUNDARY_TOLERANCE_MS`; frozen G4 vowel within a semitone), `tests/vocal-freeze.spec.ts` (E2E bounce).

### V4 — Offline neural vocoder
Hook `HybridNeuralPipeline.synthesize` into freeze/export only. Resample ONNX output with the AudioContext sampleRate policy (#1136). Missing model → unsupported, no crash. Live preview stays Rubber Band.

### V5 — Per-step elasticity ✅ (#1273)
See Phase 5 above.

Do not expand `LatencyCompensator` (deleted). RBS import wiring (`handleRbsImport` / PCF / song TRAK) is documented in `docs/audio-engine/RBS_IMPORT_PIPELINE.md` (historical #651 / #1139).

## Notes

- Each phase is designed to be plug-and-play
- No breaking changes to existing pattern data
- New parameters are optional with sensible defaults
- UI follows existing holographic design language

---

*Last Updated: 2026-10-27*
*Status: Phase 5 (elasticity), CTC alignment, V2 vowel pack and the offline Rubber Band host shipped; V4 follow-up (waits on nothing now: the host exists). Freeze/stems of a stretch bank render through Rubber Band; HARM layers are still live-only.*
