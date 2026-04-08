# Rubber Band Integration Enhancement Plan

This document outlines a comprehensive plan to expand and refine the Rubber Band audio effects integration in the `web_sequencer` repository, building on the existing TTS-to-singing pipeline. The goal is to move from basic parameter tuning to advanced hybrid techniques, improving vocal fidelity, expressiveness, and real-time performance while minimizing artifacts.

## Overview

The current implementation uses Supertonic TTS for raw speech generation, followed by Rubber Band for pitch shifting and time stretching. Enhancements focus on vocal-specific optimizations, multi-resolution processing, and hybrid neural approaches to achieve professional-grade singing synthesis.

---

## 1. Fine-Tune Rubber Band for Vocal Fidelity

Rubber Band's default settings are optimized for general audio. For singing, prioritize formant preservation and vocal transients.

### Key Options

```typescript
// In your AudioWorkletProcessor (src/audio-worklets/rubberband-processor.ts)
const options = {
  // Use the "finer" engine for better quality at cost of CPU
  engine: RubberBand.OptionEngineFiner,
  
  // CRITICAL: Preserve formants to avoid chipmunk effect
  formant: RubberBand.OptionFormantPreserved,
  
  // Process channels together for stereo coherence
  channels: RubberBand.OptionChannelsTogether,
  
  // Real-time mode with lookahead for lower latency
  realtime: RubberBand.OptionProcessRealTime,
  
  // Preserve transients (important for consonants like 't', 'k')
  transients: RubberBand.OptionTransientsMixed, // or "Crisp"
  
  // Pitch-coherent mode for monophonic voice
  phase: RubberBand.OptionPhaseLaminar
};

const rubberBand = new RubberBand(
  sampleRate,
  numChannels,
  options
);
```

### Pro Tip

- Use `OptionEngineFiner` for offline rendering of final mixes.
- Use `OptionEngineFast` for live preview to balance CPU usage.

---

## 2. Multi-Resolution Pitch Shifting

Avoid extreme shifts on single TTS samples by pre-generating multiple base pitches.

### Implementation

```typescript
// Extend SingingVoice class (src/engines/SingingVoice.ts)
class SingingVoice {
  constructor() {
    // Pre-render TTS at 3 reference pitches (C3, C4, C5)
    this.ttsCache = {
      'low': await this.generateTTS(lyrics, pitch=130.8), // C3
      'mid': await this.generateTTS(lyrics, pitch=261.6), // C4
      'high': await this.generateTTS(lyrics, pitch=523.3) // C5
    };
  }
  
  getNearestBasePitch(targetMidiNote) {
    const freq = midiToFreq(targetMidiNote);
    if (freq < 200) return 'low';
    if (freq < 400) return 'mid';
    return 'high';
  }
  
  // Only shift ±1 octave max from nearest base
  const shiftRatio = targetFreq / baseFreq;
  rubberBand.setPitchScale(Math.max(0.5, Math.min(2.0, shiftRatio)));
}
```

This minimizes artifacts by keeping shifts within Rubber Band's optimal range.

---

## 3. Phoneme-Aware Time Stretching

Align phonemes to notes and preserve consonant timing for natural articulation.

### Implementation

```typescript
// Use Forced Alignment (e.g., Montreal Forced Aligner) on TTS output
const phonemeTimings = await alignPhonemes(ttsAudio, lyrics);

// Process each phoneme region separately
for (const {phoneme, start, end, isVowel} of phonemeTimings) {
  const region = extractAudioRegion(ttsAudio, start, end);
  
  if (isVowel) {
    // Vowels can be stretched aggressively
    rubberBand.setTimeRatio(noteDuration / originalVowelDuration);
  } else {
    // Consonants: minimal stretch to preserve articulation
    rubberBand.setTimeRatio(1.0);
  }
  
  rubberBand.process(region, output);
}
```

### Optimization

Use WebAssembly `SharedArrayBuffer` to pass phoneme boundaries from main thread to AudioWorklet without copying.

---

## 4. Formant Shifting for Vocal Character

Separate pitch and formant control for gender, age, or timbre adjustments.

### Implementation

