# AGENTS.md

## Project Overview

**Hyphon** (also referred to as `web_sequencer`) is a browser-based Digital Audio Workstation (DAW) inspired by the Korg Electribe EA-1/ER-1. It features a 32-step sequencer with dual synthesizers, drum machine, sampler with TTS voice synthesis, and a hardware-style interface.

### Key Features
- Dual synthesizers (Lead & Bass) with ADSR, filters, and multiple waveform engines
- Drum machine (Kick, Snare, Open/Closed Hi-Hats)
- Sampler with 8 independent banks and Supertonic TTS integration
- Real-time voice designer with GPU-accelerated DSP
- Song mode for pattern arrangement
- 3D studio visualization (React Three Fiber)
- Cloud storage for songs, patterns, and samples
- XM module export

## Technology Stack

### Frontend
- **Framework**: React 19.x with TypeScript 5.9+
- **Build Tool**: Vite 5.x with ESNext modules
- **Styling**: Tailwind CSS 3.4
- **3D Graphics**: React Three Fiber (@react-three/fiber, @react-three/drei)
- **Fonts**: Orbitron (headers), Roboto Mono (UI)

### Audio Architecture (Multi-Engine)
| Engine | Language | Compilation | Output | Purpose |
|--------|----------|-------------|--------|---------|
| AssemblyScript | TypeScript-like | `asc` | `src/wasm/*.wasm` | Oscillators, Track Freezer |
| Rust Audio | Rust | `wasm-pack` | `public/rust-wasm/` | High-precision synthesis |
| Emscripten | C++ | `emscripten/build.sh` | `public/hyphon_native.js` | Rubberband pitch shifting |
| JC-303 | C++ | `tools/build_jc303_omp.sh` | `public/jc303.*` | TB-303 clone synthesizer |
| WebGPU | WGSL/TypeScript | Runtime | N/A | Massive oscillator compute |
| Web Audio | TypeScript | Native | N/A | Primary audio graph |

### Backend & Services
- **Cloud API**: Python FastAPI (app.py) with async SFTP storage
- **TTS Engine**: Python/Pyodide with ONNX Runtime Web
- **Voice Designer**: PyQt5 desktop tool (Supertonic-Voice-Mixer/)

### Testing
- **Framework**: Vitest 2.x with happy-dom environment
- **Utilities**: React Testing Library, @testing-library/jest-dom
- **Location**: `src/__tests__/` and `src/components/__tests__/`

## Directory Structure

```
/
├── src/                          # Main React application
│   ├── components/               # UI components (Knobs, Sequencer, etc.)
│   │   ├── HardwareModule.tsx    # Main synth interface
│   │   ├── Sequencer.tsx         # 32-step sequencer grid
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
│   │   ├── useScheduler.ts       # Transport/sequencer logic
│   │   └── ...
│   ├── services/                 # External service integrations
│   │   ├── CloudStorage.ts       # FastAPI cloud client
│   │   ├── Supertonic.ts         # TTS model loader
│   │   └── WebGpuBackend.ts      # WebGPU initialization
│   ├── utils/                    # Utility functions
│   │   ├── audioExport.ts        # WAV export functionality
│   │   ├── xmExport.ts           # XM module export
│   │   ├── musicTheory.ts        # Note/MIDI conversions
│   │   └── xm_save_lib/          # XM file format library
│   ├── audio-worklets/           # AudioWorklet processors
│   │   ├── sustain-processor.ts  # Sample sustain/loop modes with Rubber Band pitch shifting
│   │   ├── open303-processor.ts  # TB-303 audio worklet
│   │   └── rubberband-processor.ts
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
│   ├── pre.js                    # Pre-load hooks
│   ├── pyodide_bootstrap.js      # Python initialization
│   └── libomp.a                  # OpenMP runtime (required)
├── jc303_wasm/                   # TB-303 clone (git submodule)
│   └── wasm/                     # CMake-based build
├── Supertonic-Voice-Mixer/       # Python TTS tools
│   ├── voice-mixer.py            # PyQt5 voice designer GUI
│   └── helper.py                 # TTS model utilities
├── web/                          # Legacy web mixer (separate)
├── public/                       # Static assets + compiled WASM
│   ├── audio-worklets/           # Copied worklet files
│   ├── pyodide.*                 # Python runtime
│   ├── rubberband.wasm           # Rubberband binary
│   ├── hyphon_native.js          # Emscripten output
│   ├── jc303.*                   # TB-303 WASM
│   └── assets/                   # WAV samples, etc.
├── tests/                        # Playwright E2E tests
├── tools/                        # Build scripts
│   ├── build_jc303_omp.sh        # JC-303 builder
│   └── optimize.sh               # Post-build optimizer
└── app.py                        # FastAPI cloud storage server
```

