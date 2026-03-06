# Hyphon AI Song Generation & Import System – Multi-Agent Collaboration Guide

**Document Version**: 2.0  
**Last Updated**: 2024-03-06  
**Author**: Hyphon Architect  
**Status**: Phase 2 Complete ✅

---

## 1. Goal

Enable **multi-agent collaboration** where different AI systems (Claude, Gemini, Jules, Copilot, Grok, etc.) can collaboratively write songs for Hyphon—a browser-based DAW with TB-303 synthesizers, TR-808/909 drums, and a sampler with vocal synthesis.

### What This System Enables

- **Single AI**: One AI writes a complete song
- **Collaborative**: Multiple AIs work together (melody + drums + lyrics)
- **Version History**: Track changes across AI generations
- **Cloud Library**: Songs auto-save to `songs/ai-generated/` folder in HF Storage Manager
- **Instant Import**: One-click import into Hyphon sequencer

---

## 2. Recommended Prompt Templates (By AI)

Different AIs excel at different tasks. Use these optimized prompts:

### For Claude (Anthropic) – Best for Complex Musical Structure

```
You are Claude, a music composer AI for Hyphon (web-based DAW). 
Generate a complete song with sophisticated musical structure.

HYPHON SONG FORMAT:
{
  "meta": {
    "title": "Song Name",
    "author": "claude-composer",
    "version": "1.0",
    "createdAt": "2024-03-06T12:00:00Z",
    "generator": "claude-3-opus",
    "prompt": "{{USER_PROMPT}}",
    "tags": ["genre", "mood"]
  },
  "globals": {
    "tempo": 128,
    "timeSignature": [4, 4],
    "swing": 50
  },
  "tracks": {
    "synthA": {
      "notes": [
        {"step": 0, "note": "C3", "velocity": 0.8, "accent": true, "slide": false},
        {"step": 4, "note": "G3", "velocity": 0.6},
        {"step": 8, "note": "Eb3", "velocity": 0.8, "accent": true},
        {"step": 12, "note": "F3", "velocity": 0.6}
      ],
      "params": {
        "waveform": "303-saw",
        "filterCutoff": 3000,
        "filterResonance": 12,
        "filterMode": 1,
        "decay": 0.4,
        "accent": 0.7
      }
    },
    "kick": [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    "snare": [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    "closedHat": [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true],
    "openHat": [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false]
  }
}

MUSICAL GUIDELINES:
- synthA: Acid-style basslines with slides and accents
- synthB: Lead melodies that complement synthA
- bass2: Second 303 for layering (optional)
- Drums: TR-808/909 style (kick, snare, closedHat, openHat)
- Sampler: Use for vocals (add ttsText for voice synthesis)

Generate: {{GENRE}} at {{TEMPO}} BPM, {{MOOD}} mood, {{COMPLEXITY}} complexity.
Return ONLY valid JSON, no markdown, no explanation.
```

### For Gemini (Google) – Best for Rhythmic Patterns

```
You are Gemini, a rhythm specialist for Hyphon DAW.
Create tight drum patterns and groovy basslines.

[Same JSON format as above]

RHYTHM GUIDELINES:
- Kick: 4-on-the-floor or broken beat patterns
- Snare: Backbeat (steps 4, 12) or syncopated
- Hi-hats: 16th note patterns with open hat accents
- Syncopation: Add ghost notes and off-beat elements

Generate: {{GENRE}} drum pattern at {{TEMPO}} BPM.
Focus on: groove, swing, rhythmic variation.
```

### For Jules (Code Agent) – Best for Technical Precision

```
You are Jules, a precise music generation agent for Hyphon.
Generate syntactically perfect JSON with optimal parameter values.

TECHNICAL CONSTRAINTS:
- Tempo: 30-300 BPM (validate)
- Steps: 0-15 for 16-step, 0-31 for 32-step patterns
- Notes: Use format "C3", "F#4", "Bb2" (regex: [A-G][#b]?[0-8])
- Velocity: 0.0-1.0 range
- Filter cutoff: 100-20000 Hz
- Waveforms: "303-saw", "303-sqr"

Validate all numeric ranges before outputting.
Generate error-free JSON for: {{GENRE}} at {{TEMPO}} BPM.
```

