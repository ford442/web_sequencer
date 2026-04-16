# AGENTS.md

## Project Overview

**Hyphon** is a browser-based Digital Audio Workstation (DAW) inspired by the Korg Electribe EA-1/ER-1. It features a 32-step sequencer with dual synthesizers, a drum machine, an 8-bank sampler with TTS voice synthesis, a TB-303 clone bass synthesizer, and a hardware-style interface.

### Key Features
- **Dual synthesizers** (Lead & Bass/Part A & Part B) with ADSR, filters, delay, and multiple waveform engines
- **TB-303 clone** (Bass 2) via the JC-303 WASM synthesizer
- **Drum machine** (Kick, Snare, Open/Closed Hi-Hats)
- **Sampler with 8 independent banks** and Supertonic TTS integration
- **Real-time voice designer** with GPU-accelerated DSP (sharpen, echo, tremolo, jitter, geometric transforms)
- **Harmonizer** for layered vocal harmonies
- **Song mode** for pattern arrangement across 8 pattern slots per track
- **3D studio visualization** (React Three Fiber), toggleable from the UI
- **Cloud storage** integration for songs, patterns, banks, and samples
- **AI song generation** modal and **RBS (Rubberband/RBS) import** modal
- **Gamepad support** with a live debugger
- **XM module export** and **WAV audio export**
- **Master effects**: reverb (room/plate/hall), saturation, volume, global pan

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | ^19.2.0 | UI Framework |
| React DOM | ^19.2.0 | Rendering |
| TypeScript | ~5.9.3 | Language |
| Vite | ^5.4.21 | Build Tool & Dev Server |
| Tailwind CSS | ^3.4.6 | Styling |
| React Three Fiber | ^9.5.0 | 3D Graphics |
| Three.js | ^0.182.0 | 3D Engine |
| ONNX Runtime Web | ^1.23.2 | TTS Inference |

### Vite Plugins
- `@vitejs/plugin-react` — React Fast Refresh
- `vite-plugin-wasm` — WASM import support
- `vite-plugin-top-level-await` — Top-level await in modules

### Audio Architecture (Multi-Engine "Four Worlds")
| Engine | Language | Build Output | Purpose |
|--------|----------|--------------|---------|
| AssemblyScript | TypeScript-like | `src/wasm/*.wasm` | Oscillators, track freezer, FFT, audio export, XM export |
| Rust/WASM | Rust | `public/rust-wasm/` | High-precision synthesis |
| Emscripten | C++ | `public/hyphon_native.js` (+ .wasm, .worker.js) | Rubberband pitch/time stretching, Pyodide bootstrap |
| JC-303 | C++ | `public/jc303.*` | TB-303 clone synthesizer |
| WebGPU | WGSL/TypeScript | Runtime | GPU-accelerated DSP (voice designer, scope) |
| Web Audio | TypeScript | Native | Primary audio graph, scheduling, effects |

### Backend & Services
| Component | Technology | Purpose |
|-----------|------------|---------|
| Cloud API Client | TypeScript (`src/services/CloudStorage.ts`) | REST client for VPS storage |
| Cloud Server | Python FastAPI (`app.py`) | Async SFTP storage proxy |
| TTS Engine | Python/Pyodide (in-browser) | ONNX Runtime Web voice synthesis |
| Voice Mixer | Python/PyQt5 (`Supertonic-Voice-Mixer/`) | Desktop voice designer tool |

---

## Directory Structure

