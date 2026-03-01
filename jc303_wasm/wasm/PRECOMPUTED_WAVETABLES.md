# JC-303 Pre-Computed Wavetables Strategy

## Overview

If the stack overflow fixes in the main solution are not sufficient, this document describes an alternative approach using pre-computed wavetables loaded from JavaScript.

## Strategy: Pre-Computed Wavetables in JS

Instead of generating wavetables in C++ during initialization, we generate them once in JavaScript and load them into WASM memory.

### Advantages

1. **No stack usage during init** - Wavetable generation happens in JS with no WASM stack pressure
2. **Faster initialization** - Just memory copy, no FFT calculations
3. **Deterministic** - Same wavetables every time, no floating point differences
4. **Smaller WASM** - Can remove FFT code from the binary if desired

### Implementation

#### 1. Generate Wavetables in JavaScript

```javascript
// wavetable-generator.js
// Generates the same wavetables that rosic creates, but in JS

function generateSquare303Wavetable(tableLength = 2048) {
    const prototype = new Float64Array(tableLength);
    
    // Generate saw-wave
    const N1 = Math.floor(tableLength / 2);
    const N2 = tableLength - N1;
    const s1 = 1.0 / (N1 - 1);
    const s2 = 1.0 / N2;
    
    for (let n = 0; n < N1; n++) {
        prototype[n] = s1 * n;
    }
    for (let n = N1; n < tableLength; n++) {
        prototype[n] = -1.0 + s2 * (n - N1);
    }
    
    // Apply tanh shaping
    const tanhShaperFactor = Math.pow(10, 36.9 / 20); // dB2amp(36.9)
    const tanhShaperOffset = 4.37;
    const squarePhaseShift = 180.0;
    
    for (let n = 0; n < tableLength; n++) {
        prototype[n] = -Math.tanh(tanhShaperFactor * prototype[n] + tanhShaperOffset);
    }
    
    // Circular shift
    const nShift = Math.round(tableLength * squarePhaseShift / 360.0);
    const shifted = new Float64Array(tableLength);
    for (let i = 0; i < tableLength; i++) {
        shifted[i] = prototype[(i + nShift) % tableLength];
    }
    
    return shifted;
}

function generateMipMap(prototype, numTables = 12) {
    // Use Web Audio API's FFT or a JS FFT library
    const tableSet = [];
    
    // Full bandwidth table (table 0)
    tableSet[0] = new Float64Array(prototype);
    
    // Generate bandlimited versions
    for (let t = 1; t < numTables; t++) {
        // Low-pass filter by removing high frequencies
        const cutoff = tableLength / Math.pow(2, t);
        // ... FFT -> zero bins -> IFFT
        tableSet[t] = bandlimitedVersion;
    }
    
    return tableSet;
}

// Generate once and export as binary
const square303 = generateSquare303Wavetable();
const saw303 = generateSaw303Wavetable();
const mipmaps = {
    square: generateMipMap(square303),
    saw: generateMipMap(saw303)
};

// Save as binary files
saveAsBinary(mipmaps, 'wavetables.bin');
```

#### 2. Modified C++ Wrapper

```cpp
// jc303_wasm.cpp - add these functions

// Load pre-computed wavetables from JS
EMSCRIPTEN_KEEPALIVE
void jc303_load_wavetables(double* squareTables, double* sawTables, int numTables, int tableLength) {
    if (g_synth == nullptr) return;
    
    // Copy tables into the MipMappedWaveTable objects
    for (int t = 0; t < numTables; t++) {
        memcpy(g_synth->waveTable1.tableSet[t], sawTables + t * (tableLength + 4), 
               (tableLength + 4) * sizeof(double));
        memcpy(g_synth->waveTable2.tableSet[t], squareTables + t * (tableLength + 4), 
               (tableLength + 4) * sizeof(double));
    }
    
    g_synth->waveTable1.initialized = true;
    g_synth->waveTable2.initialized = true;
}

// Skip wavetable generation in Open303 constructor
// Modify rosic_Open303.cpp constructor:
Open303::Open303() {
    // ... other init ...
    
    // DON'T call setWaveForm here - it triggers wavetable generation
    // Instead, just set the waveform indices
    oscillator.setWaveTable1(&waveTable1);
    oscillator.setWaveTable2(&waveTable2);
    // waveForm1 and waveForm2 are set by JS after loading tables
    
    // ... rest of init ...
}
```

#### 3. AudioWorklet Loading

```typescript
// In open303-processor.ts

async loadPrecomputedWavetables() {
    // Fetch pre-computed wavetables
    const response = await fetch('/assets/jc303-wavetables.bin');
    const arrayBuffer = await response.arrayBuffer();
    
    // Parse binary format
    const view = new DataView(arrayBuffer);
    const numTables = 12;
    const tableLength = 2048;
    const tableSize = (tableLength + 4) * 8; // 8 bytes per double
    
    // Allocate WASM memory for tables
    const exports = this.wasmInstance!.exports as any;
    const sawPtr = exports._malloc(numTables * tableSize);
    const squarePtr = exports._malloc(numTables * tableSize);
    
    // Copy tables into WASM memory
    const sawHeap = new Float64Array(exports.memory.buffer, sawPtr, numTables * (tableLength + 4));
    const squareHeap = new Float64Array(exports.memory.buffer, squarePtr, numTables * (tableLength + 4));
    
    // Read from binary and write to WASM heap
    let offset = 0;
    for (let t = 0; t < numTables; t++) {
        for (let i = 0; i < tableLength + 4; i++) {
            sawHeap[t * (tableLength + 4) + i] = view.getFloat64(offset, true);
            squareHeap[t * (tableLength + 4) + i] = view.getFloat64(offset + tableSize * numTables, true);
            offset += 8;
        }
    }
    
    // Call C++ function to load tables
    exports.jc303_load_wavetables(sawPtr, squarePtr, numTables, tableLength);
    
    // Free temporary allocations
    exports._free(sawPtr);
    exports._free(squarePtr);
}
```

#### 4. Binary Format

```
wavetables.bin format:
- Header (16 bytes):
  - Magic: "JC303WAV" (8 bytes)
  - Version: 1 (4 bytes)
  - Num tables: 12 (2 bytes)
  - Table length: 2048 (2 bytes)

- Data:
  - Saw303 tables: 12 tables × (2048 + 4) doubles
  - Square303 tables: 12 tables × (2048 + 4) doubles

Total size: ~394KB
```

### Build Process

Add to build script:

```bash
# Generate wavetables during build
node tools/generate-wavetables.js > jc303_wasm/wasm/wavetables.bin

# The binary is loaded by the AudioWorklet at runtime
```

### Fallback Chain

1. **Primary**: Try normal C++ initialization with large stack
2. **Secondary**: If that fails, load pre-computed wavetables from JS
3. **Tertiary**: Use simple JS fallback synth (not full 303 emulation)

## When to Use This Approach

Use pre-computed wavetables if:
- Stack overflow persists even with 32MB stack
- Initialization time is critical (e.g., live performance)
- You want to guarantee identical sound across platforms
- Binary size reduction is desired (can remove FFT code)

## Trade-offs

| Aspect | C++ Generation | Pre-computed JS |
|--------|---------------|-----------------|
| Stack usage | High (during init) | None |
| Init time | ~50-100ms | ~5-10ms |
| Binary size | Larger (FFT code) | Smaller |
| Flexibility | Can change params | Fixed tables |
| Accuracy | Full precision | Full precision |
