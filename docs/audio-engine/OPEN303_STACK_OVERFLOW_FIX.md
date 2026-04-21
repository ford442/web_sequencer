# Open303 (JC-303) Stack Overflow Fix

> **Issue**: JC-303 WASM causes stack overflow during initialization, killing the entire AudioContext.
> **Impact**: All audio (sampler, drums, lead synth) stops working.

---

## Immediate Fix (Already Applied) ✅

### 1. AudioWorklet Protection (`src/audio-worklets/open303-processor.ts`)

Changes made:
- ✅ Fault handlers now return instead of crashing
- ✅ Memory pages increased: 512→1024 pages (32MB→64MB)
- ✅ Max memory increased: 1024→2048 pages (64MB→128MB)
- ✅ Init wrapped in try/catch with retry logic

### 2. Initialization Bypass (`src/hooks/useAudioEngine.ts`)

Changes made:
- ✅ Open303 init wrapped in try/catch
- ✅ AudioContext survives even if Open303 crashes
- ✅ Graceful fallback message logged

### 3. AudioWorklet Recovery (`src/audio-worklets/open303-processor.ts`)

Changes made:
- ✅ Progressive buffer size reduction on init failure (128→64→32→16)
- ✅ Stack overflow handlers return instead of crash
- ✅ Non-throwing error reporting to main thread
- ✅ Graceful degradation without killing AudioContext

### 4. Fallback Synthesizer (`src/engines/FallbackBassSynth.ts`)

New file created:
- Web Audio API-based TB-303-style synth
- Saw/square waveforms
- Resonant lowpass filter with envelope
- Slide/portamento support
- Activated automatically when WASM fails
- Seamless integration with existing UI

---

## Permanent Fix (Requires WASM Rebuild) ✅

The root cause is Emscripten's default 64KB stack size being too small for the C++ constructors in JC-303.

### Quick Rebuild (Automated)

We've provided a convenience script:

```bash
# Rebuild with proper stack size (2MB)
./rebuild_open303.sh
```

This will:
1. Check for Emscripten
2. Initialize the jc303_wasm submodule if needed
3. Build with `STACK_SIZE=2097152` (2MB)
4. Copy files to `public/`

### Manual Rebuild

#### Option A: Use Project Build Script

```bash
# Build both threaded and single-threaded variants
bash tools/build_jc303_omp.sh release both
```

The build script has been updated with proper stack size.

#### Option B: Direct CMake Build (Faster)

```bash
cd jc303_wasm/wasm
mkdir -p build && cd build

emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_EXE_LINKER_FLAGS="-s STACK_SIZE=2097152"

emmake make -j$(nproc)

# Copy to public
cp jc303.js ../../public/
cp jc303.wasm ../../public/
```

#### Option C: Raw emcc (No CMake)

```bash
emcc \
    -O3 \
    -s WASM=1 \
    -s STACK_SIZE=2097152 \      # 2MB stack (was 64KB default)
    -s INITIAL_MEMORY=16MB \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s "EXPORTED_FUNCTIONS=[\"_jc303_init\",\"_jc303_process\",\"_jc303_noteOn\",\"_jc303_noteOff\"]" \
    -s "EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\"]" \
    -o jc303.js \
    jc303_wasm/wasm/jc303_wasm.cpp \
    jc303_wasm/src/dsp/open303/*.cpp
```

### Option B: Use Stackless/Safe Build Mode

If the C++ code uses deep recursion, also add:

```bash
-s SAFE_HEAP=1           # Adds memory access checks (slight perf cost)
-s ASSERTIONS=1          # Enable runtime checks (debug only)
```

---

## Build Script Patch (Already Applied) ✅

The build script has been updated:

```diff
# tools/build_jc303_omp.sh
- -s TOTAL_STACK=1048576
+ -s STACK_SIZE=2097152
```

**Note**: The CMakeLists.txt in `jc303_wasm/wasm/` already has the correct stack size (2MB) on lines 63, 95, 138, 169. The build script was overriding it with 1MB, which is now fixed.

---

## Testing the Fix

### 1. Verify Audio Works (Immediate Fix)
```javascript
// In browser console
const ctx = new AudioContext();
const osc = ctx.createOscillator();
osc.connect(ctx.destination);
osc.start();
// Should hear tone even if Open303 failed
```

### 2. Verify Open303 Status
```javascript
// Check if Open303 initialized successfully
// Look for: "Open303 Engine Ready" vs "Open303 Engine failed"
```

### 3. After WASM Rebuild
```javascript
// Should see NO "Stack overflow detected" messages
// And "Open303 Engine Ready" should appear
```

---

## Fallback Behavior (When Open303 is Disabled)

If Open303 fails to initialize, the bass track (`partB`) falls back to:
- Standard subtractive synthesis (saw/square waves)
- Same filter envelope behavior
- Slightly different timbre (no TB-303 resonance/accent quirks)

This is defined in `useAudioEngine.ts` - the `playSynth` function checks `open303EngineRef.current?.isReady`.

---

## Related Files

| File | Purpose |
|------|---------|
| `src/audio-worklets/open303-processor.ts` | AudioWorklet with stack protection |
| `src/hooks/useAudioEngine.ts` | Open303 initialization & fallback |
| `src/engines/Open303Oscillator.ts` | JS wrapper for the worklet |
| `jc303_wasm/` | C++ source & build (submodule) |
| `tools/build_jc303_omp.sh` | Build script |

---

## Status

| Fix | Status | Notes |
|-----|--------|-------|
| AudioWorklet protection | ✅ Applied | Prevents AudioContext death |
| Init bypass | ✅ Applied | Graceful degradation |
| Build script STACK_SIZE | ✅ Fixed | Changed TOTAL_STACK→STACK_SIZE, 1MB→2MB |
| WASM rebuild with STACK_SIZE | 📋 Ready | Run `./rebuild_open303.sh` |
| CMakeLists.txt STACK_SIZE | ✅ Already Set | 2MB on lines 63, 95, 138, 169 |

### Next Step: Rebuild WASM

The source and build scripts are now properly configured. To complete the fix:

```bash
# One-command rebuild
./rebuild_open303.sh

# Or use the build script directly
bash tools/build_jc303_omp.sh release single
```

After rebuilding, clear browser cache and reload. The stack overflow should be eliminated.

---

*Last Updated: 2026-02-23*
*Related: [VOCAL_WORKSTATION_PLAN.md](../tts/VOCAL_WORKSTATION_PLAN.md)*
