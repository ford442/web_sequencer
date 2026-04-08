# AGENTS.md

## Project Overview

**Hyphon** is a browser-based Digital Audio Workstation (DAW) inspired by the Korg Electribe EA-1/ER-1. It features a 32-step sequencer with dual synthesizers, drum machine, sampler with TTS voice synthesis, and a hardware-style interface.

### Key Features
- **Dual synthesizers** (Lead & Bass) with ADSR, filters, and multiple waveform engines
- **Drum machine** (Kick, Snare, Open/Closed Hi-Hats)
- **Sampler with 8 independent banks** and Supertonic TTS integration
- **Real-time voice designer** with GPU-accelerated DSP
- **Song mode** for pattern arrangement
- **3D studio visualization** (React Three Fiber)
- **Cloud storage** for songs, patterns, and samples
- **XM module export**

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.x | UI Framework |
| TypeScript | 5.9+ | Language |
| Vite | 5.x | Build Tool |
| Tailwind CSS | 3.4 | Styling |
| React Three Fiber | 9.x | 3D Graphics |
| Three.js | 0.182.x | 3D Engine |
| ONNX Runtime Web | 1.23.x | TTS Inference |

### Audio Architecture (Multi-Engine)
| Engine | Language | Build Output | Purpose |
|--------|----------|--------------|---------|
| AssemblyScript | TypeScript-like | `src/wasm/*.wasm` | Oscillators, Track Freezer |
| Rust/WASM | Rust | `public/rust-wasm/` | High-precision synthesis |
| Emscripten | C++ | `public/hyphon_native.js` | Rubberband pitch shifting |
| JC-303 | C++ | `public/jc303.*` | TB-303 clone synthesizer |
| WebGPU | WGSL/TypeScript | Runtime | GPU-accelerated DSP |
| Web Audio | TypeScript | Native | Primary audio graph |

### Backend & Services
| Component | Technology | Purpose |
|-----------|------------|---------|
| Cloud API | Python FastAPI | Async SFTP storage |
| TTS Engine | Python/Pyodide | ONNX Runtime Web |
| Voice Designer | PyQt5 | Desktop tool (`Supertonic-Voice-Mixer/`) |

---

## Directory Structure

```
/
├── src/                          # Main React application
│   ├── components/               # UI components
│   │   ├── HardwareModule.tsx    # Main synth interface with knobs
│   │   ├── MainSequencer.tsx     # 32-step sequencer grid
│   │   ├── SamplerPanel.tsx      # Sampler with TTS controls
│   │   ├── VoiceEditor.tsx       # Real-time voice parameter editor
│   │   ├── Studio3D.tsx          # 3D visualization (lazy loaded)
│   │   └── ...
│   ├── engines/                  # Audio engine wrappers
│   │   ├── WasmOscillator.ts     # AssemblyScript bridge
│   │   ├── RustOscillator.ts     # Rust/WASM bridge
│   │   ├── WebGpuOscillator.ts   # WebGPU compute backend
│   │   ├── Open303Oscillator.ts  # TB-303 clone interface
│   │   ├── SingingVoice.ts       # TTS/voice processing
│   │   └── rubberband/           # Pitch shifting utilities
│   ├── hooks/                    # React hooks
│   │   ├── useAudioEngine.ts     # Central audio initialization
│   │   ├── usePyodideEngine.ts   # Python/TTS engine
│   │   └── useScheduler.ts       # Transport/sequencer logic
│   ├── services/                 # External service integrations
│   │   ├── CloudStorage.ts       # FastAPI cloud client
│   │   ├── Supertonic.ts         # TTS model loader
│   │   └── WebGpuBackend.ts      # WebGPU initialization
│   ├── utils/                    # Utility functions
│   │   ├── audioExport.ts        # WAV export functionality
│   │   ├── xmExport.ts           # XM module export
│   │   └── xm_save_lib/          # XM file format library
│   ├── audio-worklets/           # AudioWorklet processors
│   │   ├── sustain-processor.ts  # Sample sustain/loop modes
│   │   ├── open303-processor.ts  # TB-303 audio worklet
│   │   └── rubberband-processor.ts
│   ├── workers/                  # Web Workers
│   │   └── renderer.worker.ts    # Offline audio rendering
│   ├── types.ts                  # TypeScript type definitions
│   ├── constants.ts              # Default values, patterns
│   └── __tests__/                # Unit/integration tests
├── assembly/                     # AssemblyScript source
│   ├── oscillators.ts            # WASM oscillator DSP
│   └── trackFreezer.ts           # Track rendering/bouncing
├── rust-audio/                   # Rust source code
│   └── src/lib.rs                # WASM synthesis engine
├── emscripten/                   # C++ Emscripten build
│   ├── build.sh                  # Main build script
│   ├── rubberband_wrapper.cpp    # Rubberband interface
│   ├── main.cpp                  # Emscripten entry point
│   ├── libomp.a                  # OpenMP runtime (required)
│   ├── pre.js                    # Pre-load hooks
│   └── pyodide_bootstrap.js      # Python initialization
├── jc303_wasm/                   # TB-303 clone (git submodule)
│   └── wasm/                     # CMake-based build
├── Supertonic-Voice-Mixer/       # Python TTS tools
│   ├── voice-mixer.py            # PyQt5 voice designer GUI
│   └── helper.py                 # TTS model utilities
├── public/                       # Static assets + compiled WASM
│   ├── audio-worklets/           # Copied worklet files
│   ├── pyodide.*                 # Python runtime
│   ├── rubberband.wasm           # Rubberband binary
│   ├── hyphon_native.js          # Emscripten output
│   ├── jc303.*                   # TB-303 WASM
│   └── assets/                   # WAV samples
├── tests/                        # Playwright E2E tests
├── tools/                        # Build scripts
│   ├── build_jc303_omp.sh        # JC-303 builder
│   └── optimize.sh               # Post-build optimizer
└── app.py                        # FastAPI cloud storage server
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

# Build specific modules
npm run build:wasm:oscillators    # AssemblyScript oscillators
npm run build:wasm:freezer        # AssemblyScript track freezer
npm run build:wasm:rust           # Rust audio engine
npm run build:wasm:jc303          # TB-303 clone (requires Emscripten)

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
# Run all tests
npm test

# Run with Vitest UI (if configured)
npx vitest --ui

# Run Playwright E2E tests
npx playwright test
```

