# JC303 WASM Stack Overflow - Technical Analysis

## Executive Summary

This document analyzes the stack overflow issue occurring during `jc303_init()` in the JC303 WebAssembly build for the web_sequencer project. The issue is likely caused by large automatic stack allocations during Open303 object construction, particularly within the MipMappedWaveTable initialization.

---

## Current Build Configuration

### Emscripten Settings (CMakeLists.txt)

```cmake
-s STACK_SIZE=2097152        # 2 MB stack
-s INITIAL_MEMORY=16777216   # 16 MB initial heap
-s ALLOW_MEMORY_GROWTH=1     # Allow heap growth
```

**Current settings are identical for both debug and release builds:**
- Stack size: **2 MB (2,097,152 bytes)**
- Initial memory: **16 MB**
- Build variants: `jc303` (main module) and `jc303_worklet` (AudioWorklet)

### Build Flags
- Optimization: `-O1` (release), `-O0` (debug)
- Debug symbols: `-g` (both)
- Exception handling: `-fno-exceptions -fno-rtti`

---

## Open303 Memory Footprint Analysis

### Object Hierarchy

The `Open303` class contains the following embedded objects:

```cpp
// From rosic_Open303.h
MipMappedWaveTable        waveTable1, waveTable2;   // 2x Large wavetable objects
BlendOscillator           oscillator;                // Oscillator (pointers to wavetables)
TeeBeeFilter              filter;                    // Main TB-303 filter
AnalogEnvelope            ampEnv;                    // Amplitude envelope
DecayEnvelope             mainEnv;                   // Filter envelope
LeakyIntegrator           pitchSlewLimiter;          // Pitch slide
BiquadFilter              ampDeClicker;              // De-clicking filter
LeakyIntegrator           rc1, rc2;                  // RC filters for envelope
OnePoleFilter             highpass1, highpass2, allpass;  // Various filters
BiquadFilter              notch;                     // Notch filter
EllipticQuarterBandFilter antiAliasFilter;           // Anti-aliasing
AcidSequencer             sequencer;                 // Built-in sequencer
list<MidiNoteEvent>       noteList;                  // Active note list
```

### MipMappedWaveTable Stack Allocations (CRITICAL)

Each `MipMappedWaveTable` contains:

```cpp
// From rosic_MipMappedWaveTable.h
static const int tableLength = 2048;
static const int numTables = 12;

double prototypeTable[tableLength];                    // 16,384 bytes (16 KB)
double tableSet[numTables][tableLength+4];            // 197,120 bytes (~192 KB)
FourierTransformerRadix2 fourierTransformer;          // Dynamically allocates on heap
```

**Total per MipMappedWaveTable: ~208 KB of embedded member data**
**Two instances in Open303: ~416 KB total**

### Critical Stack Allocation Sites

#### 1. `MipMappedWaveTable::generateMipMap()` (PRIMARY CULPRIT)

```cpp
void MipMappedWaveTable::generateMipMap()
{
    double spectrum[tableLength];   // 2048 * 8 = 16,384 bytes (16 KB) on STACK!
    // ... FFT operations
    for(t=1; t<numTables; t++) {
        // ... zero out bins, transform
    }
}
```

**Stack allocation: 16 KB per call**

Called from:
- `fillWithSine()` → `generateMipMap()`
- `fillWithTriangle()` → `generateMipMap()`
- `fillWithSquare()` → `generateMipMap()`
- `fillWithSaw()` → `generateMipMap()`
- `fillWithSquare303()` → `generateMipMap()`
- `fillWithSaw303()` → `generateMipMap()`

#### 2. `MipMappedWaveTable::reverseTime()`

```cpp
void MipMappedWaveTable::reverseTime()
{
    double tmpTable[tableLength+4];   // 2052 * 8 = 16,416 bytes (~16 KB) on STACK!
    // ...
}
```

**Stack allocation: ~16 KB per call**

### Construction Call Chain During `jc303_init()`

```
jc303_init()
  └── new Open303()
      ├── Open303::Open303() [constructor]
      │   ├── waveTable1.MipMappedWaveTable()  // Embedded object init
      │   │   ├── setBlockSize(2048) on fourierTransformer
      │   │   └── initPrototypeTable() / initTableSet()
      │   ├── waveTable2.MipMappedWaveTable()  // Embedded object init
      │   │   └── ... same as above
      │   ├── oscillator.BlendOscillator()
      │   ├── filter.TeeBeeFilter()
      │   ├── ... (other embedded objects)
      │   └── setWaveform() calls:
      │       ├── waveTable1.setWaveForm1(SAW303)
      │       │   └── fillWithSaw303()
      │       │       └── generateMipMap()     // +16 KB stack
      │       └── waveTable2.setWaveForm2(SQUARE303)
      │           └── fillWithSquare303()
      │               └── generateMipMap()     // +16 KB stack
      └── setSampleRate(sampleRate)
          └── ... propagates to all embedded objects
```

