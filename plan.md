# Hyphon AI Song Import System – Architecture Plan

## Overview

Enable external AI agents (Jules, Gemini, Claude, Copilot, etc.) to write custom songs that can be imported into Hyphon. The system provides a standardized JSON format that any AI can generate, which Hyphon then converts to its internal song format and stores via the existing Hugging Face storage_manager API.

---

## 1. How External AIs Generate Songs

### Standard JSON Format (AISongData)

```typescript
interface AISongData {
  // Metadata
  meta: {
    title: string;
    author: string;           // AI name + user prompt hash
    version: "1.0";
    createdAt: string;        // ISO 8601
    generator: "claude-3-opus" | "gemini-pro" | "jules" | "copilot" | string;
    prompt: string;           // Original user prompt (truncated if needed)
    tags?: string[];          // Genre, mood, style tags
  };

  // Global settings
  globals: {
    tempo: number;            // BPM (30-300)
    timeSignature: [number, number];  // [4, 4], [3, 4], etc.
    swing?: number;           // 0-100 (50 = no swing)
  };

  // Track patterns (simplified representation)
  tracks: {
    // TB-303 style bass/lead
    synthA?: {
      notes: NoteEvent[];
      params: Partial<SynthParams>;
    };
    synthB?: {
      notes: NoteEvent[];
      params: Partial<SynthParams>;
    };
    bass2?: {                 // Second 303
      notes: NoteEvent[];
      params: Partial<Bass2Params>;
    };
    
    // Drum machines (TR-808/909 style)
    kick?: boolean[];         // 16 or 32 step pattern
    snare?: boolean[];
    closedHat?: boolean[];
    openHat?: boolean[];
    
    // Sampler (8 banks)
    sampler?: SamplerBankData[];
  };
}

// Note event (simplified for AI generation)
interface NoteEvent {
  step: number;             // 0-31 (position in pattern)
  note: string;             // "C4", "F#3", etc.
  velocity?: number;        // 0-1 (default: 0.8)
  length?: number;          // In steps (default: 1)
  accent?: boolean;         // For 303-style accent
  slide?: boolean;          // For 303-style slide
}

interface SamplerBankData {
  bankIndex: 0-7;
  steps: NoteEvent[];
  params?: Partial<SamplerBankParams>;
  ttsText?: string;         // For vocal synthesis
  sampleUrl?: string;       // URL to external sample (optional)
}
```

### Example AI-Generated Song

```json
{
  "meta": {
    "title": "Cyberpunk Chase",
    "author": "claude-3-opus:user-abc123",
    "version": "1.0",
    "createdAt": "2024-03-06T14:30:00Z",
    "generator": "claude-3-opus",
    "prompt": "Generate an intense cyberpunk chase scene with driving bass and urgent drums",
    "tags": ["cyberpunk", "chase", "electronic", "intense"]
  },
  "globals": {
    "tempo": 140,
    "timeSignature": [4, 4],
    "swing": 55
  },
  "tracks": {
    "synthA": {
      "notes": [
        {"step": 0, "note": "C3", "accent": true},
        {"step": 4, "note": "C3"},
        {"step": 8, "note": "Eb3", "accent": true},
        {"step": 12, "note": "F3"}
      ],
      "params": {
        "waveform": "303-saw",
        "filterCutoff": 3000,
        "filterResonance": 12
      }
    },
    "kick": [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    "snare": [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    "closedHat": [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true]
  }
}
```

---

## 2. Example Prompts for AIs

### For Claude (Anthropic)

```
You are a music sequencer AI. Generate a song in Hyphon format.

HYPHON SONG JSON SCHEMA:
- meta: {title, author, version, createdAt, generator, prompt, tags}
- globals: {tempo (BPM), timeSignature [num, den], swing (0-100)}
- tracks: {synthA, synthB, bass2, kick, snare, closedHat, openHat, sampler}

TRACK NOTES use this format:
{"step": 0-31, "note": "C4", "velocity": 0.8, "length": 1, "accent": false, "slide": false}

DRUM TRACKS are boolean arrays of 16 or 32 steps (true = hit, false = rest).

SYNTH PARAMS (all optional):
- waveform: "303-saw" | "303-sqr" | "sawtooth" | "square"
- filterCutoff: 200-8000 (Hz)
- filterResonance: 0-20
- decay: 0.1-2.0 (seconds)

Generate a {genre} song with {mood} feel at {tempo} BPM.
Return ONLY valid JSON matching the AISongData schema.
```

### For Gemini (Google)

```
Generate a song for the Hyphon web sequencer.

Output format: JSON with this structure:
{
  "meta": {"title": "...", "generator": "gemini-pro", ...},
  "globals": {"tempo": 128, "timeSignature": [4,4]},
  "tracks": {
    "synthA": {"notes": [...], "params": {...}},
    "kick": [true, false, ...],  // 16 steps
    ...
  }
}

The user wants: {description}

Generate appropriate patterns for all 8 tracks. Make it groovy!
```

### For Jules (Google's coding agent)

