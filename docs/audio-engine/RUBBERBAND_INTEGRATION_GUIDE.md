# Rubber Band Enhancement Integration Guide

This guide demonstrates how to use the Phoneme-Aware Time Stretching (Section 3) and Formant Shifting (Section 4) features.

## Overview

The `SingingVoice` class now supports:
- **Phoneme-aware time stretching**: Selectively stretches vowels while preserving consonant timing for natural articulation
- **Formant shifting**: Independent control of vocal character (male/female/child/etc.) without affecting pitch

## Basic Setup

### Enabling Features

```typescript
import { SingingVoice } from './engines/SingingVoice';

const audioContext = new AudioContext();

// Create SingingVoice with features enabled
const voice = new SingingVoice(audioContext, {
    useHighQuality: true,
    preserveFormants: true,
    enablePhonemeStretching: true,  // Enable Section 3
    enableFormantShifting: true,    // Enable Section 4
    voiceCharacter: 'female'        // Initial voice character
});

// Initialize the worklet
await voice.initWorklet();
```

## Section 3: Phoneme-Aware Time Stretching

### Basic Usage

```typescript
// 1. Load TTS audio
const ttsAudio = await generateTTSAudio("hello world");

// 2. Align phonemes
const alignment = await voice.alignPhonemes(ttsAudio, "hello world");

if (alignment) {
    console.log('Phonemes:', alignment.phonemes);
    // Output: [
    //   { phoneme: 'H', start: 0.0, end: 0.05, isVowel: false },
    //   { phoneme: 'EH', start: 0.05, end: 0.15, isVowel: true },
    //   ...
    // ]
}

// 3. Set cached audio
voice.setCachedAudio('mid', ttsAudio);

// 4. Send phoneme data to worklet with target duration
voice.sendPhonemeDataToWorklet(2.0); // Target 2 seconds

// 5. Play with pitch shifting
voice.setPitchFromMidi(64); // E4
voice.connect(audioContext.destination);
```

### Advanced: External Alignment Service

If you have a Montreal Forced Aligner (MFA) service:

```typescript
const voice = new SingingVoice(audioContext, {
    enablePhonemeStretching: true,
    phonemeAlignerUrl: 'http://localhost:5000/align'
});

// The aligner will automatically use the external service
const alignment = await voice.alignPhonemes(ttsAudio, "hello world");
```

### Custom Stretch Ratios

```typescript
const aligner = voice.getPhonemeAligner();
if (aligner && alignment) {
    // Calculate custom ratios
    const ratios = aligner.calculateStretchRatios(
        alignment.phonemes,
        3.0 // Target 3 seconds
    );
    
    // Vowels will have higher ratios, consonants near 1.0
    console.log('Stretch ratios:', ratios);
}
```

## Section 4: Formant Shifting

### Voice Character Presets

```typescript
// Available characters: 'default', 'male', 'female', 'child', 'deep', 'bright'

// Transform male to female
voice.setVoiceCharacter('female', 'male');

// Transform to child voice
voice.setVoiceCharacter('child');
```

### Real-time Morphing

```typescript
const shifter = voice.getFormantShifter();
if (shifter) {
    // Morph smoothly between characters
    for (let t = 0; t <= 1.0; t += 0.1) {
        const shift = shifter.interpolateCharacters('male', 'female', t);
        shifter.updateFilterChain(shift);
        await sleep(100); // Wait 100ms between steps
    }
}
```

### Custom Formant Control

```typescript
const shifter = voice.getFormantShifter();
if (shifter) {
    // Manual formant shift (in semitones)
    const customShift = {
        f1Shift: 3,   // First formant up 3 semitones
        f2Shift: 5,   // Second formant up 5 semitones
        f3Shift: 4    // Third formant up 4 semitones
    };
    
    shifter.createFilterChain(customShift);
}
```

### Compensating Pitch Shift

When using Rubber Band's pitch shifting, you can preserve the original timbre:

```typescript
const shifter = voice.getFormantShifter();
if (shifter) {
    const pitchShiftSemitones = 7; // Perfect fifth up
    
    // Pitch up the audio
    voice.setPitchFromMidi(67); // G4 from C4
    
    // Compensate formants to preserve timbre
    const compensatory = shifter.calculateCompensatoryShift(pitchShiftSemitones);
    shifter.createFilterChain(compensatory);
}
```

## Combined Usage

Using both features together:

```typescript
// Setup
const voice = new SingingVoice(audioContext, {
    enablePhonemeStretching: true,
    enableFormantShifting: true,
    voiceCharacter: 'female'
});

await voice.initWorklet();

// Load and process TTS
const ttsAudio = await generateTTSAudio("singing words");

// 1. Align phonemes
await voice.alignPhonemes(ttsAudio, "singing words");

// 2. Set voice character
voice.setVoiceCharacter('female', 'default');

// 3. Load audio and send phoneme data
voice.setCachedAudio('mid', ttsAudio);
voice.sendPhonemeDataToWorklet(2.5); // 2.5 second target

// 4. Connect with formant filtering
voice.connectOutput(audioContext.destination);

// 5. Play
voice.setPitchFromMidi(64); // E4
```