```typescript
// Rubber Band doesn't directly expose formant shift, so chain it:
// 1. Shift pitch WITHOUT formant preservation
rubberBand.setPitchScale(midiPitchRatio);
rubberBand.setFormantOption(RubberBand.OptionFormantShifted);

// 2. Apply corrective formant filter in AudioWorklet
// Use biquad filters to shift formants back
const formantShift = calculateFormantShift(vowelType, desiredCharacter);
for (let i = 0; i < formantFrequencies.length; i++) {
  const filter = new BiquadFilterNode(audioContext, {
    type: 'peaking',
    frequency: formantFrequencies[i],
    Q: formantBandwidths[i],
    gain: formantShift[i]
  });
  source.connect(filter).connect(destination);
}
```

### Advanced Option

Compile a lightweight formant shifter (e.g., based on `soundtouch-js`) to WASM and run it before Rubber Band.

---

## 5. Expressiveness Layer (Vibrato, Dynamics)

Apply modulation as a post-process for natural singing effects.

### Implementation

```typescript
class ExpressiveVoiceProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const output = outputs[0];
    
    // 1. Get base audio from Rubber Band
    const shifted = this.rubberBand.process(this.ttsInput);
    
    // 2. Apply vibrato LFO (5-7 Hz for natural singing)
    for (let i = 0; i < shifted.length; i++) {
      const lfo = Math.sin(2 * Math.PI * this.vibratoRate * i / sampleRate);
      const depth = this.vibratoDepth * lfo;
      
      // Use a delay line for vibrato (not pitch shift!)
      const delaySamples = depth * 10; // Max 10ms delay
      output[i] = this.delayLine.read(delaySamples) * this.amplitudeEnvelope[i];
      this.delayLine.write(shifted[i]);
    }
    
    // 3. Add tremolo and breath noise
    const breathGain = this.breathiness * this.noiseGenerator.next();
    output[i] += breathGain * highPassFilteredNoise;
  }
}
```

---

## 6. Hybrid Neural + Rubber Band Approach

Combine Rubber Band's strengths with neural vocoding for ultimate quality.

### Implementation

See `src/engines/rubberband/HybridNeuralPipeline.ts` for full implementation.

```typescript
// Full pipeline: TTS → Mel → Pitch Shift → Vocoder
const pipeline = new HybridNeuralPipeline({
    melConfig: {
        nMels: 80,
        nFft: 1024,
        hopLength: 256,
        sampleRate: 22050,
        fMin: 0,
        fMax: 8000
    },
    useGpu: true,           // Enable WebGPU acceleration
    maxSessions: 2          // Session pool for concurrent processing
});

await pipeline.init();

// Process TTS audio through pipeline
const result = await pipeline.synthesize(ttsAudio, pitchSemitones, timeRatio);
```

#### Key Features

1. **Mel-spectrogram computation** - Custom FFT implementation with configurable parameters
2. **Pitch shifting in mel domain** - Avoids phase artifacts from time-domain shifting
3. **ONNX Runtime Web vocoder** - HiFi-GAN inference with WebGPU/WebGL/WASM fallback
4. **Session pooling** - Multiple concurrent inference sessions for performance
5. **Pre-allocated buffers** - Minimizes GC during real-time processing

#### Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐
│  TTS Audio  │ →  │  Mel-Spec    │ →  │ Pitch Shift │ →  │   HiFi-GAN  │
│  (Float32)  │    │  (FFT+Mel)   │    │  (Mel bins) │    │  (ONNX/Web) │
└─────────────┘    └──────────────┘    └─────────────┘    └─────────────┘
```

#### WebGPU Acceleration

```typescript
// Automatic provider selection (WebGPU → WebGL → WASM)
const pipeline = new HybridNeuralPipeline({
    executionProviders: ['webgpu', 'webgl', 'wasm'],
    useGpu: true
});

// Check current provider
const provider = pipeline.getExecutionProvider();
console.log(provider); // 'webgpu', 'webgl', or 'wasm'
```

#### Performance Metrics

```typescript
pipeline.setCallbacks({
    onMetrics: (metrics) => {
        console.log(`Total: ${metrics.totalTime}ms`);
        console.log(`Mel: ${metrics.melConversionTime}ms`);
        console.log(`Pitch: ${metrics.pitchShiftTime}ms`);
        console.log(`Vocoder: ${metrics.vocoderTime}ms`);
    }
});
```

This leverages TTS for content, mel-domain pitch shifting for artifact-free transposition, and neural vocoder for high-quality synthesis.

---

## 7. Real-Time Performance Optimizations

Optimize for low-latency, high-fidelity processing.

### Key Optimizations

```typescript
// Pre-allocate circular buffers in WASM memory
const bufferSize = 4096;
const inputPtr = wasmModule._malloc(bufferSize * 4);
const outputPtr = wasmModule._malloc(bufferSize * 4);

