# TTS Per-Bank Feature - Visual Guide

## Before and After Comparison

### BEFORE (Single Global TTS Text)
```
┌─────────────────────────────────────────────┐
│  SAMPLER PANEL                              │
├─────────────────────────────────────────────┤
│  Banks: [1] [2] [3] [4] [5] [6] [7] [8]     │
│         ^^^ Active Bank = 1                  │
├─────────────────────────────────────────────┤
│  TTS: [Hello World_____________] [GEN]      │
│       ^^^ SHARED across all banks           │
└─────────────────────────────────────────────┘

❌ Problem:
   - Switching to Bank 2 → shows same "Hello World"
   - Changing text affects ALL banks
   - Can't have different phrases per bank
```

### AFTER (Per-Bank TTS Text)
```
┌─────────────────────────────────────────────┐
│  SAMPLER PANEL                              │
├─────────────────────────────────────────────┤
│  Banks: [1] [2] [3] [4] [5] [6] [7] [8]     │
│         ^^^ Active Bank = 1                  │
├─────────────────────────────────────────────┤
│  TTS: [Alpha___________________] [GEN]      │
│       ^^^ Shows Bank 1's text               │
└─────────────────────────────────────────────┘

✅ Solution:
   - Bank 1: "Alpha"
   - Bank 2: "Bravo"  
   - Bank 3: "Charlie"
   - Each bank stores its own text
   - Switching shows correct text
```

## Data Structure

### State in App.tsx
```typescript
// Array of 8 strings, one per bank
const [ttsPhrases, setTtsPhrases] = useState<string[]>([
    "Hello World",  // Bank 0
    "Hello World",  // Bank 1
    "Hello World",  // Bank 2
    "Hello World",  // Bank 3
    "Hello World",  // Bank 4
    "Hello World",  // Bank 5
    "Hello World",  // Bank 6
    "Hello World",  // Bank 7
]);

// Current active bank (0-7)
const [activeSamplerBank, setActiveSamplerBank] = useState(0);
```

### Props to SamplerPanel
```typescript
<SamplerPanel
    ttsPhrases={ttsPhrases}              // Pass entire array
    onTtsPhraseChange={setTtsPhrases}    // Update callback
    activeBankIdx={activeSamplerBank}    // Current bank
    // ... other props
/>
```

### Inside SamplerPanel
```typescript
// Get text for current bank
const currentTtsText = ttsPhrases[activeBankIdx] || "Hello World";

// Update text for current bank
const setCurrentTtsText = (text: string) => {
    const newPhrases = [...ttsPhrases];  // Copy array
    newPhrases[activeBankIdx] = text;    // Update one index
    onTtsPhraseChange(newPhrases);       // Notify parent
};
```

## User Interaction Flow

```
┌─────────────────────────────────────────────────────┐
│                   USER ACTIONS                       │
└─────────────────────────────────────────────────────┘
                          │
         ┌────────────────┴────────────────┐
         │                                  │
    ┌────▼─────┐                     ┌─────▼────┐
    │ Type in  │                     │  Switch  │
    │TTS field │                     │   Bank   │
    └────┬─────┘                     └─────┬────┘
         │                                  │
    ┌────▼──────────────────┐         ┌────▼────────────────────┐
    │ setCurrentTtsText()   │         │  onBankChange(idx)      │
    │ - Create new array    │         │  - Update activeBankIdx │
    │ - Update [bankIdx]    │         └────┬────────────────────┘
    └────┬──────────────────┘              │
         │                                  │
    ┌────▼──────────────────┐         ┌────▼────────────────────┐
    │ onTtsPhraseChange()   │         │  Re-render component    │
    │ - Update App state    │         │  - Read new bank's text │
    └────┬──────────────────┘         └────┬────────────────────┘
         │                                  │
         └──────────┬───────────────────────┘
                    │
           ┌────────▼─────────┐
           │  Input field     │
           │  shows updated   │
           │  text            │
           └──────────────────┘
```

## Example Usage Scenario

