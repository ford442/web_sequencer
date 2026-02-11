# Sustain Processor - Rubber Band Integration Guide

## Overview

The `sustain-processor.ts` AudioWorklet now includes integrated Rubber Band pitch shifting capabilities alongside the existing grain-based stretching modes. This provides high-quality, formant-preserving pitch shifting for sampler/sustain operations.

## Features

### Existing Modes (0-2)
- **Mode 0: LOOP** - Standard looped playback with pitch control
- **Mode 1: STRETCH** - Granular freeze/stretch with grain-based time manipulation
- **Mode 2: WAVETABLE** - Single-cycle oscillator mode for wavetable synthesis

### New Mode (3)
- **Mode 3: RUBBERBAND** - High-quality pitch shifting using Rubber Band library
  - Formant preservation to avoid "chipmunk effect"
  - Real-time processing with low latency
  - Superior quality for vocal and melodic content

## Usage

### Initialization

The Rubber Band engine requires WASM initialization before use:

```typescript
// 1. Load the Rubber Band WASM module
const wasmResponse = await fetch('/rubberband.wasm');
const wasmBinary = await wasmResponse.arrayBuffer();

// 2. Create shared ring buffers for audio I/O
const bufferSize = 16384;
const inputBuffer = new SharedArrayBuffer(
    (2 * Int32Array.BYTES_PER_ELEMENT) + (bufferSize * Float32Array.BYTES_PER_ELEMENT)
);
const outputBuffer = new SharedArrayBuffer(
    (2 * Int32Array.BYTES_PER_ELEMENT) + (bufferSize * Float32Array.BYTES_PER_ELEMENT)
);

// 3. Initialize the worklet with WASM
sustainNode.port.postMessage({
    type: 'INIT_WASM',
    inputBuffer,
    outputBuffer,
    wasmBinary
});

// 4. Wait for ready signal
sustainNode.port.onmessage = (event) => {
    if (event.data.type === 'READY') {
        console.log('Rubber Band initialized');
    }
};
```

### Loading Audio Buffer

```typescript
// Load sample buffer (same as before)
sustainNode.port.postMessage({
    type: 'loadBuffer',
    data: {
        buffer: audioBuffer.getChannelData(0)
    }
});
```

### Switching to Rubber Band Mode

```typescript
// Set mode parameter to 3 for Rubber Band
const modeParam = sustainNode.parameters.get('mode');
modeParam.setValueAtTime(3, audioContext.currentTime);

// Set pitch (1.0 = original, 2.0 = octave up, 0.5 = octave down)
const pitchParam = sustainNode.parameters.get('pitch');
pitchParam.setValueAtTime(1.5, audioContext.currentTime); // Perfect fifth up
```

### Triggering Notes

```typescript
// Trigger playback with optional pitch
sustainNode.port.postMessage({
    type: 'noteOn',
    data: {
        pitch: 1.5, // Optional: override pitch parameter
        startSample: 0, // Optional: slice start
        endSample: 44100 // Optional: slice end
    }
});

// Stop playback
sustainNode.port.postMessage({
    type: 'noteOff',
    data: {}
});
```

## Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `mode` | 0-3 | 0 | Processing mode (0=LOOP, 1=STRETCH, 2=WAVETABLE, 3=RUBBERBAND) |
| `pitch` | 0.25-4.0 | 1.0 | Pitch multiplier (applies to all modes) |
| `bpm` | 20-300 | 120 | BPM for arpeggiator |
| `arp` | 0-1 | 0 | Arpeggiator on/off |
| `frequency` | 20-20000 | 220 | Base frequency for wavetable mode |

## Message Types

| Type | Data | Description |
|------|------|-------------|
| `INIT_WASM` | `{ inputBuffer, outputBuffer, wasmBinary }` | Initialize Rubber Band WASM |
| `loadBuffer` | `{ buffer }` | Load audio sample |
| `setLoopPoints` | `{ start, end }` | Set loop region |
| `noteOn` | `{ pitch?, startSample?, endSample? }` | Start playback |
| `noteOff` | `{}` | Stop playback |
| `setGrainSize` | `{ size }` | Set grain size for stretch mode |
| `setArpPattern` | `{ pattern }` | Set arpeggiator pattern (semitones) |
| `enableRubberBand` | `{ enabled }` | Enable/disable Rubber Band mode |

