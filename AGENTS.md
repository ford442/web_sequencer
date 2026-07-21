# AGENTS.md

> **Quick Navigation:** For an index of all root documentation files and subsystem docs, see [DOCS.md](DOCS.md).

## Project Overview

**Hyphon** is a browser-based Digital Audio Workstation (DAW) inspired by the Korg Electribe EA-1/ER-1. It features a 32-step sequencer with dual synthesizers, a drum machine, an 8-bank sampler with TTS voice synthesis, a TB-303 clone bass synthesizer, and a hardware-style interface.

### Key Features
- **Dual synthesizers** (Lead & Bass / Part A & Part B) with ADSR, filters, delay, and multiple waveform engines
- **TB-303 engines** with per-voice `model303` voice selection (growing catalog) and legacy `engine303` family switching (`open303` or authentic `jc303`) plus Prophecy formant waveforms
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
| Emscripten | C++ | `public/hyphon_native.js` (+ `.wasm`, `.worker.js`) | Rubberband, Open303 + JC303 dual-engine wrappers, Prophecy formant engine, Pyodide bootstrap |
| JC-303 | C++ (JUCE) | `public/jc303.*` | Legacy standalone TB-303-compatible wasm variants |
| WebGPU | WGSL/TypeScript | Runtime | GPU-accelerated DSP (voice designer, scope) |
| Web Audio | TypeScript | Native | Primary audio graph, scheduling, effects |

#### Emscripten dual-303 + Prophecy internals (`hyphon_native.wasm`)
- **Wrappers compiled together**: `emscripten/open303_wrapper.cpp`, `emscripten/jc303_wrapper.cpp`, `emscripten/prophecy_wrapper.cpp` (see `emscripten/build.sh`)
- **303 voice catalog**: `SynthParams.model303` (stable voice id, e.g. `stock-open303`, `experimental-01`) with legacy `engine303` mirror for older songs — see [docs/audio-engine/303-voices.md](docs/audio-engine/303-voices.md)
- **Per-voice 303 switching**: `model303` flows through `Open303Manager.setBass1Model/setBass2Model/setLead303Model` (and legacy `setBass1Engine/...`) into the `open303-processor` `set-303-model` message path
- **Current routing**:
  - `partB` / **SYNTH B** 303 waves → `bass1`
  - **BASS 2** 303 waves → `bass2`
  - `partA` / **SYNTH A LEAD** 303 waves → `lead303`
- **Prophecy formant routing**:
  - `prophecy-*` waves route via `ProphecyManager` (`partA` + `partB`) and `prophecy-processor` worklet to `prophecy_*` exports in `hyphon_native.wasm`.

### Backend & Services
| Component | Technology | Purpose |
|-----------|------------|---------|
| Cloud API Client | TypeScript (`src/services/CloudStorage.ts`) | REST client for VPS storage |
| Cloud Server | Python FastAPI (`app.py`) | Async SFTP storage proxy |
| TTS Engine | Python/Pyodide (in-browser) | ONNX Runtime Web voice synthesis |
| Voice Mixer | Python/PyQt5 (`Supertonic-Voice-Mixer/`) | Desktop voice designer tool |

### Package Manager
The repository contains both `package-lock.json` and `pnpm-lock.yaml`. **CI/CD uses pnpm** (version 9, Node 22). Local development can use either `npm` or `pnpm`, but prefer `pnpm install --frozen-lockfile` to match CI.

---

## Directory Structure

