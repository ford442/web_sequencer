# Offline Multisample Generator Design

## Problem Statement

Current sampler workflow is frustrating for song building:

1. **Standard Mode**: Completely ignores MIDI note - only uses `playbackSpeed` knob. No pitch tracking.
2. **Stretch Mode**: Uses real-time RubberBand (SingingVoice) which taxes CPU during playback.
3. **Workflow**: Must manually tweak speed knob AND switch modes to get pitch changes.

## Solution: Offline Multisample Generator

When you drop a sample or generate TTS, the engine **pre-renders** pitch-shifted versions using high-quality offline RubberBand processing. This gives you:

- ✅ Instant playback with correct pitch (no speed knob needed)
- ✅ Zero real-time CPU drain from pitch shifting
- ✅ Natural pitch changes without "chipmunk effect"
- ✅ Works with both sequencer notes AND live keyboard

---

## Architecture

### 1. New State Structure

```typescript
// New: Sample bank holds multiple pitch variations
interface MultisampleBank {
    baseBuffer: AudioBuffer;           // Original sample
    pitchBank: Map<number, AudioBuffer>; // MIDI note → pre-rendered buffer
    isProcessing: boolean;             // Is background job running?
    processingProgress: number;        // 0.0 - 1.0
    rootNote: number;                  // Base MIDI note (default: 60 = C4)
}

// Updated SamplerState
interface SamplerState {
    loadedSampleBanks: Map<string, MultisampleBank>;  // Changed from Map<string, AudioBuffer>
    vocalAlignments: Map<string, AlignmentResult>;
    nextNoteId: number;
    activeNotes: Map<number, { source: AudioBufferSourceNode; envGain: GainNode }>;
}
```

### 2. Background Processing Engine

```typescript
// src/engines/MultisampleGenerator.ts
export class MultisampleGenerator {
    private audioContext: AudioContext;
    private rubberbandWasm: ArrayBuffer | null = null;
    
    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
    }
    
    /**
     * Generate pitch-shifted versions of a sample
     * Uses OfflineAudioContext for background processing
     */
    async generateMultisamples(
        sourceBuffer: AudioBuffer,
        options: {
            rootNote?: number;      // Base MIDI note (default: 60)
            range?: [number, number]; // Semitone range (default: [-12, 12])
            preserveFormants?: boolean;
        },
        onProgress: (progress: number) => void
    ): Promise<Map<number, AudioBuffer>> {
        const { rootNote = 60, range = [-12, 12], preserveFormants = true } = options;
        const pitchBank = new Map<number, AudioBuffer>();
        
        // Always store the original at root note
        pitchBank.set(rootNote, sourceBuffer);
        
        const totalSteps = range[1] - range[0] + 1;
        let currentStep = 0;
        
        for (let semitones = range[0]; semitones <= range[1]; semitones++) {
            const targetMidi = rootNote + semitones;
            
            if (semitones === 0) {
                currentStep++;
                onProgress(currentStep / totalSteps);
                continue;
            }
            
            // Use offline processing for high quality pitch shift
            const processedBuffer = await this.processOffline(
                sourceBuffer,
                semitones,
                preserveFormants
            );
            
            pitchBank.set(targetMidi, processedBuffer);
            
            currentStep++;
            onProgress(currentStep / totalSteps);
        }
        
        return pitchBank;
    }
    
    private async processOffline(
        sourceBuffer: AudioBuffer,
        semitones: number,
        preserveFormants: boolean
    ): Promise<AudioBuffer> {
        // Option A: Use RubberBand WASM directly on raw audio data
        // Option B: Use OfflineAudioContext with SingingVoice (simpler)
        
        // Implementation uses OfflineAudioContext for cleaner integration
        const offlineCtx = new OfflineAudioContext(
            sourceBuffer.numberOfChannels,
            sourceBuffer.duration * sourceBuffer.sampleRate * 1.5, // Extra headroom
            sourceBuffer.sampleRate
        );
        
        // Create a temporary SingingVoice instance for offline processing
        const voice = new SingingVoice(offlineCtx, {
            useHighQuality: true,  // Max quality since it's offline
            preserveFormants
        });
        
        await voice.initWorklet(false, this.rubberbandWasm || undefined);
        
        // Calculate pitch ratio
        const pitchRatio = Math.pow(2, semitones / 12);
        voice.setPitch(pitchRatio);
        voice.setTimeRatio(1.0); // Keep duration same
        
        // Connect to offline context
        voice.connectOutput(offlineCtx.destination);
        
        // Load and process
        const audioData = sourceBuffer.getChannelData(0);
        voice.loadBuffer(audioData);
        voice.play();
        
        // Render (this is the "progress bar" phase)
        const renderedBuffer = await offlineCtx.startRendering();
        
        // Cleanup
        voice.disconnectOutput();
        
        return renderedBuffer;
    }
}
```

