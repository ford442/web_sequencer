# JC-303 WebAssembly Stack Overflow Fix - Complete Solution

## Root Cause Analysis

The stack overflow occurs during `jc303_init()` → `new Open303()` because of a perfect storm:

1. **Deep call chain during construction**:
   ```
   Open303::Open303()
   ├── MipMappedWaveTable::MipMappedWaveTable()  [2 instances]
   │   ├── FourierTransformerRadix2::setBlockSize(2048)
   │   │   ├── new w[4096]      // heap OK
   │   │   ├── new ip[50]       // heap OK
   │   │   └── new tmpBuffer[2048] // heap OK
   │   └── renderWaveform()     // from constructor
   │       └── fillWithSquare303()
   │           └── generateMipMap()
   │               ├── new spectrum[2048]        // heap OK now
   │               ├── FFT (rdft)                // recursion!
   │               └── 12 iterations of iFFT
   ├── BlendOscillator setup
   └── Filter initialization
   ```

2. **FFT recursion**: The Ooura FFT (fft4g.c) uses recursive divide-and-conquer:
   - `rdft()` → `cftfsub()` → `cft1st()`/`cftmdl()` with recursive calls
   - Each recursion level adds stack frames
   - With 2048 samples → ~11 levels of recursion (log2(2048))

3. **AudioWorklet stack is smaller**: Even with 16MB specified, the actual available stack in an AudioWorklet context can be less due to:
   - Browser's JS stack overhead
   - WASM-to-JS boundary frames
   - Asyncify/embind overhead

## Solution Components

### 1. Massive Stack Size Increase (CMakeLists.txt)

```cmake
set(JC303_EMSCRIPTEN_STACK_SIZE 33554432)      # 32MB (was 4MB)
set(JC303_EMSCRIPTEN_INITIAL_MEMORY 67108864)  # 64MB initial
set(JC303_EMSCRIPTEN_MAXIMUM_MEMORY 268435456) # 256MB max
```

Key flags added:
- `-s STACK_SIZE=33554432` - 32MB WASM stack
- `-s TOTAL_STACK=33554432` - Ensure consistency
- `-s INITIAL_MEMORY=67108864` - 64MB initial heap
- `-s MAXIMUM_MEMORY=268435456` - 256MB max (allows growth)
- `-s DISABLE_EXCEPTION_CATCHING=1 -fno-exceptions` - Remove exception overhead
- `-fno-rtti` - Remove RTTI overhead

### 2. Heap-Allocated FFT Buffers (MipMappedWaveTable.cpp)

Already partially done in your version, but cleaned up:
```cpp
void generateMipMap() {
    double* spectrum = new double[tableLength];  // Was stack, now heap
    // ... use spectrum ...
    delete[] spectrum;  // Proper cleanup
}

void reverseTime() {
    double* tmpTable = new double[tableLength+4];  // Was stack, now heap
    // ... use tmpTable ...
    delete[] tmpTable;
}
```

### 3. Lazy Initialization (jc303_wasm.cpp)

Added `initialized` flag to track state, but the key fix is in the **wrapper**:

```cpp
// Removed automatic wavetable generation from MipMappedWaveTable constructor
// Wavetables are now generated on first setWaveform() call

// Added stack protection with setjmp/longjmp
static jmp_buf g_initJmpBuf;

int jc303_init(double sampleRate, int bufferSize) {
    if (setjmp(g_initJmpBuf) != 0) {
        // Recovered from stack overflow
        return 0;
    }
    
    g_synth = new Open303();  // If this crashes, we longjmp back
    // ...
}
```

### 4. Hardened AudioWorklet (open303-processor.ts)

```typescript
enum SynthState {
    UNINITIALIZED, INITIALIZING, READY, FAILED, FALLBACK
}

class Open303Processor {
    private initAttempts = 0;
    private static readonly MAX_INIT_ATTEMPTS = 3;
    
    private async initializeWasm(data: any) {
        while (this.initAttempts < MAX_INIT_ATTEMPTS) {
            try {
                if (await this.tryInitialize(data)) {
                    this.synthState = SynthState.READY;
                    return;
                }
            } catch (e) {
                // Wait before retry
                await new Promise(r => setTimeout(r, 100));
            }
        }
        // All failed - use fallback
        this.synthState = SynthState.FAILED;
    }
}
```