```
Write a Hyphon song file for me.

Use this TypeScript interface structure (return as JSON):

interface AISongData {
  meta: { title: string; generator: "jules"; prompt: string; };
  globals: { tempo: number; timeSignature: [number, number]; };
  tracks: {
    synthA?: { notes: Array<{step: number, note: string, accent?: boolean}> };
    kick?: boolean[];
    snare?: boolean[];
    closedHat?: boolean[];
  };
}

Create a {style} pattern with {characteristics}. 
Include at least synthA + drums.
```

### For GitHub Copilot

```
// Generate a Hyphon song object
// Genre: {genre}
// Tempo: {tempo} BPM
// Mood: {mood}

const song: AISongData = {
  meta: { title: "...", generator: "copilot", ... },
  globals: { tempo: ..., timeSignature: [4, 4] },
  tracks: {
    // Write your patterns here
  }
};
```

---

## 3. Integration with hf storage_manager API

### Current API Base
```typescript
const API_BASE_URL = "https://ford442-storage-manager.hf.space";
```

### Upload Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ AI generates│────▶│ AISongImporter   │────▶│ HyphonSong      │
│ JSON song   │     │ .convert()       │     │ (internal fmt)  │
└─────────────┘     └──────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ User gets   │◀────│ CloudStorage.    │◀────│ JSON payload    │
│ shareable   │     │ uploadItem()     │     │ {type: "song"}  │
│ link        │     │                  │     │                 │
└─────────────┘     └──────────────────┘     └─────────────────┘
```

### API Payload Structure

```typescript
const payload: CloudSongPayload = {
  name: aiSong.meta.title,
  author: aiSong.meta.author,
  description: `${aiSong.meta.generator}: ${aiSong.meta.prompt}`,
  type: 'song',
  data: hyphonSong  // The converted SavedSongData
};

// Upload
const result = await CloudStorage.uploadItem(payload);
// Returns: { success: true, id: "uuid-for-sharing" }
```

---

## 4. Alternative Import Methods

### Method A: Paste JSON (Modal)

```
┌─────────────────────────────────────────────┐
│  🎹 Import AI Song                           │
├─────────────────────────────────────────────┤
│                                             │
│  Source: [Dropdown]                          │
│  ├─ Paste JSON                              │
│  ├─ HuggingFace API                         │
│  ├─ Upload File                             │
│  └─ AI Generator (external)                 │
│                                             │
│  [When "Paste JSON" selected]               │
│  ┌─────────────────────────────────────────┐│
│  │ Paste AI-generated JSON here...        ││
│  │ {                                      ││
│  │   "meta": { ... },                     ││
│  │   ...                                  ││
│  │ }                                      ││
│  └─────────────────────────────────────────┘│
│                                             │
│  [Validate] [Import] [Cancel]               │
│                                             │
└─────────────────────────────────────────────┘
```

### Method B: Drag & Drop .json files

```typescript
// Support dragging .json files onto the sequencer
// Auto-detects AISongData format vs Hyphon native format
```

### Method C: Direct API (for integrations)

```typescript
// External apps can call:
POST https://hyphon.example.com/api/import-ai-song
Content-Type: application/json

{ aiSongData: {...}, saveToLibrary: true }
```

### Method D: URL Import (shareable links)

```
https://hyphon.example.com/?import=hf://ford442-storage-manager/songs/abc123
```

---

## 5. .rbs Support Roadmap

### Phase 1: Skeleton ✅ COMPLETE
- [x] Type definitions (RawRbsData, HyphonSong)
- [x] Parser skeleton with mock data
- [x] Importer skeleton with conversion logic
- [x] UI button (disabled)

### Phase 2: Basic Patterns (Next Sprint)
- [ ] Research actual ReBirth .rbs binary format
- [ ] Implement binary reader (magic bytes, sections)
- [ ] Parse TB-303 Pattern A/B (notes, accents, slides)
- [ ] Parse TR-808/909 drum patterns
- [ ] Parse PCF (Pattern Controlled Filter) settings
- [ ] Basic parameter mapping (cutoff, resonance, decay)

### Phase 3: Full Support
- [ ] Automation lane conversion
- [ ] Song mode / pattern chains
- [ ] Delay/distortion effects mapping
- [ ] Round-trip export (Hyphon → .rbs)

---

## 6. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI SONG IMPORT FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  EXTERNAL AI                                                             │
│  ┌──────────────┐                                                        │
│  │ User Prompt  │                                                        │
│  └──────┬───────┘                                                        │
│         │                                                                │
│         ▼                                                                │
│  ┌──────────────┐     ┌──────────────┐                                   │
│  │ AI generates │────▶│ AISongData   │                                   │
│  │ JSON song    │     │ (standard fmt)│                                  │
│  └──────────────┘     └──────┬───────┘                                   │
│                              │                                           │
│                              │ (JSON paste / API / file)                  │
│                              ▼                                           │
│  HYPHON CLIENT                                                         │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  ┌──────────────┐                                           │       │
│  │  │ Validate     │──Error──▶ Show validation errors          │       │
│  │  │ JSON schema  │                                           │       │
│  │  └──────┬───────┘                                           │       │
│  │         │ Valid                                              │       │
│  │         ▼                                                    │       │
│  │  ┌──────────────┐     ┌──────────────┐                       │       │
│  │  │ AISongImporter│────▶│ HyphonSong   │                       │       │
│  │  │ .convert()    │     │ (internal)   │                       │       │
│  │  └──────────────┘     └──────┬───────┘                       │       │
│  │                               │                              │       │
│  │                               ▼                              │       │
│  │  ┌──────────────────────────────────────────────┐           │       │
│  │  │ Option A: Load directly into sequencer       │           │       │
│  │  │ Option B: Save to HF storage_manager API     │           │       │
│  │  │ Option C: Export as .hyphon.json file        │           │       │
│  │  └──────────────────────────────────────────────┘           │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
│  HUGGINGFACE STORAGE                                                     │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐  │       │
│  │  │ CloudStorage │────▶│ POST /api/   │────▶│ Stored with  │  │       │
│  │  │ .uploadItem()│     │ songs        │     │ ID for share │  │       │
│  │  └──────────────┘     └──────────────┘     └──────────────┘  │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Security & Validation Plan

### JSON Schema Validation

```typescript
// Use Zod for runtime validation
import { z } from 'zod';