### 3. Updated Playback Logic

```typescript
// In useAudioEngine.ts - playSampler function

const playSampler = (params: SamplerBankParams, note: string | string[], time: number, ...) => {
    const sampleBank = loadedSampleBanksRef.current.get(params.sampleName);
    if (!sampleBank || !masterGainRef.current) return;
    
    const notes = Array.isArray(note) ? note : [note];
    
    notes.forEach(noteStr => {
        const targetMidi = noteToMidi(noteStr);
        
        // --- NEW: Check for pre-rendered multisample ---
        if (sampleBank.pitchBank.has(targetMidi)) {
            const buffer = sampleBank.pitchBank.get(targetMidi)!;
            
            // Standard AudioBufferSourceNode playback - ZERO CPU overhead!
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = params.playbackSpeed; // Only for effect/speed
            
            const gain = context.createGain();
            gain.gain.value = params.volume;
            
            // ... filter, drive, etc ...
            
            source.connect(filter);
            filter.connect(shaper);
            shaper.connect(gain);
            gain.connect(masterGainRef.current!);
            
            source.start(time);
            return;
        }
        
        // --- FALLBACK: Old-school repitching for out-of-range notes ---
        if (sampleBank.baseBuffer) {
            const source = context.createBufferSource();
            source.buffer = sampleBank.baseBuffer;
            
            const rootMidi = params.rootNote ?? 60;
            const pitchRatio = Math.pow(2, (targetMidi - rootMidi) / 12);
            source.playbackRate.value = params.playbackSpeed * pitchRatio;
            
            // ... rest of standard playback ...
        }
    });
};

// --- Updated noteOnSampler for live keyboard ---
const noteOnSampler = (params: SamplerBankParams, note: string, time?: number): number | null => {
    const now = time || context.currentTime;
    const sampleBank = loadedSampleBanksRef.current.get(params.sampleName);
    if (!sampleBank || !masterGainRef.current) return null;
    
    const targetMidi = noteToMidi(note);
    
    // --- NEW: Use pre-rendered multisample if available ---
    if (sampleBank.pitchBank.has(targetMidi)) {
        const buffer = sampleBank.pitchBank.get(targetMidi)!;
        
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = params.playbackSpeed;
        
        const gain = context.createGain();
        gain.gain.value = params.volume;
        
        source.connect(gain);
        gain.connect(masterGainRef.current);
        source.start(now);
        
        const id = nextSamplerNoteId.current++;
        activeSamplerNotes.current.set(id, { source, envGain: gain });
        return id;
    }
    
    // --- FALLBACK: Repitching ---
    if (sampleBank.baseBuffer) {
        const source = context.createBufferSource();
        source.buffer = sampleBank.baseBuffer;
        
        const rootMidi = params.rootNote ?? 60;
        const pitchRatio = Math.pow(2, (targetMidi - rootMidi) / 12);
        source.playbackRate.value = params.playbackSpeed * pitchRatio;
        
        // ...
    }
    
    return null;
};
```

### 4. Updated Sample Loading

```typescript
// In useAudioEngine.ts

const multisampleGeneratorRef = useRef<MultisampleGenerator | null>(null);

// Initialize during audio setup
multisampleGeneratorRef.current = new MultisampleGenerator(context);

// New: Load sample with progress callback
const loadSampleToEngine = async (
    name: string, 
    buffer: AudioBuffer,
    onProgress?: (progress: number) => void
) => {
    // 1. Immediately store for instant playback (using repitching initially)
    const sampleBank: MultisampleBank = {
        baseBuffer: buffer,
        pitchBank: new Map([[60, buffer]]), // Default C4
        isProcessing: true,
        processingProgress: 0,
        rootNote: 60
    };
    
    loadedSampleBanksRef.current.set(name, sampleBank);
    
    // 2. Start background multisample generation
    if (multisampleGeneratorRef.current && onProgress) {
        onProgress(0.01);
        
        try {
            const pitchBank = await multisampleGeneratorRef.current.generateMultisamples(
                buffer,
                {
                    rootNote: 60,
                    range: [-12, 12], // 2 octaves (C3 to C5)
                    preserveFormants: true
                },
                (progress) => {
                    sampleBank.processingProgress = progress;
                    onProgress(progress);
                }
            );
            
            // Update with complete pitch bank
            sampleBank.pitchBank = pitchBank;
            sampleBank.isProcessing = false;
            sampleBank.processingProgress = 1.0;
            
            onProgress(1.0);
        } catch (err) {
            console.error('Multisample generation failed:', err);
            sampleBank.isProcessing = false;
            onProgress(-1); // Error state
        }
    }
};
```