```
Step 1: User selects Bank 1
┌─────────────────────────────┐
│ Banks: [1*][2][3][4][5][6][7][8] │
│ TTS: [Hello World_] [GEN]   │
└─────────────────────────────┘

Step 2: User types "Kick drum"
┌─────────────────────────────┐
│ Banks: [1*][2][3][4][5][6][7][8] │
│ TTS: [Kick drum___] [GEN]   │
└─────────────────────────────┘

Step 3: User clicks GEN → TTS generates audio for Bank 1

Step 4: User clicks Bank 2
┌─────────────────────────────┐
│ Banks: [1][2*][3][4][5][6][7][8] │
│ TTS: [Hello World_] [GEN]   │  ← Back to default
└─────────────────────────────┘

Step 5: User types "Snare hit"
┌─────────────────────────────┐
│ Banks: [1][2*][3][4][5][6][7][8] │
│ TTS: [Snare hit___] [GEN]   │
└─────────────────────────────┘

Step 6: User clicks GEN → TTS generates audio for Bank 2

Step 7: User clicks Bank 1 again
┌─────────────────────────────┐
│ Banks: [1*][2][3][4][5][6][7][8] │
│ TTS: [Kick drum___] [GEN]   │  ← Text preserved!
└─────────────────────────────┘
```

## Save File Format

```json
{
  "version": 1,
  "pattern": { /* ... */ },
  "params": {
    "synthA": { /* ... */ },
    "synthB": { /* ... */ },
    "sampler": [ /* 8 banks */ ]
  },
  "ttsPhrases": [
    "Kick drum",    // Bank 0
    "Snare hit",    // Bank 1
    "Hi hat",       // Bank 2
    "Hello World",  // Bank 3
    "Hello World",  // Bank 4
    "Hello World",  // Bank 5
    "Hello World",  // Bank 6
    "Hello World"   // Bank 7
  ],
  "embeddedSamples": { /* ... */ },
  /* ... other data ... */
}
```

## Code Organization

```
src/
├── types.ts
│   └── SavedSongData interface
│       └── + ttsPhrases?: string[]
│
├── App.tsx
│   ├── State: ttsPhrases
│   ├── getSongData() → includes ttsPhrases
│   ├── loadCloudData() → restores ttsPhrases
│   └── Pass to <SamplerPanel />
│
└── components/
    └── SamplerPanel.tsx
        ├── Props: ttsPhrases, onTtsPhraseChange
        ├── Computed: currentTtsText
        ├── Helper: setCurrentTtsText()
        └── Input: value={currentTtsText}
```

## Key Benefits

### 1. Independent Bank Content
```
Bank 1: "Kick"     → Generate → Kick.wav
Bank 2: "Snare"    → Generate → Snare.wav
Bank 3: "Hi-hat"   → Generate → HiHat.wav
Bank 4: "Clap"     → Generate → Clap.wav
```

### 2. Text Persistence
```
Session Start → Set texts → Switch banks → Text preserved
Save project  → Close app  → Load project  → Text restored
```

### 3. Workflow Improvement
```
BEFORE:
- Type "Kick"
- Generate
- Type "Snare" (overwrites "Kick")
- Generate
- Want to regenerate "Kick"? Must retype! ❌

AFTER:
- Bank 1: Type "Kick", Generate
- Bank 2: Type "Snare", Generate
- Switch to Bank 1 → "Kick" still there! ✅
- Can regenerate without retyping
```

## Validation & Safety

### Bounds Checking
```typescript
// Validates index is 0-7
if (activeBankIdx < 0 || activeBankIdx >= 8) {
    console.warn(`Invalid bank index: ${activeBankIdx}`);
    return;
}
```

### Array Length Normalization
```typescript
// Ensures array has exactly 8 elements
if (ttsPhrases.length !== 8) {
    const normalized = Array(8).fill("Hello World");
    ttsPhrases.forEach((phrase, idx) => {
        if (idx < 8) normalized[idx] = phrase;
    });
}
```

### Fallback Values
```typescript
// Safe access with fallback
const text = ttsPhrases[index] || "Hello World";
```

## Testing Coverage

```
✓ Display correct text for active bank
✓ Update only current bank's text
✓ Preserve text when switching banks
✓ Render all 8 bank buttons
✓ Highlight active bank
✓ Handle invalid bank indices
✓ Handle empty/incomplete arrays
✓ TypeScript type safety
✓ No security vulnerabilities
```

## Summary

This feature transforms the TTS workflow from:
- ❌ One global text field (lost when switching)

To:
- ✅ 8 independent text fields (preserved per bank)
- ✅ Full save/load support
- ✅ Robust validation
- ✅ Backward compatible
- ✅ Well tested

The implementation follows best practices:
- Minimal code changes
- Type-safe TypeScript
- Comprehensive validation
- Clear data flow
- Excellent test coverage
