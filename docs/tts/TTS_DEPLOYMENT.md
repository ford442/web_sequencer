# Supertonic TTS Deployment Guide

This document describes the exact assets required for the Supertonic TTS and Voice Mixer integration to work in production.

## Directory Structure

The TTS integration expects the following directory structure in your `public/` folder:

```
public/
├── assets/
│   └── onnx/
│       ├── tts.json                      # TTS configuration file
│       ├── unicode_indexer.json          # Text preprocessing indexer
│       ├── duration_predictor.onnx       # Duration prediction model
│       ├── text_encoder.onnx             # Text encoding model
│       ├── vector_estimator.onnx         # Vector estimation model
│       ├── vocoder.onnx                  # Vocoder model
│       └── voice_styles/
│           ├── M1.json                   # Default male voice style (required)
│           ├── M2.json                   # Optional: Additional male voice
│           ├── F1.json                   # Optional: Female voice style
│           └── F2.json                   # Optional: Additional female voice
└── (onnxruntime-web WASM files - see below)
```

## Required Assets

### 1. ONNX Models (from Supertonic TTS)

These files must be obtained from the [Supertone/supertonic](https://github.com/supertone-inc/supertonic) repository:

**Location in source repo:** `supertone/py/assets/onnx/`

**Files needed:**
- ✅ `duration_predictor.onnx` (~20 MB) - Predicts phoneme durations
- ✅ `text_encoder.onnx` (~40 MB) - Encodes text to embeddings
- ✅ `vector_estimator.onnx` (~150 MB) - Diffusion-based latent refinement
- ✅ `vocoder.onnx` (~25 MB) - Converts latents to audio waveform
- ✅ `tts.json` (~1 KB) - Model configuration
- ✅ `unicode_indexer.json` (~50 KB) - Unicode character mapping

### 2. Voice Style Files

**Location in source repo:** `supertone/py/assets/voice_styles/`

**At minimum, you need:**
- ✅ `M1.json` (default male voice - loaded automatically on init)

**Optional voice styles:**
- `M2.json` - Alternative male voice
- `F1.json` - Female voice
- `F2.json` - Alternative female voice

Each voice style file contains:
- `style_ttl` - Timbre/texture latent (shape: [1, 50, 256])
- `style_dp` - Duration/prosody latent (shape: [1, 8, 16])

### 3. ONNX Runtime Web WASM Files

The `onnxruntime-web` package requires WASM files to be accessible at runtime. Vite will typically handle this automatically, but for production deployment you may need to ensure these files are included.

**Required WASM files from `node_modules/onnxruntime-web/dist/`:**
- ✅ `ort-wasm-simd-threaded.wasm` - Main WASM binary with SIMD support
- ✅ `ort-wasm-simd-threaded.jsep.wasm` - WASM with JSEP backend (optional but recommended)

**Note:** Vite should automatically copy these files during build. If you encounter 404 errors for `.wasm` files, you may need to add them to your `public/` directory or configure Vite to include them.

## How to Obtain Assets

### Option 1: Clone Supertonic Repository (Recommended)

```bash
# Clone the official Supertonic repo
git clone https://github.com/supertone-inc/supertonic.git /tmp/supertonic

# Create the directory structure
mkdir -p public/assets/onnx/voice_styles

# Copy required files
cp -r /tmp/supertonic/py/assets/onnx/*.onnx public/assets/onnx/
cp /tmp/supertonic/py/assets/onnx/*.json public/assets/onnx/
cp -r /tmp/supertonic/py/assets/voice_styles/*.json public/assets/onnx/voice_styles/

# Clean up
rm -rf /tmp/supertonic
```

### Option 2: Use the Download Script

This repository includes a `download_models.sh` script, but it needs to be updated to copy files to the correct location:

```bash
# Run the download script (it clones to assets/ folder)
bash download_models.sh

# Then copy to public folder
mkdir -p public/assets/onnx/voice_styles
cp -r assets/onnx/*.onnx public/assets/onnx/
cp assets/onnx/*.json public/assets/onnx/
cp -r assets/voice_styles/*.json public/assets/onnx/voice_styles/
```

### Option 3: Download from Release (if available)

Check the [Supertonic-Voice-Mixer releases](https://github.com/Topping1/Supertonic-Voice-Mixer/releases) for pre-packaged assets:

```bash
# Example (adjust URL based on actual release)
wget https://github.com/Topping1/Supertonic-Voice-Mixer/releases/download/alpha-v0.1/assets.zip
unzip assets.zip -d /tmp/assets
mkdir -p public/assets/onnx/voice_styles
cp -r /tmp/assets/onnx/* public/assets/onnx/
cp -r /tmp/assets/voice_styles/* public/assets/onnx/voice_styles/
```

## Build Configuration

### Vite Configuration

Your `vite.config.ts` should be configured to serve files from the `public/` directory. The current configuration is correct:

```typescript
export default defineConfig({
  build: {
    outDir: 'dist',
  },
  // Files in public/ are served from /
})
```

### Important Notes

1. **Asset Paths:** The code uses absolute paths starting with `/assets/onnx/` to reference files in `public/assets/onnx/`. This is correct for Vite.

2. **CORS:** If you're serving assets from a CDN, ensure CORS headers are set correctly for `.onnx` and `.wasm` files.

3. **Large Files:** The models total ~235 MB. Consider:
   - Using a CDN for production
   - Implementing lazy loading
   - Showing a loading indicator during initialization

4. **File Sizes:**
   - Total ONNX models: ~235 MB
   - Voice styles: ~50 KB each
   - WASM runtime: ~15 MB

## Graceful Degradation

The integration is designed to fail gracefully if assets are missing:

1. If TTS models fail to load, the app continues to work as a regular sequencer
2. The Sampler Panel shows status messages: "TTS Unavailable" or "TTS models not loaded"
3. The Voice Editor shows "TTS Service Not Ready" if models aren't loaded
4. No crashes occur - errors are logged to console

## Verification

After deployment, verify the integration works:

1. Open browser DevTools > Network tab
2. Load the app and navigate to the Sampler section
3. Check for successful loads of:
   - `tts.json` (200 OK)
   - `unicode_indexer.json` (200 OK)
   - `duration_predictor.onnx` (200 OK)
   - `text_encoder.onnx` (200 OK)
   - `vector_estimator.onnx` (200 OK)
   - `vocoder.onnx` (200 OK)
   - `voice_styles/M1.json` (200 OK)
   - WASM files (200 OK)

4. Check console for "Supertonic: Ready" message
5. Try generating TTS in the Sampler Panel
6. Try opening the Voice Editor

## Troubleshooting

### 404 Errors for Assets

**Problem:** Files not found at `/assets/onnx/...`

**Solution:** Ensure files are in `public/assets/onnx/`, not `src/assets/onnx/`

### WASM Loading Errors

**Problem:** `Failed to load WASM binary`

**Solution:** 
- Check that WASM files are accessible
- Verify MIME types are correct (should be `application/wasm`)
- Check browser compatibility (Chrome, Edge, Firefox, Safari 15+)

### Memory Errors

**Problem:** Out of memory when loading models

**Solution:**
- Use a device with at least 4 GB RAM
- Close other browser tabs
- Use Chrome with `--enable-features=WebAssemblyLazyCompilation`

### TTS Generation Fails

**Problem:** "Service not ready" or generation errors

**Solution:**
- Check all 4 ONNX models loaded successfully
- Verify `M1.json` voice style loaded
- Check browser console for detailed errors
- Ensure text is not empty

## Performance Notes

- **First load:** 5-10 seconds to load all models (~235 MB)
- **Generation time:** 2-5 seconds for a short phrase (depends on steps parameter)
- **Memory usage:** ~500 MB for models + runtime
- **Recommended:** Show loading indicator during initialization

## License

The Supertonic TTS models and assets are subject to their own license. Check the [Supertone repository](https://github.com/supertone-inc/supertonic) for licensing details.