## Build Commands

### Development
```bash
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
python3 voice-mixer.py
```

## Build Rules & Critical Directives

### The "Four Worlds" Rule
This project has four distinct build environments. **Never mix their build steps**:

1. **AssemblyScript World** (`/assembly`)
   - Source: `*.ts` files with `// @mode: assemblyscript` header
   - Build: `npm run build:wasm:oscillators` or `npm run build:wasm:freezer`
   - Output: `src/wasm/*.wasm`
   - Bridge: Corresponding engine file in `src/engines/`

2. **Rust World** (`/rust-audio`)
   - Build: `cd rust-audio && wasm-pack build --target web --out-dir ../public/rust-wasm`
   - Output: `public/rust-wasm/`
   - Bridge: `src/engines/RustOscillator.ts`

3. **Emscripten World** (`/emscripten`)
   - Build: `bash emscripten/build.sh`
   - Output: `public/hyphon_native.js` (+ .wasm, .worker.js)
   - Requires: `libomp.a` in `emscripten/` directory
   - Requires: Emscripten SDK activated

4. **JC-303 World** (`/jc303_wasm`)
   - Build: `bash tools/build_jc303_omp.sh`
   - Output: `public/jc303.*`
   - Requires: Git submodule initialized

### SharedArrayBuffer Requirements
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
If deploying to a new environment, these headers MUST be set or the app will fail to load.

### WASM Change Detection
**Critical**: After modifying any C++, Rust, or AssemblyScript source, you MUST rebuild the corresponding WASM module. The `public/` directory contains compiled binaries that Vite serves directly - stale binaries will be loaded if not rebuilt.

## Code Style Guidelines

### TypeScript
- Strict mode enabled (`strict: true` in tsconfig)
- Unused locals/parameters are errors (can prefix with `_` to ignore)
- ES2022 target with modern DOM APIs
- React JSX transform (`jsx: "react-jsx"`)
- Import paths use `@/` alias for `src/`

### React Patterns
- Functional components with hooks
- Custom hooks for complex logic (see `src/hooks/`)
- Memoization with `useMemo`, `useCallback`, `memo` for performance
- Lazy loading for heavy components (Studio3D)
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

## Testing Strategy

### Unit Tests
- Location: `src/__tests__/*.test.ts`
- Components: `src/components/__tests__/*.test.tsx`
- Audio engine mocking in `vitest.setup.ts`
- Happy DOM environment for browser APIs

### Test Categories
1. **Engine Tests**: WasmOscillator, WebGPU, AudioExport
2. **Component Tests**: Knob, Sequencer, SamplerPanel, etc.
3. **Integration Tests**: SingingVoice, full audio pipeline
4. **Performance Tests**: Sampler panel rendering, audio export

### Mocking
- `AudioContext` fully mocked in `vitest.setup.ts`
- `AudioWorkletNode` stubbed
- `Worker` constructor mocked
- WebGPU APIs mocked where needed

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

## Deployment

### Prerequisites
1. Build production assets: `npm run build`
2. Verify `dist/` directory exists and contains all WASM files
3. Ensure server has COOP/COEP headers configured

### Cloud Storage Server
- FastAPI application in `app.py`
- Requires environment variables: `FTP_HOST`, `FTP_USER`, `FTP_PASS`
- Runs on port 7860 by default
- Supports songs, patterns, banks, and samples via SFTP

### TTS Model Files (Optional)
For voice synthesis feature, download models (~235 MB):
```bash
bash download_models.sh
```
Without models, TTS features gracefully degrade.

## Common Pitfalls

1. **"WASM not found" errors**: Check that all build steps completed and files exist in `public/`

2. **AudioContext suspended**: Browsers require user interaction before audio context can resume. The `useAudioEngine` hook handles this, but UI should have explicit "Start Audio" button.

3. **SharedArrayBuffer errors**: Server headers must include COOP/COEP. Check browser console for specific errors.

4. **Emscripten build failures**: Ensure `emscripten/libomp.a` exists and Emscripten SDK is activated.

5. **AudioWorklet not loading**: Worklets must be loaded from same origin or with proper CORS. Vite dev server handles this; production server must be configured.

6. **Pyodide initialization**: The Emscripten module initializes Pyodide. Check `window.Module` is available before accessing Python.

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