## Architecture

### Ring Buffer Flow

```
Main Thread         AudioWorklet         Rubber Band WASM
    |                    |                        |
    |--inputBuffer------>|                        |
    |                    |--WASM Heap Input------>|
    |                    |                        |
    |                    |<--WASM Heap Output-----|
    |<---outputBuffer----|                        |
```

### Processing Pipeline

1. **Input Stage**: Audio fed to input ring buffer from main thread
2. **Worklet Stage**: Pulls from input buffer, writes to WASM heap
3. **Rubber Band**: Processes audio with pitch/time manipulation
4. **Output Stage**: Retrieves from WASM heap, writes to output buffer
5. **Audio Graph**: Output buffer consumed by Web Audio graph

## Performance Considerations

- **Latency**: Rubber Band mode adds ~10-50ms latency depending on buffer size
- **CPU**: Higher quality than grain-based, but requires more CPU
- **Memory**: WASM heap allocated dynamically based on buffer needs
- **Real-time**: Optimized for real-time use with formant preservation

## Fallback Behavior

- If WASM initialization fails, processor falls back to original modes (0-2)
- Mode 3 will produce silence if Rubber Band is not initialized
- Check `rubberBandInitialized` state via port messages

## Example: Complete Setup

```typescript
// Full initialization example
async function setupSustainWithRubberBand(audioContext: AudioContext) {
    // 1. Add worklet module
    await audioContext.audioWorklet.addModule('sustain-processor.js');
    
    // 2. Create worklet node
    const sustainNode = new AudioWorkletNode(audioContext, 'sustain-processor');
    
    // 3. Initialize Rubber Band
    const wasmResp = await fetch('/rubberband.wasm');
    const wasmBinary = await wasmResp.arrayBuffer();
    const bufferSize = 16384;
    
    sustainNode.port.postMessage({
        type: 'INIT_WASM',
        inputBuffer: new SharedArrayBuffer(
            (2 * Int32Array.BYTES_PER_ELEMENT) + (bufferSize * Float32Array.BYTES_PER_ELEMENT)
        ),
        outputBuffer: new SharedArrayBuffer(
            (2 * Int32Array.BYTES_PER_ELEMENT) + (bufferSize * Float32Array.BYTES_PER_ELEMENT)
        ),
        wasmBinary
    });
    
    // 4. Load sample
    const sampleResp = await fetch('/assets/piano.wav');
    const arrayBuffer = await sampleResp.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    sustainNode.port.postMessage({
        type: 'loadBuffer',
        data: { buffer: audioBuffer.getChannelData(0) }
    });
    
    // 5. Connect to destination
    sustainNode.connect(audioContext.destination);
    
    // 6. Set Rubber Band mode
    sustainNode.parameters.get('mode').setValueAtTime(3, audioContext.currentTime);
    
    // 7. Play with pitch
    sustainNode.port.postMessage({
        type: 'noteOn',
        data: { pitch: 1.5 }
    });
    
    return sustainNode;
}
```

## Troubleshooting

### No Sound in Rubber Band Mode
- Check that `INIT_WASM` message was sent with valid `wasmBinary`
- Verify that `READY` message was received
- Ensure ring buffers are being fed with audio data

### Clicks/Artifacts
- Increase ring buffer size (16384 or 32768)
- Check that input buffer is being fed consistently
- Verify sample rate matches between contexts

### High CPU Usage
- Rubber Band is CPU-intensive by design
- Consider reducing buffer size if latency allows
- Use mode 1 (STRETCH) for lower CPU at cost of quality

## See Also

- [rubberband-processor.ts](./rubberband-processor.ts) - Standalone Rubber Band processor
- [RingBuffer](../utils/ringBuffer.ts) - Lock-free ring buffer implementation
- [SingingVoice](../engines/SingingVoice.ts) - Example of Rubber Band integration