// Use SIMD instructions if available
if (wasmModule.simd) {
  rubberBand.setOption(RubberBand.OptionProcessorSIMD);
}

// Adaptive quality based on CPU load
this.cpuMonitor.on('overload', () => {
  rubberBand.setOption(RubberBand.OptionEngineFast);
  this.oversampling = 1; // Reduce quality
});

// Worker pool for parallel TTS generation
const ttsWorkers = Array(4).fill(new Worker('tts-worker.js'));
```

---

## 8. Advanced: Concatenative Hybrid

Blend TTS with real vocal samples for critical notes.

### Implementation

```typescript
// Pre-load vowel samples (aah, ooh, ee) from a singer
const vowelLibrary = await loadVowelSamples();

// During synthesis
if (note.duration > 500 && isVowel(phoneme)) {
  // Crossfade from TTS to real vowel sample
  const realVowel = vowelLibrary.get(phoneme, midiNote);
  const crossfade = generateCrossfade(shiftedTTS, realVowel, 50ms);
  output = crossfade.mix();
}
```

---

## 9. Latency & Synchronization

Ensure precise MIDI sync and low-latency playback.

### Implementation

```typescript
// Compensate for Rubber Band's lookahead latency
const latencySeconds = rubberBand.getLatency() / sampleRate;
this.audioContext.getOutputTimestamp().then(ts => {
  const scheduledTime = ts.contextTime + latencySeconds;
  source.start(scheduledTime);
});