### For Copilot (GitHub) – Best for Iterative Refinement

```
You are Copilot, assisting with Hyphon song generation.
The user will iteratively refine their song. Track version history.

VERSION TRACKING:
- Always include "createdAt" timestamp
- Reference previous version if iterating
- Document changes in "prompt" field

ITERATIVE WORKFLOW:
1. Generate initial version
2. User requests changes
3. Update relevant tracks only
4. Preserve good elements

Generate: {{DESCRIPTION}} at {{TEMPO}} BPM.
```

### For Grok (xAI) – Best for Creative/Experimental

```
You are Grok, an experimental music AI for Hyphon.
Push boundaries with unconventional patterns.

EXPERIMENTAL TECHNIQUES:
- Polyrhythms: Different pattern lengths per track
- Microtonal: Pitch bend via formant shifting (sampler)
- Glitch: Random velocity variations
- Generative: Evolving patterns that change over time

Generate experimental {{GENRE}} at {{TEMPO}} BPM.
Be creative with: {{ELEMENTS_TO_EXPERIMENT_WITH}}
```

---

## 3. Full AISongData JSON Schema

```typescript
// ============================================================================
// CORE TYPES
// ============================================================================

interface AISongData {
  meta: {
    title: string;           // 1-100 characters
    author: string;          // Creator identifier
    version: "1.0";          // Format version
    createdAt: string;       // ISO 8601 timestamp
    generator: string;       // "claude-3-opus" | "gemini-pro" | "jules" | "copilot" | "grok"
    prompt: string;          // Original user prompt (max 1000 chars)
    tags?: string[];         // Genre, mood descriptors
  };
  
  globals: {
    tempo: number;           // BPM (30-300)
    timeSignature: [number, number];  // [4, 4], [3, 4], [6, 8], etc.
    swing?: number;          // 0-100 (50 = no swing)
  };
  
  tracks: {
    // TB-303 style synthesizers (acid bass/lead)
    synthA?: AITrackData;    // Lead / Bass 1
    synthB?: AITrackData;    // Secondary / Bass 2  
    bass2?: AITrackData;     // Third 303 (optional)
    
    // Drum machines (TR-808/909 style)
    kick?: boolean[];        // 16 or 32 boolean steps
    snare?: boolean[];
    closedHat?: boolean[];
    openHat?: boolean[];
    
    // Sampler banks (8 banks available)
    sampler?: AISamplerBankData[];
  };
}

interface AITrackData {
  notes: AINoteEvent[];
  params?: Partial<SynthParams>;  // Optional synth parameters
}

interface AINoteEvent {
  step: number;            // 0-31 (position in pattern)
  note: string;            // "C4", "F#3", "Bb2", etc.
  velocity?: number;       // 0-1 (default: 0.8)
  length?: number;         // In steps (default: 1)
  accent?: boolean;        // 303-style accent
  slide?: boolean;         // 303-style slide/portamento
}

interface AISamplerBankData {
  bankIndex: number;       // 0-7 (which sampler bank)
  steps: AINoteEvent[];    // Notes for this bank
  params?: Partial<SamplerBankParams>;
  ttsText?: string;        // Text for vocal synthesis
  sampleUrl?: string;      // Optional external sample
}

// ============================================================================
// VERSIONING (Phase 2)
// ============================================================================

interface VersionEntry {
  id: string;              // Unique version ID (v{timestamp}-{hash})
  timestamp: string;       // ISO 8601
  author: string;          // Who made the change
  changes: string;         // Description of changes
  parentId?: string;       // Previous version ID
}

interface VersionHistory {
  currentVersionId: string;
  versions: VersionEntry[];
}

// ============================================================================
// PREVIEW DATA (Phase 2)
// ============================================================================

interface PreviewData {
  trackSummary: Array<{
    name: string;
    noteCount: number;
    density: number;       // Notes per step (0-1)
  }>;
  estimatedDuration: number;  // Seconds
  complexityScore: number;    // 0-100
  patternGrid: boolean[][];   // 32x8 grid for visualization
  warnings: string[];
}
```