```
/
├── src/                          # Main React application (~209 TS/TSX files)
│   ├── App.tsx                   # Root component (~1,900 lines), central state orchestration
│   ├── main.tsx                  # React root entry (StrictMode)
│   ├── components/               # UI components (~43 files)
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
│   │   └── __tests__/            # Component tests (~13 files)
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
│   │   └── __tests__/            # Hook tests
│   ├── services/                 # External service integrations
│   │   ├── CloudStorage.ts       # VPS REST API client
│   │   ├── AISongStorage.ts      # AI song storage client
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
│   │   ├── trackFreezer.ts       # Track bounce logic
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
│   ├── constants/appDefaults.ts  # App-level defaults & storage types
│   └── __tests__/                # Unit/integration tests (~33 files)
├── assembly/                     # AssemblyScript source
│   ├── oscillators.ts            # WASM oscillator DSP
│   ├── trackFreezer.ts           # Track rendering/bouncing
│   ├── fft.ts                    # FFT DSP
│   ├── audioExport.ts            # WAV export DSP
│   └── xmExport.ts               # XM export DSP
├── rust-audio/                   # Rust source code
│   ├── src/lib.rs                # WASM synthesis engine
│   ├── Cargo.toml                # Rust package config
│   └── Cargo.lock
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
│   ├── CMakeLists.txt            # JUCE-based CMake project
│   └── wasm/                     # CMake-based build
├── rubberband/                   # Rubberband library source (in-repo, not submodule)
├── Supertonic-Voice-Mixer/       # Python TTS tools
│   ├── voice-mixer.py            # PyQt5 voice designer GUI
│   └── helper.py                 # TTS model utilities
├── public/                       # Static assets + compiled WASM
│   ├── audio-worklets/           # Copied worklet files
│   ├── rust-wasm/                # Rust wasm-pack output
│   ├── hyphon_native.js          # Emscripten output
│   ├── hyphon_native.worker.js   # Emscripten pthread worker
│   ├── rubberband.wasm           # Rubberband binary
│   ├── jc303_worklet.js          # JC-303 worklet
│   ├── jc303-single.js           # JC-303 single-threaded loader
│   ├── jc303-single-worklet.js   # JC-303 single-threaded worklet
│   ├── pyodide.js                # Pyodide loader stub
│   ├── saw.wav / square.wav      # Native WAV oscillators
│   └── assets/                   # Additional static assets
├── tests/                        # Playwright E2E tests (~2 spec files)
├── tools/                        # Build scripts
│   ├── build_jc303_omp.sh        # JC-303 builder (threaded + single)
│   └── optimize.sh               # Post-build wasm-opt optimizer
├── web/                          # Legacy/alternate web build (TTS ONNX demo)
│   ├── package.json
│   └── vite.config.js
├── app.py                        # FastAPI cloud storage server
├── deploy.py                     # Bundle deployment script (zip + HTTP POST)
└── docs/                         # Project documentation by topic
```

---

## Build Commands

### Development
```bash
# Install dependencies (pnpm preferred to match CI)
pnpm install --frozen-lockfile

# Start dev server (builds WASM dependencies first)
pnpm run dev

# Type check only
npx tsc -b

# Lint
pnpm run lint
```

### WASM Builds (Individual)
```bash
# Build all AssemblyScript + Rust + JC-303 WASM modules
pnpm run build:wasm

# Build specific AssemblyScript modules
pnpm run build:wasm:oscillators    # Oscillator DSP
pnpm run build:wasm:freezer        # Track freezer / rendering
pnpm run build:wasm:fft            # FFT DSP
pnpm run build:wasm:audioexport    # WAV export DSP
pnpm run build:wasm:xmexport       # XM export DSP

# Build Rust audio engine
pnpm run build:wasm:rust

# Build JC-303 (requires Emscripten, git submodule)
pnpm run build:wasm:jc303

# Build Emscripten/Rubberband
pnpm run build:emcc
```

### Production Build
```bash
# Full production build (all WASM + optimize + TypeScript + Vite)
pnpm run build

# Output in dist/ directory
```

### Testing
```bash
# Run all Vitest tests
pnpm test

# Run with Vitest UI (if configured)
npx vitest --ui

# Run Playwright E2E tests
npx playwright test
```