## Integration with AudioWorklet

The `RubberBandProcessor` worklet receives phoneme data via messages:

```typescript
// In rubberband-processor.ts (handled automatically by SingingVoice)
case 'setPhonemeData':
    // sharedBuffer contains:
    // [numPhonemes, start1, end1, isVowel1, ratio1, start2, end2, isVowel2, ratio2, ...]
    const phonemeBuffer = new Float32Array(data.sharedBuffer);
    const numPhonemes = phonemeBuffer[0];
    
    // Process each phoneme region with appropriate time ratio
    for (let i = 0; i < numPhonemes; i++) {
        const baseIndex = 1 + i * 4;
        const startSample = phonemeBuffer[baseIndex];
        const endSample = phonemeBuffer[baseIndex + 1];
        const isVowel = phonemeBuffer[baseIndex + 2] > 0.5;
        const timeRatio = phonemeBuffer[baseIndex + 3];
        
        // Apply selective stretching
        if (isVowel) {
            rubberBand.setTimeRatio(timeRatio);
        } else {
            rubberBand.setTimeRatio(1.0); // Keep consonants natural
        }
        
        // Process this region...
    }
    break;
```

## Configuration Options

### SingingVoiceConfig

```typescript
interface SingingVoiceConfig {
    useHighQuality?: boolean;              // Use Finer engine (higher CPU)
    preserveFormants?: boolean;            // Preserve formants during pitch shift
    channels?: number;                     // Audio channels (default: 1)
    bufferSize?: number;                   // Ring buffer size (default: 16384)
    enablePhonemeStretching?: boolean;     // Enable Section 3 features
    enableFormantShifting?: boolean;       // Enable Section 4 features
    voiceCharacter?: VoiceCharacter;       // Initial voice character
    phonemeAlignerUrl?: string;            // External MFA service URL
}
```

### Voice Characters

- **default**: Neutral voice formants
- **male**: Lower formants (F1=400Hz, F2=1200Hz, F3=2400Hz)
- **female**: Higher formants (F1=600Hz, F2=1800Hz, F3=2800Hz)
- **child**: Highest formants (F1=700Hz, F2=2100Hz, F3=3100Hz)
- **deep**: Very low formants for bass voice
- **bright**: Higher formants for brighter timbre

## Performance Considerations

1. **Phoneme alignment** is CPU-intensive. Consider:
   - Pre-computing alignments for static content
   - Using cached results
   - External MFA service for accuracy vs local estimation for speed

2. **Formant shifting** uses Web Audio API filters (main thread):
   - Minimal CPU impact (native implementation)
   - Can be updated in real-time
   - No WASM overhead

3. **Combined processing**:
   - Phoneme data sent once via SharedArrayBuffer (zero-copy)
   - Formant filters applied in parallel
   - Total overhead: ~10-20% CPU on modern hardware

## Troubleshooting

### Phoneme alignment returns empty results
```typescript
// Check if enabled
const aligner = voice.getPhonemeAligner();
if (!aligner) {
    console.error('PhonemeAligner not enabled in config');
}

// Check audio and text
const result = await voice.alignPhonemes(audio, text);
if (result.phonemes.length === 0) {
    console.warn('No phonemes detected. Check audio quality and text.');
}
```

### Formant shifting not audible
```typescript
// Ensure connection includes formant shifter
voice.connectOutput(destination); // Uses shifter if enabled

// Check if shifter is active
const shifter = voice.getFormantShifter();
if (shifter) {
    const shift = shifter.getCurrentShift();
    console.log('Active shift:', shift);
}
```

### Audio artifacts
```typescript
// Reduce stretch ratios
const ratios = aligner.calculateStretchRatios(phonemes, targetDuration);
// Ratios are clamped to [0.5, 3.0] automatically

// Use higher quality settings
const voice = new SingingVoice(audioContext, {
    useHighQuality: true  // Enables Finer engine
});
```

## Next Steps

- Explore `HybridNeuralPipeline.ts` for neural vocoding (Section 6)
- Check `LatencyCompensator.ts` for MIDI sync (Section 9)
- See `ArtifactDetector.ts` for quality monitoring (Section 10)

## References

- RUBBERBAND_ENHANCEMENT_PLAN.md - Full enhancement plan
- RUBBERBAND_DESIGN.md - Architectural context
- [Montreal Forced Aligner](https://montreal-forced-aligner.readthedocs.io/) - External phoneme alignment
- [Web Audio API BiquadFilterNode](https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode) - Formant filtering