// For MIDI sync, schedule notes ahead of time
this.scheduler.schedule(note, {
  time: note.time - latencySeconds,
  duration: note.duration
});
```

---

## 10. Quality Assurance: Artifact Detection

Monitor and mitigate artifacts in real-time.

### Implementation

```typescript
class ArtifactDetector extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const spectralFlux = this.calculateSpectralFlux(input);
    
    if (spectralFlux > ARTIFACT_THRESHOLD) {
      // Rubber Band created metallic artifact
      this.port.postMessage({type: 'artifact', severity: 'high'});
      
      // Fallback: blend with dry signal
      output[i] = 0.7 * shifted[i] + 0.3 * this.drySignal[i];
    }
  }
}
```

---

## Recommended Implementation Priority

| Priority | Task | Description |
|----------|------|-------------|
| **Immediate** | Tune Rubber Band options | Implement multi-base-pitch caching |
| **Short-term** | Phoneme-aware stretching | Add vibrato layer |
| **Medium-term** | Hybrid neural pipeline | Build for offline rendering |
| **Long-term** | Concatenative blending | Implement for professional results |

---

## Summary

This plan enhances Rubber Band's role in high-quality time stretching while integrating vocal-specific processing for expressive, artifact-free singing synthesis.

### Next Steps

1. Review existing `RUBBERBAND_DESIGN.md` for architectural context
2. Prototype Section 1 (vocal fidelity tuning) in `src/audio-worklets/`
3. Set up performance benchmarks for latency and CPU usage
4. Iterate on sections 2-10 based on testing results

### Suggested Dependencies

- **Montreal Forced Aligner (MFA)** - For phoneme alignment (Section 3)
- **HiFi-GAN WASM** - For neural vocoding (Section 6)
- **soundtouch-js** - For formant shifting (Section 4)

### Follow-up Code Changes

- `src/audio-worklets/rubberband-processor.ts` - Apply vocal fidelity options
- `src/engines/SingingVoice.ts` - Implement multi-resolution pitch caching
- `src/services/Supertonic.ts` - Extend for phoneme timing data

---

## Implementation Progress

Last updated: January 2026

### Completed ✅

| Section | Status | Files Changed |
|---------|--------|---------------|
| **Section 1: Vocal Fidelity Tuning** | ✅ IMPLEMENTED | `src/audio-worklets/rubberband-processor.ts` |
| **Section 2: Multi-Resolution Pitch** | ✅ IMPLEMENTED | `src/engines/SingingVoice.ts` |
| **Section 5: Expression Layer** | ✅ IMPLEMENTED | `src/engines/rubberband/ExpressiveVoiceProcessor.ts` |

#### Section 1 Implementation Details
- Added vocal-optimized options to rubberband-processor.ts:
  - `OptionFormantPreserved` - Prevents chipmunk effect
  - `OptionPhaseLaminar` - Better phase coherence for monophonic voice
  - `OptionTransientsMixed` - Preserves consonant articulation
  - `OptionPitchHighQuality` - Better vocal fidelity
- Added configurable quality modes (Finer/Faster engine switching)
- Added dynamic formant preservation toggle
- Added latency reporting for synchronization

#### Section 2 Implementation Details
- Added `PitchCache` interface for multi-resolution pitch caching
- Added `REFERENCE_FREQUENCIES` constants (C3, C4, C5)
- Added `midiToFreq` and `freqToMidi` utility functions
- Added `getNearestBasePitch` method for optimal cache selection
- Added `setPitchFromMidi` method with ±1 octave clamping
- Added `processWithOptimalPitch` method for automatic cache usage
- Added `SingingVoiceConfig` for flexible initialization

#### Section 5 Implementation Details
- Implemented `ExpressiveVoiceProcessor` class for AudioWorklet
- Added delay-line based Vibrato (pitch modulation) for natural sounding oscillation
- Added Tremolo (AM) with configurable rate and depth
- Added Breath Noise generator with pre-calculated noise buffer and enabled switch
- Integrated into `RubberBandProcessor` pipeline as a post-processing stage

### WASM Wrapper Updates ✅

| File | Changes |
|------|---------|
| `emscripten/rubberband_wrapper.cpp` | Added `setFormantOption()` method, exported all Option constants |

Exposed option constants for JavaScript:
- Process options (RealTime, Offline)
- Stretch options (Elastic, Precise)
- Transient options (Crisp, Mixed, Smooth)
- Phase options (Laminar, Independent)
- Formant options (Shifted, Preserved)
- Engine options (Faster, Finer)
- Pitch options (HighSpeed, HighQuality, HighConsistency)
- Channel options (Apart, Together)

### Stub Files Created 📝

| Section | File | Status |
|---------|------|--------|
| **Section 3: Phoneme Alignment** | `src/engines/rubberband/PhonemeAligner.ts` | STUB |
| **Section 4: Formant Shifting** | `src/engines/rubberband/FormantShifter.ts` | STUB |
| **Section 5: Expression Layer** | `src/engines/rubberband/ExpressiveVoiceProcessor.ts` | ✅ IMPLEMENTED |
| **Section 6: Hybrid Neural** | `src/engines/rubberband/HybridNeuralPipeline.ts` | ✅ IMPLEMENTED |
| **Section 7: Performance** | `src/engines/rubberband/PerformanceOptimizer.ts` | STUB |
| **Section 8: Concatenative** | `src/engines/rubberband/ConcatenativeHybrid.ts` | STUB (partial impl) |
| **Section 9: Latency Sync** | `src/engines/rubberband/LatencyCompensator.ts` | STUB (partial impl) |
| **Section 10: Artifact Detection** | `src/engines/rubberband/ArtifactDetector.ts` | STUB (partial impl) |

### File Structure

```
src/engines/
├── SingingVoice.ts              # Enhanced with multi-resolution pitch caching
└── rubberband/
    ├── index.ts                  # Module exports
    ├── PhonemeAligner.ts         # Section 3: Phoneme alignment
    ├── FormantShifter.ts         # Section 4: Formant control
    ├── ExpressiveVoiceProcessor.ts # Section 5: Vibrato, tremolo, breath
    ├── HybridNeuralPipeline.ts   # Section 6: Neural vocoding
    ├── PerformanceOptimizer.ts   # Section 7: WASM optimization
    ├── ConcatenativeHybrid.ts    # Section 8: Sample blending
    ├── LatencyCompensator.ts     # Section 9: MIDI sync
    └── ArtifactDetector.ts       # Section 10: Quality monitoring
```

### Next Implementation Steps

1. **Rebuild WASM module** - Run `./emscripten/build_rubberband.sh` to compile updated wrapper
2. **Test Section 1 & 2** - Verify vocal fidelity improvements with TTS output
3. **Integrate MFA** - Add phoneme alignment backend for Section 3
4. **Add HiFi-GAN WASM** - Find or compile neural vocoder for Section 6
