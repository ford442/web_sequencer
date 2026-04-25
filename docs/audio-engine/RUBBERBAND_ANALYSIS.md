# Rubberband Library Analysis

## Priority 4: Check Rubberband File Access ✅ COMPLETE

### Summary

**YES - We have full access to modify rubberband source files.**

### Source Location

```
rubberband/
├── src/
│   ├── common/          # Shared utilities
│   ├── faster/          # Faster engine (R2)
│   │   ├── R2Stretcher.cpp        (1363 lines)
│   │   └── StretcherProcess.cpp   (1304 lines)
│   ├── finer/           # Finer engine (R3)
│   │   ├── R3Stretcher.cpp        (1671 lines)
│   │   └── R3LiveShifter.cpp      (1202 lines)
│   └── ext/             # KissFFT, Speex
```

### Build System Integration

The `emscripten/build.sh` script:

1. **Copies source** to temp directory:
```bash
cp -r "$REPO_ROOT/rubberband/"* "$RUBBERBAND_SRC/"
```

2. **Already patches files** during build:
```bash
# Fix include path issue
sed -i 's|#include "system/sysutils.h"|#include "sysutils.h"|' ...

# Fix size_t issue  
sed -i 's|#include <math.h>|#include <math.h>\n#include <cstddef>\nusing std::size_t;|' ...
```

### OpenMP Opportunities

#### High-Impact Candidates

**1. R2Stretcher.cpp:278 - Channel Processing**
```cpp
for (int c = 0; c < int(m_channels); ++c) {
    if (m_channelData[c]->resampler) {
        m_channelData[c]->resampler->reset();
    }
}
```
→ Candidates for `#pragma omp parallel for`

**2. StretcherProcess.cpp - Sample Loops**
Multiple loops over sample buffers that are independent per channel.

**3. R3Stretcher.cpp - FFT Processing**
Band-limited processing loops that could be parallelized.

### Implementation Strategy

#### Option 1: Patch During Build (Recommended)
Add OpenMP pragmas via `sed` in `build.sh`, similar to existing patches:

```bash
# Example: Parallelize channel loops
sed -i 's/for (int c = 0; c < int(m_channels); ++c) {/#pragma omp parallel for\n    for (int c = 0; c < int(m_channels); ++c) {/' \
    "$RUBBERBAND_SRC/src/faster/R2Stretcher.cpp"
```

#### Option 2: Fork/Modify Source
Directly edit rubberband source files (tracked in git submodule).

### Files with Parallelizable Loops

| File | Lines | Parallelizable Regions |
|------|-------|----------------------|
| R2Stretcher.cpp | 1,363 | Channel loops, buffer clearing |
| StretcherProcess.cpp | 1,304 | Sample processing, windowing |
| R3Stretcher.cpp | 1,671 | FFT bands, channel processing |
| R3LiveShifter.cpp | 1,202 | Ring buffer operations |

### Dependencies

The library already compiles with:
- `-fopenmp` flag (enables OpenMP)
- `-pthread` flag (required for Emscripten OpenMP)
- `libomp.a` linked

### Risks

1. **Thread Safety**: Rubberband uses internal state - need to verify parallel regions are stateless
2. **Emscripten Limitations**: Web workers have overhead - small loops may not benefit
3. **Buffer Sizes**: Only beneficial for large buffers (> 10ms audio)

### Recommendation

For Priority 5 (Threading Tests):

1. **Build with current OpenMP setup** (audio_dsp.cpp)
2. **Benchmark** JS fallback vs WASM OpenMP
3. **If beneficial**, add rubberband patches incrementally
4. **Test thoroughly** - audio glitches are noticeable

### Next Steps

Ready for Priority 5: Test Threading Functionality
- Build Emscripten module
- Verify pthread pool initializes
- Benchmark performance