---

## UI Changes

### SamplerPanel.tsx

```typescript
// Add progress state
const [sampleProcessingState, setSampleProcessingState] = useState<{
    bankIdx: number;
    progress: number;
    isProcessing: boolean;
} | null>(null);

// Update load handlers
const handleLoadSample = useCallback(async (name: string, buffer: AudioBuffer) => {
    if (!audioEngine) return;
    
    setSampleProcessingState({
        bankIdx: activeBankIdx,
        progress: 0,
        isProcessing: true
    });
    
    await audioEngine.loadSampleToEngine(name, buffer, (progress) => {
        if (progress === 1.0) {
            setSampleProcessingState(null);
        } else if (progress === -1) {
            setSampleProcessingState(prev => prev ? { ...prev, isProcessing: false } : null);
            setStatus('Processing Error');
        } else {
            setSampleProcessingState({
                bankIdx: activeBankIdx,
                progress,
                isProcessing: true
            });
        }
    });
}, [audioEngine, activeBankIdx]);

// Add progress bar UI
{sampleProcessingState?.bankIdx === activeBankIdx && (
    <div className="mt-2 bg-gray-800 rounded p-2">
        <div className="flex items-center justify-between text-[9px] text-gray-400 mb-1">
            <span>Generating Multisamples...</span>
            <span>{Math.round(sampleProcessingState.progress * 100)}%</span>
        </div>
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div 
                className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all duration-200"
                style={{ width: `${sampleProcessingState.progress * 100}%` }}
            />
        </div>
    </div>
)}
```

### New Visual Indicator

Add a small icon on bank tabs to show multisample status:

```typescript
// In bank tab render
<button className="...">
    {label}
    {sampleBank?.pitchBank.size > 1 && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cyan-500 rounded-full" 
              title="Multisample Ready" />
    )}
    {sampleBank?.isProcessing && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-yellow-500 rounded-full animate-pulse" 
              title="Processing..." />
    )}
</button>
```

---

## Mode Comparison

| Feature | Standard (Old) | Stretch (Current) | Multisample (New) |
|---------|---------------|-------------------|-------------------|
| Pitch Tracking | ❌ None (speed only) | ✅ Note-based | ✅ Note-based |
| CPU Usage | Low | High (real-time RB) | Low (pre-rendered) |
| Duration Change | Yes (with pitch) | No (time-stretch) | No (preserved) |
| Latency | Zero | Medium | Zero |
| Quality | Good (no artifacts) | Excellent | Excellent |
| Use Case | Drums/FX | Vocals/Melodic | Song building |

---

## Implementation Phases

### Phase 1: Core Infrastructure
1. Create `MultisampleGenerator` class
2. Update `SamplerState` interface
3. Update `loadSampleToEngine` with progress callback

### Phase 2: Playback Updates
1. Update `playSampler` to check pitchBank
2. Update `noteOnSampler` for live keyboard
3. Add fallback logic for out-of-range notes

### Phase 3: UI Integration
1. Add progress bar to SamplerPanel
2. Add status indicators to bank tabs
3. Add "Regenerate Multisample" button

### Phase 4: Polish
1. Configurable range (±12, ±24 semitones)
2. Configurable quality (Fast/Standard/Elastic)
3. Export/import multisample banks

---

## Technical Considerations

### Memory Usage

- Each pitch variation is a full AudioBuffer
- For a 2-second sample at 44.1kHz: ~352KB per pitch
- 25 pitches (2 octaves): ~8.8MB per bank
- 8 banks max: ~70MB total (acceptable)

### Optimization Options

```typescript
// Reduce memory by only generating used pitches
const usedPitches = extractPitchesFromSequencer(sequence);
await generator.generateMultisamples(buffer, {
    onlyPitches: usedPitches, // [60, 62, 64, 67, 69] etc
});

// Or use lower quality for draft, regenerate for export
await generator.generateMultisamples(buffer, {
    quality: isDraft ? 'Fast' : 'Elastic'
});
```

### Fallback Strategy

If offline processing fails (WASM not loaded, etc.):

```typescript
// Graceful fallback to simple repitching
pitchBank.set(targetMidi, resampleWithPlaybackRate(baseBuffer, semitones));
```

---

## Benefits Summary

1. **Drop & Play**: Load sample, instantly play any pitch from sequencer or keyboard
2. **No Speed Knob**: Pitch is automatic based on note
3. **No Mode Switching**: Always uses pre-rendered multisamples
4. **Zero Latency**: Standard AudioBufferSourceNode playback
5. **Song Building Focused**: Background processing fits composition workflow
6. **CPU Efficient**: No real-time pitch calculation during playback
