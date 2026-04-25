# Open303 Fallback Modes Implementation

## Overview

This implementation adds comprehensive fallback modes for the Open303 engine (TB-303 synthesizer clone), enabling it to work across different browser environments with varying levels of SharedArrayBuffer support and security header configurations.

## Features

### 1. Dual WASM Variants

The build system now generates two WASM variants:

- **Threaded variant** (`jc303-threaded.{js,wasm,worker.js}`)
  - Built with OpenMP support
  - Requires COOP/COEP headers (SharedArrayBuffer)
  - Best performance with parallel processing
  - Ideal for production environments with proper CORS configuration

- **Single-threaded variant** (`jc303-single.{js,wasm}`)
  - No OpenMP dependencies
  - Works without COOP/COEP headers
  - Broader browser compatibility
  - Slightly lower performance but still excellent

### 2. Configuration Interface

New `Open303Config` interface provides fine-grained control:

```typescript
interface Open303Config {
    preferWorklet?: boolean;         // Prefer AudioWorklet (default: true)
    preferThreaded?: boolean;        // Prefer threaded WASM (default: false)
    forceScriptProcessor?: boolean;  // Force legacy mode (default: false)
    forceSingleThreaded?: boolean;   // Force single-threaded (default: false)
}
```

### 3. Automatic Fallback Chain

The engine automatically tries multiple strategies in order:

1. **AudioWorklet + Threaded WASM** (Best performance)
   - Requires: Modern browser, AudioWorklet API, COOP/COEP headers
   - Benefits: Lowest latency, parallel processing

2. **AudioWorklet + Single-threaded WASM** (Good performance)
   - Requires: Modern browser, AudioWorklet API
   - Benefits: Low latency, broad compatibility

3. **ScriptProcessor + Threaded WASM** (Legacy with threading)
   - Requires: COOP/COEP headers
   - Benefits: Works in older browsers with threading

4. **ScriptProcessor + Single-threaded WASM** (Maximum compatibility)
   - Requires: Basic WebAssembly support
   - Benefits: Works everywhere

## Usage

### Basic Usage (Default Configuration)

```typescript
import { Open303Oscillator } from './engines/Open303Oscillator';

const engine = new Open303Oscillator();
await engine.init(audioContext, workletUrl);

// Engine automatically selects best available mode
console.log(`Using worklet: ${engine.useWorklet}`);
console.log(`Using threaded: ${engine.isThreaded}`);
```

### Advanced Configuration

```typescript
// Force single-threaded for environments without COOP/COEP
const config = {
    preferWorklet: true,
    preferThreaded: false,
    forceSingleThreaded: true
};

await engine.init(audioContext, workletUrl, config);
```

```typescript
// Try threaded first, fallback to single-threaded
const config = {
    preferWorklet: true,
    preferThreaded: true,  // Will try threaded first
    forceSingleThreaded: false
};

await engine.init(audioContext, workletUrl, config);
```

```typescript
// Force ScriptProcessor for debugging
const config = {
    forceScriptProcessor: true,
    preferThreaded: false
};

await engine.init(audioContext, workletUrl, config);
```

## Building

### Build All Variants (Default)

```bash
npm run build:wasm:jc303
# or directly:
bash tools/build_jc303_omp.sh release both
```

### Build Specific Variant

```bash
# Threaded only
bash tools/build_jc303_omp.sh release threaded

# Single-threaded only
bash tools/build_jc303_omp.sh release single
```

### Debug Build

```bash
bash tools/build_jc303_omp.sh debug both
```

## File Outputs

After building, the following files are generated:

```
public/
├── jc303-threaded.js       # Threaded variant loader
├── jc303-threaded.wasm     # Threaded WASM binary
├── jc303-threaded.worker.js # Thread pool worker
├── jc303-single.js         # Single-threaded loader
├── jc303-single.wasm       # Single-threaded WASM binary
├── jc303.js                # Symlink to single (compatibility)
└── jc303.wasm              # Symlink to single (compatibility)
```

## Server Configuration

### For Threaded Variant (Recommended for Production)

Your web server must send these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

#### Vite Dev Server (Already Configured)

```javascript
// vite.config.ts
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  }
}
```

#### Nginx

```nginx
location / {
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
}
```

#### Apache

```apache
<IfModule mod_headers.c>
    Header set Cross-Origin-Opener-Policy "same-origin"
    Header set Cross-Origin-Embedder-Policy "require-corp"
</IfModule>
```

### For Single-threaded Variant

No special headers required! Works with standard CORS configuration.

## Testing

Comprehensive test suite included:

```bash
npm test -- Open303Config.test.ts
```

Tests cover:
- Configuration interface validation
- Fallback chain behavior
- WASM variant selection
- Mode tracking (useWorklet, isThreaded, isReady)
- All 12 tests passing

## Performance Comparison

| Mode | Latency | CPU Usage | Compatibility |
|------|---------|-----------|---------------|
| AudioWorklet + Threaded | Excellent | Low (parallel) | Modern browsers + COOP/COEP |
| AudioWorklet + Single | Excellent | Low | Modern browsers |
| ScriptProcessor + Threaded | Good | Medium (parallel) | All browsers + COOP/COEP |
| ScriptProcessor + Single | Good | Medium | All browsers |

## Troubleshooting

### SharedArrayBuffer Errors

**Error**: "SharedArrayBuffer not available"

**Solution**: Either:
1. Add COOP/COEP headers to your server (recommended)
2. Use single-threaded variant by setting `forceSingleThreaded: true`

### WASM File Not Found

**Error**: "jc303-threaded.wasm not found"

**Solution**: Run the build script:
```bash
npm run build:wasm:jc303
```

### AudioWorklet Not Available

**Error**: "AudioWorklet initialization failed"

**Solution**: The engine automatically falls back to ScriptProcessor. No action needed.

### All Initialization Strategies Failed

**Error**: "Open303: All initialization strategies failed"

**Solution**: 
1. Check that WASM files exist in `public/` directory
2. Verify browser supports WebAssembly
3. Check browser console for specific errors

## Migration Guide

### From Old API

**Before:**
```typescript
await engine.init(audioContext, workletUrl, true); // forceScriptProcessor
```

**After:**
```typescript
await engine.init(audioContext, workletUrl, {
    forceScriptProcessor: true
});
```

### Backward Compatibility

The old boolean parameter is still supported but deprecated:

```typescript
// Still works, but prefer new config object
await engine.init(audioContext, workletUrl, true);
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│          Open303Oscillator.init()                │
└───────────────┬─────────────────────────────────┘
                │
                ├──► Try AudioWorklet + Threaded
                │    ├─ Success → Use this mode
                │    └─ Fail → Try next
                │
                ├──► Try AudioWorklet + Single
                │    ├─ Success → Use this mode
                │    └─ Fail → Try next
                │
                ├──► Try ScriptProcessor + Threaded
                │    ├─ Success → Use this mode
                │    └─ Fail → Try next
                │
                └──► Try ScriptProcessor + Single
                     ├─ Success → Use this mode
                     └─ Fail → Report error
```

## Credits

Implementation by GitHub Copilot based on requirements from the web_sequencer project.

## License

GPL-3.0 (same as parent project)
