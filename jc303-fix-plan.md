# JC303 Stack Overflow Fix Plan

## Investigation Summary

### Root Cause Analysis

The JC303 module fails to load with a "stack overflow" error due to a **combination of factors**:

1. **Build Configuration Issue (Primary)**
   - Current WASM files are built with `-O1 -g` instead of `-O3 -flto`
   - This change was made in commit `d36ee2c` to preserve export names (`jc303_init`, etc.)
   - However, the `-O1` optimization level doesn't optimize stack usage as aggressively
   - Combined with the 2MB stack size, the C++ constructor recursion still causes overflow
   
2. **WASM File Sizes (Evidence)**
   - `jc303-single.wasm`: 810,717 bytes (built with `-O1 -g`)
   - `jc303-threaded.wasm`: 920,936 bytes (built with `-O1 -g`)
   - Expected size with `-O3 -flto`: ~67-80KB (12x smaller!)

3. **Current Stack Protection (Working but Not Sufficient)**
   - AudioWorklet has `__handle_stack_overflow` handler (returns instead of crashes)
   - 2MB stack size configured (`STACK_SIZE=2097152`)
   - Progressive buffer size retry (128→64→32→16)
   - Fallback synth activates when WASM fails

### Git History Timeline

```
d36ee2c (HEAD) - fix: Change from -O3 -flto to -O1 -g to preserve export names
                └─ WASM size: 810KB (single), 921KB (threaded)
                └─ Stack overflow occurs during init
                
804470f      - Increase stack size from 1MB to 2MB
                └─ Attempted fix, but still fails with -O1 build
                
58399fd      - Fix memory leak in jc303_process
```

### Key Files Status

| File | Status | Notes |
|------|--------|-------|
| `wasm/CMakeLists.txt` | ⚠️ Needs Fix | Currently uses `-O1 -g`, should use `-O3` or `-O2` |
| `src/audio-worklets/open303-processor.ts` | ✅ Protected | Has stack overflow handlers |
| `src/engines/FallbackBassSynth.ts` | ✅ Working | Falls back when WASM fails |
| `public/jc303-single.wasm` | ❌ Broken | 810KB, built with wrong flags |
| `public/jc303-threaded.wasm` | ❌ Broken | 921KB, built with wrong flags |

---

## Fix Options

### Option 1: Rebuild with `-O2` (Recommended)

Use `-O2` optimization which provides good stack optimization while preserving export names better than `-O3`.

**Changes needed in `jc303_wasm/wasm/CMakeLists.txt`:**

```cmake
# For non-debug builds, change from:
-O1
-g

# To:
-O2
# Remove -g (or keep only for debug builds)
```

**Build commands:**
```bash
cd jc303_wasm/wasm
mkdir -p build && cd build

emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="-O2" \
    -DCMAKE_CXX_FLAGS="-O2" \
    -DCMAKE_EXE_LINKER_FLAGS="-s ALLOW_MEMORY_GROWTH=1 -s STACK_SIZE=2097152 -O2"

emmake make -j$(nproc)

# Copy to public
cp jc303.js ../../public/jc303-single.js
cp jc303.wasm ../../public/jc303-single.wasm
```

### Option 2: Add `-s STACK_OVERFLOW_CHECK=2`

Emscripten has built-in stack overflow checking that can be enabled:

```cmake
-s STACK_OVERFLOW_CHECK=2  # Enable stack overflow checks with guard pages
-s STACK_SIZE=2097152      # Keep 2MB stack
```

This adds runtime stack canaries that catch overflows before they corrupt memory.

### Option 3: Use `-O3` with `-s EXPORTED_FUNCTIONS` Explicitly

Force `-O3` optimization but explicitly export the required functions:

```cmake
-O3
-flto
-s "EXPORTED_FUNCTIONS=[\"_jc303_init\",\"_jc303_process\",\"_jc303_noteOn\",\"_jc303_noteOff\",\"_jc303_cleanup\",\"_jc303_allNotesOff\",\"_jc303_setWaveform\",\"_jc303_setCutoff\",\"_jc303_setResonance\",\"_jc303_setEnvMod\",\"_jc303_setDecay\",\"_jc303_setAccent\",\"_jc303_setVolume\",\"_jc303_setTuning\",\"_jc303_setModEnabled\",\"_jc303_setNormalDecay\",\"_jc303_setAccentDecay\",\"_jc303_setFeedbackFilter\",\"_jc303_setSoftAttack\",\"_jc303_setSlideTime\",\"_jc303_setSquareDriver\",\"_jc303_setPitchBend\",\"_malloc\",\"_free\"]"
-s "EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"HEAPF32\"]"
```