const NoteEventSchema = z.object({
  step: z.number().int().min(0).max(31),
  note: z.string().regex(/^[A-G][#b]?[0-8]$/),
  velocity: z.number().min(0).max(1).optional(),
  length: z.number().int().min(1).max(32).optional(),
  accent: z.boolean().optional(),
  slide: z.boolean().optional()
});

const AISongDataSchema = z.object({
  meta: z.object({
    title: z.string().min(1).max(100),
    author: z.string(),
    version: z.literal("1.0"),
    createdAt: z.string().datetime(),
    generator: z.string(),
    prompt: z.string().max(1000),
    tags: z.array(z.string()).optional()
  }),
  globals: z.object({
    tempo: z.number().int().min(30).max(300),
    timeSignature: z.tuple([z.number(), z.number()]),
    swing: z.number().min(0).max(100).optional()
  }),
  tracks: z.object({
    synthA: z.object({ notes: z.array(NoteEventSchema) }).optional(),
    synthB: z.object({ notes: z.array(NoteEventSchema) }).optional(),
    bass2: z.object({ notes: z.array(NoteEventSchema) }).optional(),
    kick: z.array(z.boolean()).length(z.union([z.literal(16), z.literal(32)])).optional(),
    snare: z.array(z.boolean()).length(z.union([z.literal(16), z.literal(32)])).optional(),
    closedHat: z.array(z.boolean()).length(z.union([z.literal(16), z.literal(32)])).optional(),
    openHat: z.array(z.boolean()).length(z.union([z.literal(16), z.literal(32)])).optional(),
    sampler: z.array(z.any()).optional() // SamplerBankData
  })
});

// Validate before conversion
const result = AISongDataSchema.safeParse(jsonData);
if (!result.success) {
  showValidationErrors(result.error.errors);
  return;
}
```

### Sanitization Rules

1. **String length limits**: All strings max 1000 chars
2. **Array limits**: Max 32 steps per pattern
3. **Numeric ranges**: Tempo 30-300, velocities 0-1
4. **Note validation**: Only valid note names (C4, F#3, etc.)
5. **No executable code**: JSON.parse only, no eval()

### Error Handling

```typescript
type ImportError = 
  | { type: 'VALIDATION_ERROR'; field: string; message: string }
  | { type: 'UNSUPPORTED_VERSION'; version: string }
  | { type: 'CONVERSION_ERROR'; track: string; details: string }
  | { type: 'STORAGE_ERROR'; message: string };
```

---

## 8. Implementation Checklist

### Step 1: Foundation ✅
- [x] Create plan.md (this document)

### Step 2: Core Implementation
- [ ] Create `src/importers/ai-song/` folder
- [ ] Define `AISongData` type in types.ts
- [ ] Create `AISongImporter.ts` with convert function
- [ ] Add Zod validation schema
- [ ] Create modal component for import UI
- [ ] Add "Import AI Song" button to toolbar
- [ ] Integrate with CloudStorage.uploadItem()

### Step 3: Testing
- [ ] Test with Claude-generated JSON
- [ ] Test with Gemini-generated JSON
- [ ] Test validation error handling
- [ ] Test HF storage integration

### Step 4: Documentation
- [ ] Write AI prompt templates (for users)
- [ ] Create example songs
- [ ] Document API for external integrations

---

## 9. Future Enhancements

- **AI Chat Integration**: Direct integration with Claude/Gemini APIs
- **Template Library**: Pre-made prompts for common genres
- **Collaborative Editing**: Multiple AIs contributing to same song
- **Version Control**: Track AI iterations on same prompt
- **Feedback Loop**: User ratings improve AI generation

---

*Document Version: 1.0*
*Last Updated: 2024-03-06*
*Author: Hyphon Architect*