```
/
├── src/                          # Main React application
│   ├── App.tsx                   # Root component (~110KB), central state orchestration
│   ├── main.tsx                  # React root entry
│   ├── components/               # UI components
│   │   ├── HardwareModule.tsx    # Main synth interface with knobs
│   │   ├── MainSequencer.tsx     # 32-step sequencer grid
│   │   ├── SamplerPanel.tsx      # Sampler with TTS controls
│   │   ├── SamplerVoicePanel.tsx # Per-bank sampler voice editor
│   │   ├── VoiceEditor.tsx       # Real-time voice parameter editor
│   │   ├── Studio3D.tsx          # 3D visualization (lazy loaded)
│   │   ├── CloudLibrary.tsx      # Cloud save/load UI
│   │   ├── AISongModal.tsx       # AI song generation modal
│   │   ├── RbsImportModal.tsx    # Rubberband/RBS import modal
│   │   ├── SongMode.tsx          # Pattern arrangement mode
│   │   ├── LiveKeyboard.tsx      # On-screen MIDI keyboard
│   │   ├── WaveformDisplay.tsx   # Sample waveform visualization
│   │   ├── PhonemePainter.tsx    # Phoneme alignment editor
│   │   ├── GamepadDebugger.tsx   # Gamepad input debugger
│   │   └── ...
│   ├── engines/                  # Audio engine wrappers & DSP
│   │   ├── WasmOscillator.ts     # AssemblyScript bridge
│   │   ├── WebGpuOscillator.ts   # WebGPU compute backend
│   │   ├── RustOscillator.ts     # Rust/WASM bridge
│   │   ├── Open303Oscillator.ts  # TB-303 clone interface
│   │   ├── Open303Manager.ts     # JC-303 lifecycle manager
│   │   ├── SingingVoice.ts       # TTS/voice processing
│   │   ├── SingingVoiceManager.ts# Polyphonic TTS manager
│   │   ├── VoiceManager.ts       # Voice allocation
│   │   ├── Harmonizer.ts         # Vocal harmony engine
│   │   ├── AudioDSP.ts           # DSP helpers
│   │   ├── MultisampleGenerator.ts
│   │   └── rubberband/           # Pitch/time stretch utilities
│   ├── hooks/                    # React hooks
│   │   ├── useAudioEngine.ts     # Central audio initialization
│   │   ├── useScheduler.ts       # requestAnimationFrame transport
│   │   ├── useStepHandler.ts     # Per-step audio triggering
│   │   ├── useSongStorage.ts     # LocalStorage song persistence
│   │   ├── usePyodideEngine.ts   # Python/TTS engine loader
│   │   ├── useGamepad.ts         # Gamepad input handling
│   │   ├── useWebGPUScope.ts     # WebGPU oscilloscope
│   │   └── ...
│   ├── services/                 # External service integrations
│   │   ├── CloudStorage.ts       # VPS REST API client
│   │   ├── Supertonic.ts         # TTS model loader
│   │   ├── VoiceDesigner.ts      # Voice designer service
│   │   └── WebGpuBackend.ts      # WebGPU initialization
│   ├── utils/                    # Utility functions
│   │   ├── audioExport.ts        # WAV export functionality
│   │   ├── xmExport.ts           # XM module export
│   │   ├── renderAudio.ts        # Offline audio rendering
│   │   ├── fft.ts / fftLoader.ts # FFT utilities
│   │   ├── musicTheory.ts        # Note/MIDI conversions
│   │   ├── clipboardUtils.ts     # Step copy/paste
│   │   └── xm_save_lib/          # XM file format library
│   ├── stores/                   # State stores
│   │   └── loadingProgressStore.ts
│   ├── audio-worklets/           # AudioWorklet processors
│   │   ├── sustain-processor.ts  # Sample sustain/loop/stretch
│   │   ├── open303-processor.ts  # TB-303 audio worklet
│   │   ├── rubberband-processor.ts
│   │   └── artifact-detector-processor.ts
│   ├── workers/                  # Web Workers
│   │   └── renderer.worker.ts    # Offline audio rendering
│   ├── types.ts                  # TypeScript type definitions
│   ├── constants.ts              # Default synth/drum values
│   ├── constants/appDefaults.ts  # App-level defaults & colors
│   └── __tests__/                # Unit/integration tests
├── assembly/                     # AssemblyScript source
│   ├── oscillators.ts            # WASM oscillator DSP
│   ├── trackFreezer.ts           # Track rendering/bouncing
│   ├── fft.ts                    # FFT DSP
│   ├── audioExport.ts            # WAV export DSP
│   └── xmExport.ts               # XM export DSP
├── rust-audio/                   # Rust source code
│   └── src/lib.rs                # WASM synthesis engine
├── emscripten/                   # C++ Emscripten build
│   ├── build.sh                  # Main Emscripten build script
│   ├── build_rubberband.sh       # Rubberband-only build
│   ├── rubberband_wrapper.cpp    # Rubberband C++ interface
│   ├── main.cpp                  # Emscripten entry point
│   ├── pyodide_bootstrap.js      # Python initialization
│   ├── pre.js / rubberband-pre.js
│   ├── libomp.a                  # OpenMP runtime (required)
│   └── omp.h
├── jc303_wasm/                   # TB-303 clone (git submodule)
│   └── wasm/                     # CMake-based build
├── Supertonic-Voice-Mixer/       # Python TTS tools
│   ├── voice-mixer.py            # PyQt5 voice designer GUI
│   └── helper.py                 # TTS model utilities
├── public/                       # Static assets + compiled WASM
│   ├── audio-worklets/           # Copied worklet files
│   ├── hyphon_native.js          # Emscripten output
│   ├── hyphon_native.worker.js   # Emscripten pthread worker
│   ├── rubberband.wasm           # Rubberband binary
│   ├── jc303_worklet.js          # JC-303 worklet
│   ├── pyodide.js                # Pyodide loader stub
│   ├── saw.wav / square.wav      # Native WAV oscillators
│   └── assets/                   # Additional static assets
├── tests/                        # Playwright E2E tests
├── tools/                        # Build scripts
│   ├── build_jc303_omp.sh        # JC-303 builder (threaded + single)
│   └── optimize.sh               # Post-build wasm-opt optimizer
├── web/                          # Legacy/alternate web build
├── app.py                        # FastAPI cloud storage server
└── deploy.py                     # SFTP deployment script
```

