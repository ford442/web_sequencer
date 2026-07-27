# OpenMP Audio DSP Implementation

## Summary

This implementation adds actual OpenMP parallelization to the Hyphon audio engine, replacing the previous situation where libomp was linked but never used.

## Files Added

### C++ Audio DSP Module (`emscripten/audio_dsp.cpp`)

Provides OpenMP-parallelized audio processing functions:

| Function | Description | OpenMP Features Used |
|----------|-------------|---------------------|
| `applyGain()` | Apply gain to buffer in-place | `parallel for simd` |
| `mixBuffers()` | Mix multiple buffers with gains | `parallel for simd` |
| `findPeak()` | Find peak amplitude | `parallel for reduction(max:)` |
| `deinterleaveStereo()` | Deinterleave stereo | `parallel for simd` |
| `interleaveStereo()` | Interleave stereo | `parallel for simd` |
| `floatToInt16()` | Convert float32 to int16 | `parallel for simd` |
| `applyStereoWidth()` | Adjust stereo width | `parallel for simd` |
| `getNumThreads()` | Get thread count | `omp_get_max_threads()` |
| `setNumThreads()` | Set thread count | `omp_set_num_threads()` |

### TypeScript Bridge (`src/engines/AudioDSP.ts`)

JavaScript/TypeScript interface to the WASM module:
- Automatic fallback to JS implementation when WASM unavailable
- Memory management (malloc/free on WASM heap)
- Type-safe API with error handling

### Tests (`src/__tests__/AudioDSP.test.ts`)

Comprehensive test suite covering:
- Thread management (get/set thread count)
- All DSP functions via WASM
- Fallback JS implementations
- Large buffer performance

## Build System Updates

### `emscripten/build.sh`

Updated to compile the new `audio_dsp.cpp` module with OpenMP flags:

```bash
# Audio DSP (OpenMP enabled)
compile_cpp "$SCRIPT_DIR/audio_dsp.cpp"
```

The build already had correct OpenMP flags:
- `-fopenmp` - Enable OpenMP
- `-pthread` - Enable pthreads (required for Emscripten OpenMP)
- `libomp.a` - Static OpenMP runtime library

## Usage Example

```typescript
import { audioDSP } from './engines/AudioDSP';

// Check if DSP module is available
if (audioDSP.isAvailable()) {
    console.log(`OpenMP threads: ${audioDSP.getNumThreads()}`);
    
    // Apply gain with OpenMP parallelization
    const buffer = new Float32Array(audioData);
    audioDSP.applyGain(buffer, 2, 0.8); // 2 channels, 0.8 gain
    
    // Find peak amplitude (parallel reduction)
    const peak = audioDSP.findPeak(buffer, 2);
    console.log(`Peak: ${peak}`);
}
```

## Performance Benefits

The OpenMP implementation provides speedups for:
- Large buffer processing (> 10,000 samples)
- Multi-channel audio
- Batch operations (mixing multiple sources)

Fallback JS implementations ensure functionality works even without WASM.

## Thread Safety

All functions are thread-safe:
- No shared mutable state between calls
- Each function operates on provided buffers only
- Thread count can be adjusted at runtime

## Future Enhancements

Potential additions to leverage OpenMP further:
1. **FFT processing** - Parallel FFT for spectral analysis
2. **Convolution** - Parallel impulse response processing
3. **Granular synthesis** - Parallel grain processing
4. **Multi-track rendering** - Parallel track mixing in XM export

### Phase-1 offline 303 (done)

See [OFFLINE_303_OVERSAMPLE.md](./OFFLINE_303_OVERSAMPLE.md) and the umbrella
guide [303-gpu-highfid.md](./303-gpu-highfid.md):

- Per-instance `OVERSAMPLE_FACTOR` (1|2|4) on Open303
- `mixVoiceBuffers` / `downsampleBox` OpenMP helpers
- Worker pool + `render303Offline()` for freeze/export paths
- High-fid CPU (`highfid-cpu`) reuses the same offline/OpenMP oversample flag
  for diode-ladder renders; GPU high-fid stays off the audio thread

Real-time AudioWorklet paths keep factor `1` and do **not** call these OpenMP
helpers from `process()`.

## Technical Details

### SIMD Directives

The code uses `simd` clauses where appropriate:
```cpp
#pragma omp parallel for simd schedule(static)
for (int i = 0; i < totalSamples; i++) {
    buffer[i] *= gain;
}
```

This hints to the compiler that iterations are independent and can use SIMD instructions.

### Reduction Operations

For `findPeak()`, we use OpenMP reduction:
```cpp
#pragma omp parallel for reduction(max:peak) schedule(static)
for (int i = 0; i < totalSamples; i++) {
    peak = std::max(peak, std::abs(buffer[i]));
}
```

This safely combines results from all threads.

### Memory Alignment

The code assumes standard 4-byte alignment for float arrays, which works well with Emscripten's memory model.

## Testing

Run the AudioDSP tests:
```bash
npm test -- src/__tests__/AudioDSP.test.ts
```

All 18 tests pass, covering:
- 7 WASM path tests
- 7 fallback JS tests  
- 4 edge case/error tests