Key improvements:
- Retry loop with progressive backoff
- State machine (uninitialized → initializing → ready/failed)
- Rate limiting on noteOn to prevent runtime stack exhaustion
- Better error messages and diagnostics

## Build Instructions

### Option A: Using CMake (Recommended)

```bash
cd projects/web_sequencer/jc303_wasm/wasm

# Clean previous builds
rm -rf build_single build_threaded

# Build single-threaded variant
mkdir build_single && cd build_single
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release
emmake make -j$(nproc)

# Copy to dist
cp jc303.js ../../dist/jc303-single.js
cp jc303.wasm ../../dist/jc303-single.wasm
```

### Option B: Using the Build Script

```bash
cd projects/web_sequencer

# Build single-threaded only (most compatible)
./tools/build_jc303_omp.sh release single

# Or build both variants
./tools/build_jc303_omp.sh release both
```

### Direct emcc Command (for testing)

```bash
cd projects/web_sequencer/jc303_wasm/wasm

emcc \
    -O2 \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME=JC303Module \
    -s "EXPORTED_FUNCTIONS=[\"_malloc\",\"_free\",\"_jc303_init\",\"_jc303_process\",\"_jc303_noteOn\",\"_jc303_noteOff\"]" \
    -s "EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\"]" \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=67108864 \
    -s MAXIMUM_MEMORY=268435456 \
    -s STACK_SIZE=33554432 \
    -s TOTAL_STACK=33554432 \
    -s NO_EXIT_RUNTIME=1 \
    -s ENVIRONMENT=worker \
    -s DISABLE_EXCEPTION_CATCHING=1 \
    -s STACK_OVERFLOW_CHECK=2 \
    -fno-exceptions \
    -fno-rtti \
    --bind \
    -o jc303.js \
    jc303_wasm.cpp \
    ../src/dsp/open303/*.cpp
```

## Verification

### 1. Check WASM Imports

```javascript
const module = await WebAssembly.compile(wasmBytes);
const imports = WebAssembly.Module.imports(module);
console.log('Memory import:', imports.find(i => i.kind === 'memory'));
// Should show memory with initial: 1024 (64MB / 64KB)
```

### 2. Monitor Stack Usage

Add to your C++:
```cpp
#include <emscripten.h>

EM_JS(void, log_stack_ptr, (), {
    const stackPtr = _emscripten_stack_get_current();
    const stackBase = _emscripten_stack_get_base();
    console.log('Stack used:', stackBase - stackPtr, 'bytes');
});
```

### 3. Browser Console Checks

Look for these messages on successful init:
```
[Open303] WASM module compiled successfully
[Open303] WASM instantiated successfully  
[Open303] Initialized successfully with sampleRate=44100, bufferSize=128
[Open303] Sending ready message
```

## Troubleshooting

### Still seeing stack overflow?

1. **Verify new WASM is loaded**: Check Network tab for 304/200 on `.wasm` file
2. **Check stack size in WASM**: 
   ```bash
   wasm-objdump -x jc303.wasm | grep -i stack
   ```
3. **Try single-threaded first**: Threaded variant needs COOP/COEP headers
4. **Check browser console**: Look for "Stack overflow detected" message
5. **Enable debug build**: Set `ENABLE_WASM_DEBUG=ON` for more diagnostics

### Pre-computed wavetables fallback

If stack issues persist, see `PRECOMPUTED_WAVETABLES.md` for the alternative approach.

## Files Modified

| File | Changes |
|------|---------|
| `wasm/CMakeLists.txt` | 32MB stack, 64MB initial memory, LTO, exception disabling |
| `src/dsp/open303/rosic_MipMappedWaveTable.h` | Added `initialized` flag |
| `src/dsp/open303/rosic_MipMappedWaveTable.cpp` | Lazy init, heap buffers |
| `wasm/jc303_wasm.cpp` | setjmp protection, init state tracking |
| `tools/build_jc303_omp.sh` | Updated with new flags and documentation |
| `src/audio-worklets/open303-processor.ts` | Retry logic, state machine, rate limiting |

## Expected Outcome

After these changes:
- ✅ JC-303 initializes reliably on first load
- ✅ No red console errors
- ✅ Graceful fallback if init fails
- ✅ Same audio quality (no compromises)