---

## Build Commands

### Development
```bash
# Install dependencies
npm install

# Start dev server (builds WASM dependencies first)
npm run dev

# Type check only
npx tsc -b

# Lint
npm run lint
```

### WASM Builds (Individual)
```bash
# Build all WASM modules
npm run build:wasm

# Build specific AssemblyScript modules
npm run build:wasm:oscillators    # Oscillator DSP
npm run build:wasm:freezer        # Track freezer / rendering
npm run build:wasm:fft            # FFT DSP
npm run build:wasm:audioexport    # WAV export DSP
npm run build:wasm:xmexport       # XM export DSP

# Build Rust audio engine
npm run build:wasm:rust

# Build JC-303 (requires Emscripten, git submodule)
npm run build:wasm:jc303

# Build Emscripten/Rubberband
npm run build:emcc
```

### Production Build
```bash
# Full production build (all WASM + optimize + TypeScript + Vite)
npm run build

# Output in dist/ directory
```

### Testing
```bash
# Run all Vitest tests
npm test

# Run with Vitest UI (if configured)
npx vitest --ui

# Run Playwright E2E tests
npx playwright test
```

### Deployment
```bash
# Deploy dist/ to the configured server via SFTP
npm run deploy
# Or: python deploy.py
```

### Python Voice Mixer (Desktop Tool)
```bash
cd Supertonic-Voice-Mixer
pip install numpy sounddevice matplotlib PyQt5 onnxruntime
python3 voice-mixer.py
```

---

## The "Four Worlds" Rule

This project has **four distinct build environments**. **Never mix their build steps or toolchains**:

### 1. AssemblyScript World (`/assembly`)
- **Source**: `*.ts` files with `// @mode: assemblyscript` header
- **Build**: `npm run build:wasm:oscillators`, `build:wasm:freezer`, `build:wasm:fft`, `build:wasm:audioexport`, `build:wasm:xmexport`
- **Output**: `src/wasm/*.wasm` (created at build time; not present in a clean checkout)
- **Bridge**: Corresponding engine files in `src/engines/`

### 2. Rust World (`/rust-audio`)
- **Build**: `cd rust-audio && wasm-pack build --target web --out-dir ../public/rust-wasm`
- **Output**: `public/rust-wasm/`
- **Bridge**: `src/engines/RustOscillator.ts`

### 3. Emscripten World (`/emscripten`)
- **Build**: `bash emscripten/build.sh`
- **Output**: `public/hyphon_native.js` (+ `.wasm`, `.worker.js`)
- **Requires**: `libomp.a` in `emscripten/` directory
- **Requires**: Emscripten SDK activated

### 4. JC-303 World (`/jc303_wasm`)
- **Build**: `bash tools/build_jc303_omp.sh debug both`
- **Output**: `public/jc303.*` and `public/jc303_worklet.js`
- **Requires**: Git submodule initialized (`git submodule update --init jc303_wasm`)
- Produces both **threaded** (OpenMP/pthreads) and **single-threaded** variants

---