### Deployment
```bash
# Deploy dist/ to the configured server (requires DEPLOY_TOKEN)
DEPLOY_TOKEN=... pnpm run deploy
# Or: DEPLOY_TOKEN=... python deploy.py

# Preview the bundle without uploading
python deploy.py --dry-run
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
- **Build**: `pnpm run build:wasm:oscillators`, `build:wasm:freezer`, `build:wasm:fft`, `build:wasm:audioexport`, `build:wasm:xmexport`
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
- **Wrappers**: Open303 (`open303_wrapper.cpp`), authentic JC303 multi-instance (`jc303_wrapper.cpp`), Prophecy formant (`prophecy_wrapper.cpp`)

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

**Critical**: After modifying any C++, Rust, or AssemblyScript source, you MUST rebuild the corresponding WASM module. The `public/` directory contains compiled binaries that Vite serves directly — stale binaries will be loaded if not rebuilt. Run `pnpm run build:wasm` and `pnpm run build:emcc` after any engine changes.

---

## Code Style Guidelines

### TypeScript
- **Strict mode enabled** (`strict: true` in `tsconfig.app.json`)
- **Target**: `ES2022` with modern DOM APIs
- **JSX transform**: `react-jsx`
- **Import alias**: `@/` maps to `src/`
- **Module resolution**: `bundler`
- **`verbatimModuleSyntax`**: `true` — use `import type` for type-only imports
- **`noUnusedLocals`** and **`noUnusedParameters`**: **disabled** in `tsconfig.app.json` (rely on ESLint instead)
- **`erasableSyntaxOnly`**: `true` — no enum/namespace emit

### ESLint Configuration
The project uses `typescript-eslint` with the flat config format (`eslint.config.js`). Note that **many rules are intentionally disabled** to accommodate the rapid prototyping nature of the project:

- `@typescript-eslint/no-unused-vars`: **off**
- `@typescript-eslint/no-explicit-any`: **off**
- `@typescript-eslint/ban-ts-comment`: **off**
- `react-hooks/exhaustive-deps`: **off**
- `react-refresh/only-export-components`: **off**
- `react-hooks/rules-of-hooks`: **off**
- `no-var`: **off**
- `no-empty`: **off**

Global ignores include: `dist/`, `emsdk/`, `assembly/`, `emscripten/`, `jc303_wasm/`, `rubberband/`, `public/`.

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

---

## Testing Strategy

### Unit Tests (Vitest)
- **Location**: `src/__tests__/*.{test.ts,test.tsx}` (~33 files)
- **Components**: `src/components/__tests__/*.{test.ts,test.tsx}` (~13 files)
- **Engines**: `src/engines/__tests__/*.{test.ts,test.tsx}`
- **Hooks**: `src/hooks/__tests__/*.{test.ts,test.tsx}`
- **Utils**: `src/utils/__tests__/*.{test.ts,test.tsx}`
- **Services**: `src/services/__tests__/*.{test.ts,test.tsx}`
- **Environment**: `happy-dom`
- **Setup**: `vitest.setup.ts` with fully mocked `AudioContext`

### Test Categories
1. **Engine Tests**: `WasmOscillator`, `WebGPU`, `AudioDSP`, `SingingVoice`, `SingingVoiceManager`, `FormantShifter`
2. **Component Tests**: `Knob`, `Sequencer`, `SamplerPanel`, `VoiceEditor`, `HardwareModule`, `NoteSelector`, `WaveformSelector`, `DragValue`
3. **Integration Tests**: Full audio pipeline, TTS integration (`SingingVoice.integration.test.ts`)
4. **Performance Tests**: `SamplerPanel.perf.test.tsx`, `audioExport.perf.test.ts`, `useAudioEngine.perf.test.tsx`, `wasmMigration.bench.test.ts`
5. **Accessibility Tests**: `AppAccessibility.test.tsx`, `AutomationStepA11y.test.tsx`, `LiveKeyboardA11y.test.tsx`, `SongModeA11y.test.tsx`, `VoiceEditorA11y.test.tsx`

### E2E Tests (Playwright)
- **Location**: `tests/*.spec.ts` (~2 spec files)
- **Config**: `playwright.config.ts`
- **Base URL**: `http://localhost:5173`

### Mocking
- `AudioContext` fully mocked in `vitest.setup.ts`
- `AudioWorkletNode` stubbed
- `Worker` constructor mocked
- WebGPU APIs mocked where needed
- IndexedDB mocked for tests

---

## CI/CD

### GitHub Actions Workflows
Located in `.github/workflows/`:

1. **CI** (`ci.yml`)
   - Triggers on push/PR to `main`
   - Runs on `ubuntu-latest`
   - Steps: checkout with submodules → setup pnpm 9 → setup Node 22 → setup Rust (wasm32 target) → setup Emscripten 3.1.51 → install dependencies → build WASM → lint (continue-on-error) → test with Vitest (`--pool forks`)

2. **Diagnostic Build & Test** (`debug_build.yml`)
   - Triggers on push/PR to `main`/`master` and `workflow_dispatch`
   - Builds full Emscripten + JC-303 WASM modules
   - Builds the Vite app and uploads `dist/` artifacts

3. **Playwright E2E** (`playwright-e2e.yml`)
   - Triggers on push/PR to `main`
   - Builds the full project (`pnpm run build`)
   - Installs Playwright browsers with deps
   - Serves `dist/` on port 5173
   - Runs Playwright tests with GitHub reporter

---

## Deployment

### Prerequisites
1. Build production assets: `pnpm run build`
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
- Runs on port **7860** by default
- Uses async SFTP via `paramiko` with a connection pool (`SFTPPool`, max 5 connections) and `ThreadPoolExecutor` (max 10 workers)
- In-memory caching for library lists (30 seconds via `aiocache`)
- GZip compression enabled for responses > 1000 bytes
- `INDEX_LOCK` (asyncio.Lock) prevents concurrent index corruption during uploads/deletes
- **Environment Variables**:
  - `FTP_HOST` — SFTP server hostname
  - `FTP_USER` — SFTP username
  - `FTP_PASS` — SFTP password
  - `FTP_PORT` — SFTP port (default: 22)
  - `FTP_DIR` — Base directory (default: `storage.1ink.us`)

### Frontend Deploy Script (`deploy.py`)
- Zips the contents of `dist/` and POSTs the archive to the deploy endpoint, which extracts it into the remote target folder (`hyphon`)
- Stdlib only — no `paramiko`/`requests` install needed
- Requires `DEPLOY_TOKEN` in the environment; **fails closed if unset**. Never hardcode it — this repository is public
- Endpoint defaults to `https://storage.noahcohn.com/api/deploy/web-sequencer/bundle`; override with `DEPLOY_ENDPOINT`
- Excludes `.map` files by default (~11 MB vs ~36 MB); pass `--include-sourcemaps` to ship them
- Does **not** deploy JC-303 / wasm assets served from `wasm.noahcohn.com` — deploy those independently if they changed

---

## Security Considerations

1. **SFTP Credentials**: Cloud storage uses environment variables for SFTP credentials. Never commit credentials to the repository.

2. **CORS**: The FastAPI backend (`app.py`) has CORS configured with `allow_origins=["*"]`. Restrict this in production if needed.

3. **File Uploads**: Sample uploads are validated by extension. Additional sanitization is recommended for production.

4. **Pyodide Execution**: Python code runs in a WebAssembly sandbox via Pyodide. Do not expose sensitive APIs to the Python environment.

5. **Deploy Token**: `deploy.py` reads `DEPLOY_TOKEN` from the environment and refuses to run without it. Earlier revisions of this script are reported to have carried a hardcoded token fallback in this public repo — that token should be treated as compromised and rotated on the VPS.

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

## Automation + RBS Import Architecture

- Parser: `src/importers/rbs/RbsParser.ts` parses fixed-offset `.rbs` binary content into `RawRbsData`.
- Importer: `src/importers/rbs/RbsImporter.ts` converts RBS patterns/params/automation into `HyphonSong`.
  - PCF conversion is controlled by `convertPcfToAutomation` and `importPcfAsFilter`.
  - TB-303 automation IDs map to Hyphon targets (`synthA`, `synthB`, `master`) with normalized values.
- Scheduler: `src/audio/automation/AutomationScheduler.ts` schedules lane/TRAK events on the audio clock and routes Open303 parameter updates via `Open303Manager.scheduleParamAtTime`.
- Focused tests:
  - `src/__tests__/RbsParser.test.ts`
  - `src/__tests__/RbsImporter.test.ts`
  - `src/__tests__/AutomationScheduler.test.ts`

---

## Common Pitfalls

1. **"WASM not found" errors**: Check that all build steps completed and files exist in `public/`. Run `pnpm run build:wasm` and `pnpm run build:emcc`.

2. **AudioContext suspended**: Browsers require user interaction before the audio context can resume. The `useAudioEngine` hook handles this, and the UI has an explicit "Start Audio" overlay (`StartOverlay`).

3. **SharedArrayBuffer errors**: Server headers must include COOP/COEP. Check the browser console for specific errors. The single-threaded JC-303 variant does not require these headers.

4. **Emscripten build failures**: Ensure `emscripten/libomp.a` exists and the Emscripten SDK is activated. The build script searches several common `emsdk_env.sh` locations.

5. **AudioWorklet not loading**: Worklets must be loaded from the same origin or with proper CORS. Vite dev server handles this; production servers must be configured accordingly.

6. **Pyodide initialization**: The Emscripten module initializes Pyodide. Check `window.Module` is available before accessing Python APIs. Pyodide is loaded from CDN in `index.html`.

7. **JC-303 submodule not found**: Run `git submodule update --init jc303_wasm`

8. **Stale `src/wasm/` directory**: This folder is generated during AssemblyScript builds. If it is missing, AssemblyScript modules will fail to load in dev. It is not committed to git.

---

## Cursor Cloud specific instructions

### One-time toolchain setup (not in the VM update script)

WASM artifacts are gitignored; a fresh checkout needs a one-time native toolchain install before the first dev session:

1. **Emscripten 3.1.51** (matches CI): clone to `$HOME/emsdk`, run `./emsdk install 3.1.51 && ./emsdk activate 3.1.51`, then `source "$HOME/emsdk/emsdk_env.sh"` in each shell that builds WASM.
2. **Rust wasm32 target**: `rustup target add wasm32-unknown-unknown` (wasm-pack ships via `pnpm`; use `pnpm exec wasm-pack`).
3. **Git submodule**: `git submodule update --init --recursive` (required for `jc303_wasm`).

### First WASM build per workspace

After `pnpm install`, with Emscripten sourced:

```bash
pnpm run build:wasm    # AssemblyScript + Rust + JC-303 (~1–2 min)
pnpm run build:emcc    # hyphon_native.js + Rubberband/Open303 (~30s)
```

Re-run only after changing `assembly/`, `rust-audio/`, `emscripten/`, or `jc303_wasm/` sources.

### Running the main DAW locally

| Task | Command |
|------|---------|
| Dev server (fast restart) | `pnpm exec vite --host 0.0.0.0 --port 5173` |
| Dev server (rebuilds WASM every start) | `pnpm run dev` |
| Unit tests | `CI=true pnpm exec vitest run --pool forks` |
| Lint | `pnpm run lint` |
| Production build | `pnpm run build` |

Only the **Vite dev server on port 5173** is required for interactive development. The FastAPI cloud API (`app.py`, port 7860) and remote storage are optional.

### Hello-world smoke test

1. Open http://localhost:5173
2. Click **INITIALIZE SYSTEM** (user gesture required for Web Audio)
3. Program a kick on step 1 in the sequencer grid
4. Click **▶ PLAY** — playhead should advance and the kick should trigger

### Gotchas

- **`pnpm run dev` is slow**: it always runs `build:wasm` and `build:emcc` before Vite. Prefer `pnpm exec vite` after WASM is already built.
- **COOP/COEP headers**: Vite sets these automatically; required for threaded WASM (`SharedArrayBuffer`).
- **pnpm ignored build scripts**: if `wasm-pack` is missing, use `pnpm exec wasm-pack` (bundled in devDependencies).
- **Rust audio import warning**: a console warning about `/rust-wasm/rust_audio.js` may appear in dev; core sequencer/audio still works. Use `public/rust-wasm/` paths if debugging the Rust engine.

---

## Resources

- **303 Voices catalog**: [docs/audio-engine/303-voices.md](docs/audio-engine/303-voices.md) — selectable TB-303 models, WASM registry, migration, tests
- **Supertonic TTS**: https://github.com/supertone-inc/supertonic
- **Rubberband Library**: https://breakfastquay.com/rubberband/
- **JC-303 / Open303 / Prophecy wrappers**: `emscripten/open303_wrapper.cpp`, `emscripten/jc303_wrapper.cpp`, `emscripten/prophecy_wrapper.cpp`
- **Emscripten**: https://emscripten.org/
- **AssemblyScript**: https://www.assemblyscript.org/