This ensures the functions survive LTO even with aggressive optimization.

### Option 4: WASM Asyncify

For deep call stacks, use Emscripten's Asyncify:

```cmake
-s ASYNCIFY
-s ASYNCIFY_STACK_SIZE=2097152
```

This transforms the WASM to support suspending/resuming, effectively giving "unlimited" stack through heap allocation.

---

## Recommended Fix (Option 1 + Option 2 Hybrid)

### Step 1: Update CMakeLists.txt

Edit `jc303_wasm/wasm/CMakeLists.txt`:

**Lines 103-104 (Release build):**
```cmake
# Change from:
-O1
-g

# To:
-O2
-s STACK_OVERFLOW_CHECK=2
```

**Lines 177-178 (Worklet build):**
```cmake
# Change from:
-O3
-flto

# To:
-O2
-s STACK_OVERFLOW_CHECK=2
```

### Step 2: Rebuild

```bash
# Use the project's build script
bash tools/build_jc303_omp.sh release single

# Or manually:
cd jc303_wasm/wasm
rm -rf build
mkdir -p build && cd build

emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="-O2 -s STACK_OVERFLOW_CHECK=2" \
    -DCMAKE_CXX_FLAGS="-O2 -s STACK_OVERFLOW_CHECK=2" \
    -DCMAKE_EXE_LINKER_FLAGS="-s ALLOW_MEMORY_GROWTH=1 -s STACK_SIZE=2097152 -O2 -s STACK_OVERFLOW_CHECK=2"

emmake make -j$(nproc)
```

### Step 3: Verify

Check the output file sizes:
```bash
ls -la public/jc303-*.wasm
```

Expected:
- `jc303-single.wasm`: ~150-250KB (vs current 810KB)
- `jc303-threaded.wasm`: ~200-300KB (vs current 921KB)

### Step 4: Test

1. Clear browser cache
2. Reload the application
3. Check browser console for "Open303 Engine Ready"
4. No "Stack overflow detected" messages should appear

---

## Alternative: Use NPM Package Instead of Submodule

If rebuilding continues to have issues, consider using the JC303 npm package instead:

```bash
npm install jc303-wasm
```

Then modify `Open303Oscillator.ts`:
```typescript
// Instead of fetching from ./jc303-single.wasm
import jc303Module from 'jc303-wasm';

// Use the imported module
const wasmBytes = await jc303Module();
```

However, this requires:
1. The npm package to be properly built with correct flags
2. Modifications to the worklet loading mechanism
3. May not have the AudioWorklet-specific exports needed

**Verdict:** Rebuilding is the better short-term solution.

---

## Long-Term Solution: CI/CD Build Pipeline

To prevent this issue recurring:

1. **GitHub Actions workflow** to build WASM on push to main
2. **Size check** in CI: fail if WASM > 500KB
3. **Runtime test** in CI: verify WASM loads without stack overflow
4. **Version pinning** for Emscripten to ensure reproducible builds

---

## Current Mitigation (Already Working)

The current code already has these protections:

1. **AudioWorklet error handling** catches stack overflow without killing AudioContext
2. **FallbackBassSynth** provides a JS-based 303 sound when WASM fails
3. **Progressive retry** attempts smaller buffer sizes
4. **User-facing error messages** explain the issue

The app continues to work even with the broken WASM - users just get the fallback synth instead of the authentic TB-303 emulation.

---

## Summary

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| 1 | Rebuild with `-O2` + `STACK_OVERFLOW_CHECK=2` | 1 hour | Fixes root cause |
| 2 | Add CI/CD build pipeline | 4 hours | Prevents recurrence |
| 3 | Consider npm package alternative | 2 days | Long-term maintainability |
| 4 | Keep fallback synth as backup | Already done | Graceful degradation |

**Immediate next step:** Run `./rebuild_open303.sh` after modifying the CMakeLists.txt to use `-O2` instead of `-O1`.