### AcidSequencer Memory Impact

```cpp
// From rosic_AcidSequencer.h
static const int numPatterns = 16;
AcidPattern patterns[numPatterns];  // 16 patterns

// From rosic_AcidPattern.h
static const int maxNumSteps = 16;
AcidNote notes[maxNumSteps];        // 16 notes per pattern
```

**AcidSequencer embedded size:** 16 patterns × (16 notes × ~20 bytes) ≈ **~5 KB**

### FourierTransformerRadix2 Heap Allocations

The `FourierTransformerRadix2` uses **heap** (not stack) for large buffers:

```cpp
FourierTransformerRadix2::FourierTransformerRadix2()
{
    // Allocated on HEAP (safe)
    setBlockSize(256);  // Actually sets up for tableLength (2048)
}

void FourierTransformerRadix2::setBlockSize(int newBlockSize)
{
    w         = new double[2*N];                    // 2 * 2048 * 8 = 32 KB heap
    ip        = new int[(int) ceil(4.0+sqrt(N))];  // ~64 ints heap
    tmpBuffer = new Complex[N];                     // 2048 * 16 = 32 KB heap
}
```

**Good news:** FFT buffers are heap-allocated, not stack.

---

## Root Cause Analysis

### Why Stack Overflow Occurs

1. **Large Automatic Arrays in Member Functions**
   - `spectrum[2048]` in `generateMipMap()` = 16 KB per call
   - `tmpTable[2052]` in `reverseTime()` = 16 KB per call

2. **Deep Constructor Nesting**
   - Open303 constructor calls multiple setters
   - Each setter may trigger wavetable regeneration
   - Stack frames accumulate across nested calls

3. **Potential Double Allocation**
   - During `Open303()` construction, both waveTable1 and waveTable2 are default-constructed
   - Then `setWaveForm1()` and `setWaveForm2()` are called
   - Each calls fill functions that call `generateMipMap()`
   - If compiler doesn't optimize tail calls, stack depth increases

4. **AudioWorklet Context (Special Concern)**
   - The `jc303_worklet` variant runs in AudioWorkletGlobalScope
   - Some browsers may have stricter stack limits in worklet threads
   - Single-file build (`-s SINGLE_FILE=1`) may affect memory layout

### Stack Usage Estimate During Init

```
Base stack (emscripten runtime):          ~64 KB
Open303 constructor frame:                ~4 KB
  waveTable1 default init:                ~2 KB
  waveTable2 default init:                ~2 KB
  setWaveForm1(SAW303):
    fillWithSaw303():                     ~2 KB
      generateMipMap():
        spectrum[2048]:                   16 KB  <-- Peak usage
        FFT operations:                   ~4 KB
  setWaveForm2(SQUARE303):
    fillWithSquare303():                  ~2 KB
      generateMipMap():
        spectrum[2048]:                   16 KB  <-- Peak usage
        FFT operations:                   ~4 KB
setSampleRate() chain:                    ~8 KB
-------------------------------------------------
Estimated peak stack usage:               ~120-140 KB
```

While 140 KB is well under the 2 MB limit, the issue may be:
- **Compiler optimization differences** causing larger frames
- **Debug builds** preserving more stack frames
- **Nested exception handling** (even with -fno-exceptions)
- **Emscripten stack alignment/padding** requirements

---

## Recommended Solutions

### Option 1: Increase Stack Size (Immediate Fix)

**File:** `jc303_wasm/wasm/CMakeLists.txt`

Change all occurrences of:
```cmake
-s STACK_SIZE=2097152
```

To:
```cmake
-s STACK_SIZE=8388608    # 8 MB stack
```

Or more conservatively:
```cmake
-s STACK_SIZE=4194304    # 4 MB stack
```

**Pros:**
- Simple one-line change
- No code modifications required
- Immediate relief

**Cons:**
- Uses more memory
- Doesn't address root cause
- May mask other issues

### Option 2: Move Stack Allocations to Heap (Root Cause Fix)

**File:** `jc303_wasm/src/dsp/open303/rosic_MipMappedWaveTable.cpp`

Modify `generateMipMap()`:

```cpp
void MipMappedWaveTable::generateMipMap()
{
    // WAS: double spectrum[tableLength];  // 16 KB on stack
    // FIX: Allocate on heap
    double* spectrum = new double[tableLength];
    
    int t, i;
    
    // ... existing code using spectrum ...
    
    // Get the spectrum from the prototype-table:
    fourierTransformer.transformRealSignal(prototypeTable, spectrum);
    
    // ... rest of function ...
    
    // Clean up
    delete[] spectrum;
}
```

