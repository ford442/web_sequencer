# Hyphon Hyrid Web Synth/Drum/Sampler/TTS

A 32-step sequencer with dual synths, drums, sampler, and TTS voice synthesis powered by Web Audio + Pyodide.

## Features

- 🎹 Dual synthesizers (Lead & Bass) with ADSR, filters, and waveform selection
- 🥁 Drum machine (Kick, Snare, Hi-Hats)
- 🎤 **Sampler with Supertonic TTS integration** - Generate speech from text
- 🎨 **Voice Designer** - Real-time voice parameter editing with GPU-accelerated DSP
- 🎼 32-step pattern sequencer with 8 pattern slots per track
- 🎵 Song mode for arranging patterns
- 🎚️ Hardware-style interface with knobs and LED feedback
- 📤 XM module export

## Prerequisites
- Node.js 18+

## Setup
```bash
npm install

# Optional: Download TTS models for voice synthesis (requires ~235 MB)
bash download_models.sh
```

> **Note:** The TTS feature requires external model files. See [TTS_DEPLOYMENT.md](docs/tts/TTS_DEPLOYMENT.md) for details. The app works fully without these models as a regular sequencer.

## Development
```powershell
npm run dev
```

## Testing
```powershell
npm test
```

Knob rendering drift is guarded by contract tests that snapshot the pure derivations from
`KNOB_MATERIAL`:
- `buildKnobShaderCode()` (WGSL source)
- `buildKnob2DDrawCalls()` (Canvas2D draw-command sequence)

If you intentionally change `src/components/knobMaterial.ts`, run the relevant Vitest file with
snapshot update and review the inline snapshot diff before committing.

A separate Playwright smoke test (`tests/knob-canvas-smoke.spec.ts`) forces the Canvas2D fallback and
checks that knob canvases render non-blank output (no screenshot comparisons).

## Build
```powershell
npm run build
```

## Preview Production Build
```powershell
npm run preview
```

## Deploy
```powershell
npm run deploy
```

## SVG Demo
```powershell
npm run demo
```
Or open `svg-demo.html` in your browser to see a pure SVG-based sequencer interface with interactive step buttons, knobs, and transport controls.

## TTS Voice Synthesis

The sampler includes Supertonic TTS integration for generating speech from text with customizable voice characteristics. Each of the 8 sample banks maintains its own independent TTS text phrase.

### Quick Start

1. Navigate to the Sampler track (SMP) in the sequencer
2. Select a bank (1-8) using the bank selector buttons
3. Enter text in the TTS input field (each bank stores its own text)
4. Click "GEN" to generate speech for the active bank
5. Switch banks to set different text for each bank
6. Click "EDIT VOICE" to open the Voice Designer for real-time parameter editing

### Per-Bank TTS Text

- Each of the 8 sample banks has its own TTS text phrase
- Switching banks automatically displays that bank's text
- All TTS phrases are saved with your project
- Generate unique speech samples for each bank

### Voice Designer Features

- **Real-time heatmap visualization** of voice timbre parameters
- **GPU-accelerated DSP operations**: Sharpen, Echo, Tremolo, Jitter
- **Geometric transformations**: Mirror, Invert, Random Shift
- **WebGPU backend** with CPU fallbacks for compatibility

### Documentation

- **[TTS_DEPLOYMENT.md](docs/tts/TTS_DEPLOYMENT.md)** - Complete deployment guide, asset requirements, troubleshooting
- **[INTEGRATION_SUMMARY.md](docs/archive/INTEGRATION_SUMMARY.md)** - Technical integration details and architecture
- **[TTS_IMPLEMENTATION_SUMMARY.md](docs/tts/TTS_IMPLEMENTATION_SUMMARY.md)** - Per-bank TTS feature implementation details
- **[TTS_VISUAL_GUIDE.md](docs/tts/TTS_VISUAL_GUIDE.md)** - Visual guide and examples for per-bank TTS
- **[TTS_PER_BANK_VERIFICATION.md](docs/tts/TTS_PER_BANK_VERIFICATION.md)** - Manual testing guide for TTS functionality

### Requirements

The TTS feature requires ONNX model files (~235 MB total):
- 4 ONNX models (duration predictor, text encoder, vector estimator, vocoder)
- Configuration files (tts.json, unicode_indexer.json)
- At least one voice style file (M1.json)

Run `bash download_models.sh` to automatically download all required assets.

**Without these models:** The app works normally as a sequencer; TTS features are disabled gracefully.