### Deployment
```bash
# Deploy to staging server (requires dist/ to exist)
npm run deploy
# Or: python3 deploy.py
```

### Python Voice Mixer (Desktop Tool)
```bash
cd Supertonic-Voice-Mixer
pip install numpy sounddevice matplotlib PyQt5 onnxruntime
python3 voice-mixer.py
```

---

## The "Four Worlds" Rule

This project has **four distinct build environments**. **Never mix their build steps**:

### 1. AssemblyScript World (`/assembly`)
- **Source**: `*.ts` files with `// @mode: assemblyscript` header
- **Build**: `npm run build:wasm:oscillators` or `npm run build:wasm:freezer`
- **Output**: `src/wasm/*.wasm`
- **Bridge**: Corresponding engine file in `src/engines/`

### 2. Rust World (`/rust-audio`)
- **Build**: `cd rust-audio && wasm-pack build --target web --out-dir ../public/rust-wasm`
- **Output**: `public/rust-wasm/`
- **Bridge**: `src/engines/RustOscillator.ts`

### 3. Emscripten World (`/emscripten`)
- **Build**: `bash emscripten/build.sh`
- **Output**: `public/hyphon_native.js` (+ .wasm, .worker.js)
- **Requires**: `libomp.a` in `emscripten/` directory
- **Requires**: Emscripten SDK activated

### 4. JC-303 World (`/jc303_wasm`)
- **Build**: `bash tools/build_jc303_omp.sh debug both`
- **Output**: `public/jc303.*`
- **Requires**: Git submodule initialized (`git submodule update --init`)

---

## SharedArrayBuffer Requirements

This project uses `SharedArrayBuffer` for audio thread communication. The Vite dev server is configured with the required headers:

```javascript
// vite.config.ts
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  }
}
```

**If deploying to a new environment, these headers MUST be set or the app will fail to load.**

---

## WASM Change Detection

**Critical**: After modifying any C++, Rust, or AssemblyScript source, you MUST rebuild the corresponding WASM module. The `public/` directory contains compiled binaries that Vite serves directly - stale binaries will be loaded if not rebuilt.

---

## Code Style Guidelines

### TypeScript
- Strict mode enabled (`strict: true` in tsconfig)
- Unused locals/parameters are errors (prefix with `_` to ignore)
- ES2022 target with modern DOM APIs
- React JSX transform (`jsx: "react-jsx"`)
- Import paths use `@/` alias for `src/`

### React Patterns
- Functional components with hooks
- Custom hooks for complex logic (see `src/hooks/`)
- Memoization with `useMemo`, `useCallback`, `memo` for performance
- Lazy loading for heavy components (`Studio3D`)
- Refs for audio engine instances (avoid re-renders)

### Audio Engine Patterns
- Audio engines are initialized in `useAudioEngine` hook
- Worklets are loaded asynchronously - check `isReady` before use
- Master gain/panner chain: `source -> filter -> gain -> master -> destination`
- Active note tracking via refs (Maps for note IDs)

### ESLint Configuration
- Uses `typescript-eslint` with strict recommended rules
- React Hooks rules enforced
- Unused vars pattern: `^_|^_` (ignore underscore-prefixed)
- Ignores `dist/` directory

---

## Testing Strategy

### Unit Tests (Vitest)
- **Location**: `src/__tests__/*.test.ts`
- **Components**: `src/components/__tests__/*.test.tsx`
- **Environment**: `happy-dom`
- **Setup**: `vitest.setup.ts` with mocked AudioContext