### Validation Rules

| Field | Type | Constraints |
|-------|------|-------------|
| `meta.title` | string | 1-100 chars |
| `meta.version` | literal | Must be "1.0" |
| `meta.createdAt` | string | Valid ISO 8601 |
| `globals.tempo` | number | 30-300 |
| `globals.swing` | number | 0-100 |
| `step` | number | 0-31 |
| `note` | string | Regex: `^[A-G][#b]?[0-8]$` |
| `velocity` | number | 0.0-1.0 |
| `bankIndex` | number | 0-7 |

---

## 4. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AI SONG MULTI-AGENT COLLABORATION FLOW                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   PHASE 1: GENERATION                                                        │
│   ═════════════════                                                        │
│                                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐            │
│   │  Claude  │    │  Gemini  │    │  Jules   │    │   Grok   │            │
│   │ (Melody) │    │ (Rhythm) │    │ (Verify) │    │(FX/Weird)│            │
│   └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘            │
│        │               │               │               │                   │
│        └───────────────┴───────┬───────┴───────────────┘                   │
│                                ▼                                           │
│                    ┌─────────────────────┐                                 │
│                    │   AISongData JSON   │                                 │
│                    │   (Combined Output) │                                 │
│                    └──────────┬──────────┘                                 │
│                               │                                            │
│   PHASE 2: IMPORT             ▼                                            │
│   ═════════════════   ┌─────────────────────┐                              │
│                       │  AISongImporter.ts  │                              │
│                       │  - validate()       │                              │
│                       │  - generatePreview()│                              │
│                       │  - createVersion()  │                              │
│                       └──────────┬──────────┘                              │
│                                  │                                         │
│   PHASE 3: STORAGE               ▼                                         │
│   ═════════════════   ┌─────────────────────┐                              │
│                       │  AISongStorage.ts   │                              │
│                       │  (HF Storage API)   │                              │
│                       └──────────┬──────────┘                              │
│                                  │                                         │
│                       ┌──────────┴──────────┐                              │
│                       ▼                     ▼                              │
│            ┌─────────────────┐   ┌─────────────────┐                       │
│            │ songs/ai-gen/   │   │ Version History │                       │
│            │ {id}.json       │   │ (metadata)      │                       │
│            └────────┬────────┘   └─────────────────┘                       │
│                     │                                                      │
│   PHASE 4: LOAD     ▼                                                      │
│   ═════════════════ ┌─────────────────────┐                                │
│                     │   Hyphon Sequencer  │                                │
│                     │   (Real-time play)  │                                │
│                     └─────────────────────┘                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Multi-Agent Collaboration Patterns

### Pattern A: Single AI (Solo)
```
User → Claude → Complete AISongData → Import → Play
```
**Best for**: Quick ideas, full control, simple songs

### Pattern B: Specialist Division (Collaborative)
```
User requests "Techno track"
  ├─→ Claude writes synthA bassline
  ├─→ Gemini writes drum patterns
  ├─→ User combines JSON manually OR
  └─→ Jules merges into one AISongData
→ Import → Play
```
**Best for**: Complex songs, leveraging each AI's strength

### Pattern C: Iterative Refinement
```
Gen 1: User → Claude → Song A
Gen 2: User + Song A → Copilot → Song B (improved)
Gen 3: User + Song B → Claude → Song C (final)
Each generation: Version history tracked
```
**Best for**: Polished results, gradual improvement

### Pattern D: Parallel Variations
```
User: "Generate 3 house basslines"
  ├─→ Claude → Bassline A
  ├─→ Gemini → Bassline B
  └─→ Grok → Bassline C (experimental)
User picks favorite → Add drums → Import
```
**Best for**: Exploring options, A/B testing

---

## 6. Best Practices for AI Interaction

### For Users

1. **Be Specific About Genre**
   - ❌ "Make a song"
   - ✅ "Generate a dark techno track at 130 BPM with rolling bassline"