## SharedArrayBuffer Requirements

This project uses `SharedArrayBuffer` for audio thread communication (pthreads in WASM). The Vite dev server is configured with the required headers:

```javascript
// vite.config.ts
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  }
}
```

**If deploying to a new environment, these headers MUST be set or the app will fail to load.** The JC-303 threaded variant and the Emscripten native module both require this.

---

## WASM Change Detection

**Critical**: After modifying any C++, Rust, or AssemblyScript source, you MUST rebuild the corresponding WASM module. The `public/` directory contains compiled binaries that Vite serves directly — stale binaries will be loaded if not rebuilt. Run `npm run build:wasm` and `npm run build:emcc` after any engine changes.

---

## Code Style Guidelines

### TypeScript
- **Strict mode enabled** (`strict: true` in `tsconfig.app.json`)
- **Target**: `ES2022` with modern DOM APIs
- **JSX transform**: `react-jsx`
- **Import alias**: `@/` maps to `src/`
- **Module resolution**: `bundler`
- **Unused vars**: ESLint enforces `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'` and `varsIgnorePattern: '^_'`
- `noUnusedLocals` and `noUnusedParameters` are **disabled** in `tsconfig.app.json` (rely on ESLint instead)

### React Patterns
- Functional components with hooks
- Custom hooks for complex logic (see `src/hooks/`)
- Memoization with `useMemo`, `useCallback`, `memo` for performance-critical paths
- Lazy loading for heavy components (`Studio3D`)
- Refs for audio engine instances (avoid re-renders)

### Audio Engine Patterns
- Audio engines are initialized in `useAudioEngine` hook
- Worklets are loaded asynchronously — check `isReady` before use
- Master gain/panner chain: sources → filters/effects → master gain → master saturation → master panner → reverb send → destination
- Active note tracking via refs (`Map` for synth and sampler note IDs)

### ESLint Configuration
- Uses `typescript-eslint` with strict recommended rules
- React Hooks rules enforced (`eslint-plugin-react-hooks`)
- React Refresh rules enforced (`eslint-plugin-react-refresh`)
- Global ignores: `dist/`

---

## Testing Strategy

### Unit Tests (Vitest)
- **Location**: `src/__tests__/*.test.ts`
- **Components**: `src/components/__tests__/*.test.tsx`
- **Engines**: `src/engines/__tests__/*.test.ts`
- **Utils**: `src/utils/__tests__/*.test.ts`
- **Environment**: `happy-dom`
- **Setup**: `vitest.setup.ts` with fully mocked `AudioContext`

### Test Categories
1. **Engine Tests**: `WasmOscillator`, `WebGPU`, `AudioDSP`, `SingingVoice`, `SingingVoiceManager`, `FormantShifter`
2. **Component Tests**: `Knob`, `Sequencer`, `SamplerPanel`, `VoiceEditor`, `HardwareModule`, `NoteSelector`, `WaveformSelector`, `DragValue`
3. **Integration Tests**: Full audio pipeline, TTS integration (`SingingVoice.integration.test.ts`)
4. **Performance Tests**: `SamplerPanel.perf.test.tsx`, `audioExport.perf.test.ts`, `useAudioEngine.perf.test.tsx`, `wasmMigration.bench.test.ts`
5. **Accessibility Tests**: `AppAccessibility.test.tsx`, `AutomationStepA11y.test.tsx`, `LiveKeyboardA11y.test.tsx`, `SongModeA11y.test.tsx`, `VoiceEditorA11y.test.tsx`

### E2E Tests (Playwright)
- **Location**: `tests/*.spec.ts`
- **Config**: `playwright.config.ts`
- **Base URL**: `http://localhost:5173`

### Mocking
- `AudioContext` fully mocked in `vitest.setup.ts`
- `AudioWorkletNode` stubbed
- `Worker` constructor mocked
- WebGPU APIs mocked where needed

---

## Deployment

### Prerequisites
1. Build production assets: `npm run build`
2. Verify `dist/` directory exists and contains all WASM files
3. Ensure server has COOP/COEP headers configured (for threaded WASM)