Similarly for `reverseTime()`:

```cpp
void MipMappedWaveTable::reverseTime()
{
    // WAS: double tmpTable[tableLength+4];  // 16 KB on stack
    // FIX: Allocate on heap
    double* tmpTable = new double[tableLength+4];
    
    int i;
    for(i=0; i<tableLength; i++)
        tmpTable[i] = prototypeTable[tableLength-i-1];
    for(i=0; i<tableLength; i++)
        prototypeTable[i] = tmpTable[i];
    
    delete[] tmpTable;
}
```

**Pros:**
- Fixes root cause
- Reduces peak stack usage by ~32 KB
- More robust for constrained environments

**Cons:**
- Requires code changes to Open303 DSP
- Heap fragmentation concerns (minor)
- Slightly slower (allocation overhead)

### Option 3: Use Static/Thread-Local Buffers

For the wavetable generation (which is only done during initialization):

```cpp
// In rosic_MipMappedWaveTable.cpp
static thread_local double g_spectrumBuffer[2048];  // Reusable buffer

void MipMappedWaveTable::generateMipMap()
{
    double* spectrum = g_spectrumBuffer;  // Use static buffer
    // ... rest of function, no allocation needed ...
}
```

**Pros:**
- No heap allocation overhead
- No stack pressure
- Thread-safe with thread_local

**Cons:**
- Increases static memory footprint
- Less clean architecturally

### Option 4: Add Stack Overflow Checks

**File:** `jc303_wasm/wasm/CMakeLists.txt`

Add to both debug and release builds:
```cmake
-s STACK_OVERFLOW_CHECK=2   # 0=none, 1=minimal, 2=full with logging
```

This will provide better diagnostics when stack overflow occurs.

### Option 5: Optimize Build for Smaller Stack Frames

Increase optimization level:
```cmake
# Release build
set(EMCC_COMPILE_OPTIONS
    -O2                        # WAS: -O1
    # ... rest
)
```

Higher optimization levels (-O2, -O3) may produce smaller stack frames through:
- Better register allocation
- Tail call optimization
- Dead code elimination

---

## Recommended Implementation Order

### Immediate (Quick Fix)
1. Increase `STACK_SIZE` to 4MB or 8MB in CMakeLists.txt
2. Add `-s STACK_OVERFLOW_CHECK=2` for diagnostics
3. Rebuild and test

### Short Term (Robustness)
4. Modify `generateMipMap()` to use heap allocation
5. Modify `reverseTime()` to use heap allocation
6. Test in both main thread and AudioWorklet contexts

### Long Term (Optimization)
7. Consider using static buffers for initialization-only operations
8. Profile actual stack usage with `-s STACK_OVERFLOW_CHECK=2`
9. Optimize constructor call chain if needed

---

## Testing Recommendations

### 1. Build with Debug Flags
```bash
cd jc303_wasm/wasm
./build.sh debug
```

### 2. Check Stack Usage in Browser
```javascript
// In browser console with debug build
Module.setStatus = function(text) {
    console.log('WASM Status:', text);
};

// Monitor stack pointer
const stackSave = Module.cwrap('stackSave', 'number', []);
const stackRestore = Module.cwrap('stackRestore', null, ['number']);
console.log('Stack pointer before init:', stackSave());
```

### 3. Test Both Module Variants
- Test `jc303.js` (main thread)
- Test `jc303_worklet.js` (AudioWorklet)
- Stack behavior may differ between contexts

### 4. Memory Profiling
```javascript
// Check memory growth
console.log('Memory buffer size:', Module.HEAP8.buffer.byteLength);
console.log('Stack size:', Module.STACK_SIZE || 'unknown');
```

---

## Conclusion

The stack overflow in `jc303_init()` is caused by large automatic array allocations (16 KB each) in `MipMappedWaveTable::generateMipMap()` during Open303 construction. While the current 2 MB stack should theoretically be sufficient, the issue likely manifests due to:

1. Deep constructor nesting
2. AudioWorklet environment constraints
3. Compiler-specific stack frame padding

**Immediate fix:** Increase `STACK_SIZE` to 4-8 MB  
**Proper fix:** Move `spectrum[]` and `tmpTable[]` from stack to heap

Both fixes should be applied to ensure robustness across different browsers and usage contexts.

---

## References

- Emscripten Memory Management: https://emscripten.org/docs/porting/Debugging.html#memory-alignment-issues
- Emscripten Linker Flags: https://emscripten.org/docs/tools_reference/emcc.html
- Web Audio API AudioWorklet: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