2. **Reference Artists/Tracks**
   - "Acid bassline in the style of Daft Punk's 'Da Funk'"
   - "Drum pattern like a Detroit techno track"

3. **Specify Complexity**
   - "Minimal" → Sparse patterns, few notes
   - "Layered" → Multiple tracks active
   - "Complex" → Dense patterns, polyrhythms

4. **Iterate in Small Steps**
   - Change one track at a time
   - Preserve what works
   - Use version history

5. **Validate Before Import**
   - Check tempo is in range
   - Verify note formats
   - Review track density

### For AI Agents

1. **Always Validate Output**
   - Check all numeric ranges
   - Verify note name format
   - Ensure required fields present

2. **Preserve User Intent**
   - Include original prompt in meta.prompt
   - Document changes in version history
   - Don't remove existing good patterns

3. **Optimize for Hyphon**
   - Use 303-style waveforms for acid sounds
   - 16-step patterns work best for drums
   - Add accents for 303 character

4. **Handle Edge Cases**
   - Empty tracks are valid (omit key)
   - Sampler can have ttsText OR sampleUrl
   - Swing 50 = no swing

---

## 7. Folder Structure in HF Storage Manager

```
songs/
├── ai-generated/              # AI-generated songs (auto-saved)
│   ├── claude-3-opus/
│   │   ├── song-abc123.json
│   │   └── song-def456.json
│   ├── gemini-pro/
│   │   └── song-ghi789.json
│   └── multi-agent/
│       └── collaborative-xyz.json
├── user-saved/                # User manual saves
│   └── my-track.json
└── templates/                 # Example songs
    ├── techno-basic.json
    ├── house-groove.json
    └── ambient-drone.json
```

**Version History Storage**:
```json
{
  "songId": "abc123",
  "versions": [
    { "id": "v1", "timestamp": "2024-03-06T12:00:00Z", "author": "claude", "changes": "Initial version" },
    { "id": "v2", "timestamp": "2024-03-06T12:05:00Z", "author": "gemini", "changes": "Added drum fill", "parentId": "v1" }
  ]
}
```

---

## 8. Example Full Song JSON

### Techno Acid Track

```json
{
  "meta": {
    "title": "Warehouse Acid",
    "author": "claude-composer",
    "version": "1.0",
    "createdAt": "2024-03-06T12:00:00Z",
    "generator": "claude-3-opus",
    "prompt": "Dark warehouse techno with squelching 303 bassline, 130 BPM",
    "tags": ["techno", "acid", "warehouse", "dark"]
  },
  "globals": {
    "tempo": 130,
    "timeSignature": [4, 4],
    "swing": 52
  },
  "tracks": {
    "synthA": {
      "notes": [
        {"step": 0, "note": "C2", "velocity": 0.9, "accent": true, "slide": false},
        {"step": 2, "note": "C2", "velocity": 0.6},
        {"step": 4, "note": "Eb2", "velocity": 0.9, "accent": true, "slide": true},
        {"step": 6, "note": "F2", "velocity": 0.7},
        {"step": 8, "note": "C2", "velocity": 0.9, "accent": true},
        {"step": 10, "note": "C2", "velocity": 0.6},
        {"step": 12, "note": "G2", "velocity": 0.9, "accent": true, "slide": true},
        {"step": 14, "note": "Bb2", "velocity": 0.7}
      ],
      "params": {
        "waveform": "303-saw",
        "filterCutoff": 1500,
        "filterResonance": 18,
        "filterMode": 1,
        "decay": 0.4,
        "accent": 0.8,
        "envMod": 0.6
      }
    },
    "kick": [
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false
    ],
    "snare": [
      false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false
    ],
    "closedHat": [
      false, true, false, true, false, true, false, true,
      false, true, false, true, false, true, false, true
    ],
    "openHat": [
      false, false, false, false, false, false, false, false,
      false, false, false, false, false, false, true, false
    ],
    "sampler": [
      {
        "bankIndex": 0,
        "steps": [
          {"step": 0, "note": "C4", "velocity": 0.8},
          {"step": 16, "note": "C4", "velocity": 0.8}
        ],
        "ttsText": "Acid. Warehouse. Techno.",
        "params": {
          "rootNote": 60,
          "playbackSpeed": 1.0,
          "formantShift": 0
        }
      }
    ]
  }
}
```