### VPS Storage (Primary)
- **Client**: `src/services/CloudStorage.ts`
- **Base URL**: `https://storage.noahcohn.com:8000`
- Provides REST API for songs, patterns, banks, samples
- Endpoints:
  - `GET /api/songs` — List songs (with optional `?type=` and `?search=`)
  - `POST /api/songs` — Upload song
  - `GET /api/songs/{id}` — Get song data
  - `DELETE /api/songs/{id}` — Delete song
  - `PATCH /api/songs/{id}` — Update song metadata

### FastAPI Cloud Server (`app.py`)
- Runs on port 7860 by default
- Uses async SFTP via `paramiko` with a connection pool and `ThreadPoolExecutor`
- In-memory caching for library lists (30 seconds)
- **Environment Variables**:
  - `FTP_HOST` — SFTP server hostname
  - `FTP_USER` — SFTP username
  - `FTP_PASS` — SFTP password
  - `FTP_PORT` — SFTP port (default: 22)
  - `FTP_DIR` — Base directory (default: `storage.1ink.us`)

### Frontend Deploy Script (`deploy.py`)
- Uploads the `dist/` directory to a remote server via SFTP using `paramiko`
- Hardcodes target server details; edit directly if deploying elsewhere

---

## Security Considerations

1. **SFTP Credentials**: Cloud storage uses environment variables for SFTP credentials. Never commit credentials to the repository.

2. **CORS**: The FastAPI backend (`app.py`) has CORS configured with `allow_origins=["*"]`. Restrict this in production if needed.

3. **File Uploads**: Sample uploads are validated by extension. Additional sanitization is recommended for production.

4. **Pyodide Execution**: Python code runs in a WebAssembly sandbox via Pyodide. Do not expose sensitive APIs to the Python environment.

5. **Hardcoded Password in `deploy.py`**: The deployment script contains a plaintext password. Rotate credentials and move to environment variables for production use.

---

## Key Type Definitions

### Track Structure
```typescript
type TrackKey = 'partA' | 'partB' | 'bass2' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

interface Pattern {
  partA: PartSequence;
  partB: PartSequence;
  bass2: PartSequence;
  kick: PartSequence;
  snare: PartSequence;
  closedHat: PartSequence;
  openHat: PartSequence;
  sampler: PartSequence[]; // Array of 8 sequences
}

interface PartSequence {
  steps: (Note | null)[];
}

interface Note {
  note: string;        // e.g., 'C4'
  velocity: number;    // 0-1
  length?: number;     // Duration in steps
  slide?: boolean;     // Portamento
  chord?: string[];    // Additional notes
  timbre?: number;     // 0-1 tonal character
  probability?: number;// 0-1 chance of triggering
  microtiming?: number;// -0.5 to 0.5 step offset
  reverse?: boolean;   // Reverse playback (sampler)
  sliceIndex?: number; // Phoneme/slice index (sampler)
}
```

---

## Common Pitfalls

1. **"WASM not found" errors**: Check that all build steps completed and files exist in `public/`. Run `npm run build:wasm` and `npm run build:emcc`.

2. **AudioContext suspended**: Browsers require user interaction before the audio context can resume. The `useAudioEngine` hook handles this, and the UI has an explicit "Start Audio" overlay (`StartOverlay`).

3. **SharedArrayBuffer errors**: Server headers must include COOP/COEP. Check the browser console for specific errors. The single-threaded JC-303 variant does not require these headers.

4. **Emscripten build failures**: Ensure `emscripten/libomp.a` exists and the Emscripten SDK is activated. The build script searches several common `emsdk_env.sh` locations.

5. **AudioWorklet not loading**: Worklets must be loaded from the same origin or with proper CORS. Vite dev server handles this; production servers must be configured accordingly.

6. **Pyodide initialization**: The Emscripten module initializes Pyodide. Check `window.Module` is available before accessing Python APIs. Pyodide is loaded from CDN in `index.html`.

7. **JC-303 submodule not found**: Run `git submodule update --init jc303_wasm`

8. **Stale `src/wasm/` directory**: This folder is generated during AssemblyScript builds. If it is missing, AssemblyScript modules will fail to load in dev. It is not committed to git.

---

## Resources

- **Supertonic TTS**: https://github.com/supertone-inc/supertonic
- **Rubberband Library**: https://breakfastquay.com/rubberband/
- **JC-303**: TB-303 clone synthesizer (git submodule)
- **Emscripten**: https://emscripten.org/
- **AssemblyScript**: https://www.assemblyscript.org/