### Test Categories
1. **Engine Tests**: `WasmOscillator`, `WebGPU`, `AudioExport`, `SingingVoice`
2. **Component Tests**: `Knob`, `Sequencer`, `SamplerPanel`, `VoiceEditor`
3. **Integration Tests**: Full audio pipeline, TTS integration
4. **Performance Tests**: Sampler panel rendering, audio export

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

## Development Conventions

### Adding a New Audio Engine
1. Create engine class in `src/engines/`
2. Add WASM build command to `package.json` scripts
3. Add initialization to `useAudioEngine.ts`
4. Connect to master gain chain
5. Add cleanup in engine destructor

### Adding a New Component
1. Create in `src/components/`
2. Export from component index if shared
3. Add test in `src/components/__tests__/` for complex components
4. Use Tailwind for styling, `font-orbitron` for headers

### State Management
- Local component state: `useState`
- Audio engine state: `useRef` (avoid re-renders)
- Shared UI state: Props drilling or context
- Pattern/sequencer data: Managed in `App.tsx`, passed to children

---

## Deployment

### Prerequisites
1. Build production assets: `npm run build`
2. Verify `dist/` directory exists and contains all WASM files
3. Ensure server has COOP/COEP headers configured

### Cloud Storage Server
- FastAPI application in `app.py`
- **Environment Variables**:
  - `FTP_HOST` - SFTP server hostname
  - `FTP_USER` - SFTP username
  - `FTP_PASS` - SFTP password
  - `FTP_PORT` - SFTP port (default: 22)
  - `FTP_DIR` - Base directory (default: `storage.1ink.us`)
- Runs on port 7860 by default
- Supports songs, patterns, banks, and samples via SFTP

### VPS Storage (Primary)
- **URL**: `https://storage.noahcohn.com:8000`
- **Alternative**: `https://storage.1ink.us`
- Provides REST API for songs, patterns, banks, samples
- Endpoints:
  - `GET /api/songs` - List songs
  - `POST /api/songs` - Upload song
  - `GET /api/songs/{id}` - Get song data
  - `DELETE /api/songs/{id}` - Delete song
  - `PATCH /api/songs/{id}` - Update song
  - `GET /api/patterns` - List patterns
  - `POST /api/patterns` - Upload pattern
  - `GET /api/banks` - List banks
  - `GET /api/samples` - List samples
  - `POST /api/samples` - Upload sample
- CORS enabled for all origins

### TTS Model Files (Optional)
For voice synthesis feature, download models (~235 MB):
```bash
bash download_models.sh
```

Required files:
- 4 ONNX models (duration_predictor, text_encoder, vector_estimator, vocoder)
- Configuration files (tts.json, unicode_indexer.json)
- Voice style files (M1.json, etc.)

Without models, TTS features gracefully degrade.

---

## Common Pitfalls

1. **"WASM not found" errors**: Check that all build steps completed and files exist in `public/`

2. **AudioContext suspended**: Browsers require user interaction before audio context can resume. The `useAudioEngine` hook handles this, but UI has explicit "Start Audio" button.

3. **SharedArrayBuffer errors**: Server headers must include COOP/COEP. Check browser console for specific errors.

4. **Emscripten build failures**: Ensure `emscripten/libomp.a` exists and Emscripten SDK is activated.

5. **AudioWorklet not loading**: Worklets must be loaded from same origin or with proper CORS. Vite dev server handles this; production server must be configured.

6. **Pyodide initialization**: The Emscripten module initializes Pyodide. Check `window.Module` is available before accessing Python.

7. **JC-303 submodule not found**: Run `git submodule update --init jc303_wasm`

---

## Environment Setup

### Required
- Node.js 18+
- npm or pnpm

### Optional (for WASM development)
- Rust + wasm-pack (`cargo install wasm-pack`)
- Emscripten SDK
- CMake (for JC-303)

### IDE Configuration
- VS Code recommended with extensions:
  - ESLint
  - TypeScript Importer
  - Tailwind CSS IntelliSense
  - rust-analyzer (for Rust code)

---

## Security Considerations

1. **SFTP Credentials**: Cloud storage uses environment variables for SFTP credentials. Never commit credentials to the repository.

2. **CORS**: The FastAPI backend (`app.py`) has CORS configured with `allow_origins=["*"]`. Restrict this in production if needed.

3. **File Uploads**: Sample uploads are validated by extension. Additional sanitization is recommended for production.

4. **Pyodide Execution**: Python code runs in a WebAssembly sandbox via Pyodide. Do not expose sensitive APIs to the Python environment.

---

## Key Type Definitions

### Track Structure
```typescript
type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

interface Pattern {
  partA: PartSequence;
  partB: PartSequence;
  kick: PartSequence;
  snare: PartSequence;
  closedHat: PartSequence;
  openHat: PartSequence;
  sampler: PartSequence[]; // Array of 8 sequences
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

## Resources

- **Supertonic TTS**: https://github.com/supertone-inc/supertonic
- **Rubberband Library**: https://breakfastquay.com/rubberband/
- **JC-303**: TB-303 clone synthesizer (git submodule)
- **Emscripten**: https://emscripten.org/
- **AssemblyScript**: https://www.assemblyscript.org/