---

## 9. Security & Error Handling

### Security Measures

1. **Input Sanitization**
   ```typescript
   // Never use eval() - always JSON.parse()
   const sanitized = DOMPurify.sanitize(input);
   const data = JSON.parse(sanitized);
   ```

2. **String Limits**
   - Title: max 100 chars
   - Prompt: max 1000 chars
   - Tags: max 10 tags, 20 chars each

3. **Numeric Validation**
   ```typescript
   const tempo = Math.min(300, Math.max(30, input.tempo));
   ```

4. **File Size Limits**
   - Max upload: 10MB
   - Max patterns: 32 steps × 8 tracks

### Error Categories

| Error Type | Cause | Solution |
|------------|-------|----------|
| `JSON_SYNTAX` | Missing brackets, trailing commas | "Fix Common Issues" button |
| `SCHEMA_VIOLATION` | Missing required fields | Check field-level errors |
| `CONVERSION_ERROR` | Invalid note names, step out of range | Validate before import |
| `NETWORK_ERROR` | Upload failed | Retry with exponential backoff |
| `TIMEOUT` | Request took too long | Check connection, retry |

### Error Report Format

```json
{
  "timestamp": "2024-03-06T12:00:00Z",
  "errors": [
    {
      "type": "VALIDATION_ERROR",
      "field": "globals.tempo",
      "message": "Tempo must be between 30 and 300",
      "value": 450
    }
  ],
  "inputPreview": "{ \"meta\": { ... } }"
}
```

---

## 10. Phase Roadmap

### Phase 1: Basic Importer ✅ COMPLETE
- [x] AISongImporter.ts with validation
- [x] AISongModal.tsx with paste/drop
- [x] CloudStorage.ts integration
- [x] plan.md architecture document

### Phase 2: Enhanced Collaboration ✅ COMPLETE (Today)
- [x] **Version History**: Track AI generations with `VersionEntry` system
- [x] **Auto-save to Cloud**: `songs/ai-generated/` folder with retry logic
- [x] **Preview Pane**: Pattern visualization, complexity scoring
- [x] **Multi-Agent Prompts**: Optimized templates for Claude, Gemini, Jules, Copilot, Grok
- [x] **Enhanced Modal**: Progress bar, "Try with Example", validation feedback
- [x] **Specialized Storage**: AISongStorage.ts with search, versioning, metadata

### Phase 3: Advanced Features (Next)
- [ ] **.rbs Import**: Parse ReBirth RB-338 files
  - TB-303 pattern conversion
  - TR-808/909 drum patterns
  - PCF (Pattern Controlled Filter) import
- [ ] **Automation Lanes**: Import parameter automation curves
- [ ] **Real-time Collaboration**: Multiple AIs editing simultaneously
- [ ] **Song Mode**: Pattern chains and arrangement import
- [ ] **FX Mapping**: Delay, distortion, reverb settings

### Phase 4: AI Ecosystem (Future)
- [ ] **Plugin API**: Allow custom AI agents
- [ ] **Marketplace**: Share AI-generated songs
- [ ] **Training Data**: Fine-tune models on Hyphon songs
- [ ] **Live Collaboration**: AIs jamming in real-time

---

## Quick Reference

### Import Flow
```
User → Paste JSON → Validate → Preview → Upload → Play
```

### API Endpoints
```
POST /api/songs          # Upload new song
GET  /api/songs          # List songs
GET  /api/songs/:id      # Get specific song
```

### Key Files
| File | Purpose |
|------|---------|
| `AISongImporter.ts` | Convert AI format → Hyphon |
| `AISongStorage.ts` | Cloud storage for AI songs |
| `versioning.ts` | Version history management |
| `AISongModal.tsx` | UI for import/preview |

---

*This document serves as the single source of truth for AI agents collaborating on Hyphon song generation.*
