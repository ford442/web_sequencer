# Programmatic Composer Guide for Hyphon

This document outlines the data structures and sonic parameters required for AI agents to generate valid song files for the Hyphon engine.

## 1. Song Structure Overview

A Hyphon song is a JSON object matching the `SavedSongData` interface. It contains patterns, synthesis parameters, and track data.

### Root Object (`SavedSongData`)

```typescript
interface SavedSongData {
  version: number;          // version: 1
  tempo: number;            // BPM (e.g., 120)
  pattern: Pattern;         // The core musical data
  params: {                 // Synthesis parameters
    synthA: SynthParams;    // Lead/Bass Synth 1
    synthB: SynthParams;    // Lead/Bass Synth 2
    kick: KickParams;       // Kick Drum
    snare: SnareParams;     // Snare Drum
    closedHat: HatParams;   // Closed Hi-Hat
    openHat: HatParams;     // Open Hi-Hat
    sampler: SamplerParams; // Sampler Banks (Array of 8)
  };
  trackStorage: Record<string, unknown>; // (Internal)
  activeTrackSlots: Record<string, number>; // (Internal)
  songStructure: SongStep[]; // Arrangement
  embeddedSamples?: { [bankIndex: number]: string }; // Base64 WAVs
  ttsPhrases?: string[];    // Text-to-Speech phrases
}
```

## 2. Sonic Intuition: Parameter Mapping

To "intuit" how a sound will be perceived, use the following parameter mappings.

### Synth Parameters (`SynthParams`)

| Parameter | Type | Range | Sonic Characteristic | Intuition Guide |
| :--- | :--- | :--- | :--- | :--- |
| `waveform` | string | 'sawtooth', 'square', '303-saw', '303-sqr' | Timbre | **Saw**: Bright, buzzy, aggressive. **Square**: Hollow, woody, clarinet-like. **303-Saw**: Acidic, biting. **303-Sqr**: Resonant, hollow acid. |
| `filterCutoff` | number | 0 - 20000 (Hz) | Brightness | **Low (<500)**: Deep, muffled, sub-bass. **Mid (500-2000)**: Warm, punchy. **High (>2000)**: Bright, sizzling, harsh. |
| `filterResonance` | number | 0 - 20 (Q) | Squelch / "Wow" | **Low (<1)**: Clean, flat. **Mid (1-5)**: Musical, vocal. **High (>10)**: Screaming, self-oscillating, "acidic squelch". |
| `attack` | number | 0 - 2.0 (s) | Impact | **Short (<0.01)**: Plucky, percussive, immediate. **Long (>0.5)**: Swelling, pad-like, slow. |
| `decay` | number | 0 - 2.0 (s) | Duration / Tail | **Short (<0.2)**: Staccato, tight. **Long (>1.0)**: Ringing, sustained. |
| `sustain` | number | 0 - 1.0 | Body | **Low (0)**: Percussive (piano/pluck). **High (1)**: Organ/Drone (continuous). |
| `release` | number | 0 - 5.0 (s) | Fade Out | **Short**: Abrupt stop. **Long**: Ambient tail. |
| `drive` | number | 0 - 1.0 | Distortion | **0**: Clean. **0.5**: Warm saturation. **1.0**: Aggressive fuzz/distortion. |

### Drum Parameters

#### Kick (`KickParams`)
- **Punchy/Tight**: `decay: 0.3`, `tone: 0.8`, `pitch: 50`
- **Boomy/808**: `decay: 0.8`, `tone: 0.2`, `pitch: 40`
- **Distorted/Gabber**: `decay: 0.5`, `tone: 1.0` (high tone acts as drive)

#### Snare (`SnareParams`)
- **Tight/Funk**: `decay: 0.2`, `tone: 0.8`, `noise: 0.4`
- **Splashy/80s**: `decay: 0.6`, `tone: 0.5`, `noise: 0.8`

#### Hi-Hats (`HatParams`)
- **Ticking/Digital**: `decay: 0.05`, `pitch: 8000`
- **Open/Washy**: `decay: 0.5`, `pitch: 6000`

### Sampler Parameters (`SamplerBankParams`)

| Parameter | Type | Range | Sonic Characteristic | Intuition Guide |
| :--- | :--- | :--- | :--- | :--- |
| `playbackSpeed` | number | 0.1 - 4.0 | Pitch/Time | **1.0**: Normal. **0.5**: Half-speed/octave down (sludgy). **2.0**: Chipmunk/octave up. |
| `mode` | string | 'loop', 'stretch', 'wavetable' | Texture | **Loop**: Traditional sampler. **Stretch**: Time-stretching (preserving pitch). **Wavetable**: Granular/scanned textures. |
| `grainSize` | number | 0.01 - 0.5 (s) | Granularity | **Small (<0.05)**: Glitchy, robotic. **Large (>0.2)**: Smooth, dreamy. |
| `bitCrush` | number | 0 - 16 | Lo-Fi | **0**: Clean. **8**: Vintage sampler. **16**: Heavy digital destruction. |

## 3. Pattern & Sequencing

The sequencing data is stored in the `pattern` object.

```typescript
interface Pattern {
  partA: PartSequence; // Synth A
  partB: PartSequence; // Synth B
  kick: PartSequence;
  snare: PartSequence;
  closedHat: PartSequence;
  openHat: PartSequence;
  sampler: PartSequence[]; // Array of 8 sequences
}

interface PartSequence {
  steps: (Note | null)[]; // Array of 16 steps (usually)
  automation?: { [param: string]: (number | null)[] };
}

interface Note {
  note: string;       // e.g., "C4", "F#3"
  velocity: number;   // 0.0 - 1.0 (Volume/Accent)
  length?: number;    // Duration in steps (default 1)
  slide?: boolean;    // Portamento to next note
  probability?: number; // 0.0 - 1.0 (Chance to play)
  microtiming?: number; // -0.5 to 0.5 (Swing/Offset)
  reverse?: boolean;  // Reverse playback (Sampler only)
}
```

### Sequencing Intuition
- **Acid Bassline**: Use `slide: true` on overlapping notes. Vary `velocity` > 0.8 for Accents.
- **Human Feel**: Use `microtiming` (e.g., `closedHat` slightly late +0.02, `snare` slightly early -0.01).
- **Ghost Notes**: Use low `velocity` (0.2 - 0.4) on snare/kicks between main beats.

## 4. Example: "Acid Techno" Generator Profile

To generate an Acid Techno track, an agent should output JSON with these characteristics:

1.  **Tempo**: 135 - 145 BPM.
2.  **Kick**: `decay: 0.6`, `tone: 0.4` (Solid 909-style). Pattern: 4-on-the-floor (Steps 0, 4, 8, 12).
3.  **Synth A (Bass)**:
    -   `waveform`: "303-sqr"
    -   `filterCutoff`: 400 (base)
    -   `filterResonance`: 8.5 (High!)
    -   `envMod`: 0.8
    -   **Pattern**: 16th notes with gaps. High probability of `slide: true`.
4.  **Hi-Hats**: Open hat on off-beats (2, 6, 10, 14). Closed hats 16ths with varying velocity.

---

*This guide serves as the protocol for AI-driven composition within the Hyphon engine.*
