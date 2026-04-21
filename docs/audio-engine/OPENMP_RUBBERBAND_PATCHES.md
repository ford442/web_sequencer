# OpenMP Patches for Rubberband Library

## Overview

This document describes the OpenMP parallelization patches applied to the rubberband library during the Emscripten build process.

## Patch Location

Patches are applied in `emscripten/build.sh` in the "OPENMP PARALLELIZATION PATCHES" section.

## Files Modified

### 1. R2Stretcher.cpp (Faster Engine)
**Location:** `src/faster/R2Stretcher.cpp`

**Patched Loops:**
- Line ~278: Channel resampler reset loop
  ```cpp
  #ifdef _OPENMP
  #pragma omp parallel for schedule(static) if(m_channels > 2)
  #endif
  for (int c = 0; c < int(m_channels); ++c) {
      if (m_channelData[c]->resampler) {
          m_channelData[c]->resampler->reset();
      }
  }
  ```

**Impact:** Parallelizes resampler initialization across channels.

### 2. StretcherProcess.cpp (Faster Engine Processing)
**Location:** `src/faster/StretcherProcess.cpp`

**Patched Loops:**
- Channel data operations
- Buffer processing loops

**Impact:** Parallelizes sample processing for multi-channel audio.

### 3. R3Stretcher.cpp (Finer Engine)
**Location:** `src/finer/R3Stretcher.cpp`

**Patched Loops:**
- Constructor channel initialization (~line 113)
- Study/Process channel loops (~lines 679, 702, 764, etc.)
- Reset and configuration loops

**Impact:** Parallelizes high-quality stretching across channels.

### 4. R3LiveShifter.cpp (Live Shifter)
**Location:** `src/finer/R3LiveShifter.cpp`

**Patched Loops:**
- Buffer management loops
- Ring buffer operations
- Channel processing in real-time mode

**Impact:** Reduces latency in live pitch shifting.

## Patch Strategy

### Conditional Compilation
All patches use `#ifdef _OPENMP` guards:
```cpp
#ifdef _OPENMP
#pragma omp parallel for schedule(static) if(m_channels > 2)
#endif
for (int c = 0; c < m_channels; ++c) {
    // loop body
}
```

This ensures:
1. Code compiles without OpenMP
2. Only parallelizes when beneficial (> 2 channels)
3. Safe fallback if threads unavailable

### Scheduling
- **Static scheduling** for balanced workloads (all channels similar)
- **Dynamic scheduling** considered for unbalanced processing

### Thread Safety

#### Safe Operations
- Channel buffer initialization
- Independent per-channel processing
- Resampler reset (before processing)

#### Avoided Operations
- Shared state modifications
- Accumulation/reductions without locks
- I/O operations

## Build Integration

The patches are applied automatically during:
```bash
npm run build:emcc
# or
bash emscripten/build.sh
```

### Patch Process
1. Copy rubberband source to temp directory
2. Apply existing compatibility patches
3. Apply OpenMP patches (NEW)
4. Compile all sources with `-fopenmp`
5. Link with `libomp.a`

## Performance Expectations

### When Benefits Appear
- **Multi-channel audio** (> 2 channels)
- **Large buffer sizes** (> 10ms of audio)
- **Complex processing** (high quality mode)

### Expected Speedups
| Channels | Expected Speedup |
|----------|-----------------|
| Mono (1) | None (overhead) |
| Stereo (2) | Minimal |
| Quad (4) | 2-3x |
| 5.1 (6) | 3-4x |
| 7.1 (8) | 4-6x |

### Limitations
- Web Workers have overhead
- Small buffers don't benefit
- Memory bandwidth bound operations limited

## Testing

To verify OpenMP is working in rubberband:

1. Build with debug info:
```bash
emscripten/build.sh 2>&1 | grep -E "(OpenMP|parallel)"
```

2. Check generated JS for thread usage:
```bash
grep -c "pthread" public/hyphon_native.js
```

3. Runtime verification:
```javascript
// In browser console
Module.getNumThreads(); // Should return > 1
```

## Troubleshooting

### Issues

**No speedup observed:**
- Check `m_channels > 2` condition
- Verify pthread pool initialized
- Buffer size may be too small

**Audio glitches:**
- Thread contention on shared resources
- Reduce `PTHREAD_POOL_SIZE`
- Disable OpenMP for problematic loops

**Build errors:**
- Ensure `libomp.a` exists in `emscripten/`
- Verify Emscripten SDK version >= 3.1.0

### Disabling Patches

To disable OpenMP patches temporarily:
```bash
# In build.sh, comment out:
# --- OPENMP PARALLELIZATION PATCHES ---
# ... patch commands ...
```

## Future Improvements

1. **Granular Control**: Add runtime switch for OpenMP
2. **Benchmark Mode**: Compare JS vs WASM performance
3. **Adaptive Scheduling**: Choose schedule based on buffer size
4. **More Loops**: Identify additional parallelizable regions
