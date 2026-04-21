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
| PhonemeAligner (Stub) | `src/engines/rubberband/PhonemeAligner.ts` | 📝 |
| FormantShifter (Stub) | `src/engines/rubberband/FormantShifter.ts` | 📝 |
| Basic Harmonize UI | `src/components/SamplerPanel.tsx` | ✅ |
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
- ✅ Phoneme elasticity/stretch control (50%-150%)
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

### Phase 4: Instant Harmonizer Layers 📋 PLANNED
**Goal**: One-button harmonization with multiple voice layers

**Components**:
- Updates to `SamplerPanel.tsx` - Harmonize button (already exists)
- `HarmonizerEngine.ts` - Layer generation and management
- Integration with `SingingVoice.ts`

**Features**:
- Generate 3 harmony layers (3rd, 5th, octave)
- Slight formant variation per layer
- Tiny detune for thickness
- Mix control for blend

---

### Phase 5: Phoneme Elasticity per Step 📋 PLANNED
**Goal**: Per-phoneme time stretching with "squish/stretch" handles

**Components**:
- Extend `PhonemePainter.tsx` with elasticity controls
- Updates to pattern JSON structure
- Integration with RubberBand time stretching

**Features**:
- Elasticity handles on each phoneme pill
- Per-step elasticity map stored in pattern
- Visual feedback for stretch amount

---

## Implementation Status

| Phase | Status | Date |
|-------|--------|------|
| Phase 1 | ✅ COMPLETE | 2026-02-23 |
| Phase 2 | ✅ COMPLETE | 2026-02-23 |
| Phase 3 | ✅ COMPLETE | 2026-02-23 |
| Phase 4 | 📋 PLANNED | - |
| Phase 5 | 📋 PLANNED | - |

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
  
  // Phase 5
  phonemeElasticity?: number[];
}
```

---

## Dependencies

- `SingingVoice.ts` - ✅ Already exists
- `RubberBandProcessor.ts` - ✅ Already exists
- `PhonemeAligner.ts` - 📝 Needs completion for Phase 3
- `FormantShifter.ts` - 📝 Needs completion for Phase 1 formant control

---

## Notes

- Each phase is designed to be plug-and-play
- No breaking changes to existing pattern data
- New parameters are optional with sensible defaults
- UI follows existing holographic design language

---

*Last Updated: 2026-02-23*
*Status: Phase 1 Implementation In Progress*
