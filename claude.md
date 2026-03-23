# Hyphon DAW - Claude Development Guide

## Project Overview

Hyphon is a sophisticated **web-based audio workstation** featuring:
- 32-step pattern sequencer with dual synths, drums, and sampler
- Hardware-inspired interface (Korg Electribe EA-1 ER-1 inspired)
- Web Audio API + WebAssembly audio engines
- TTS voice synthesis via ONNX Runtime
- Real-time effects and voice designer (GPU-accelerated)
- XM module export capability

**Status:** Complex, mature codebase with multiple interdependent systems

## Tech Stack

- **Frontend:** React 19 + TypeScript 5.9
- **Build:** Vite 5 + npm
- **Styling:** Tailwind CSS
- **3D Graphics:** Three.js + React Three Fiber
- **Audio Engines:**
  - Web Audio API native elements
  - AssemblyScript WASM (oscillators, track freezer)
  - Rust WASM (via wasm-pack)
  - Emscripten C++ (JC303 synth, RubberBand time-stretcher)
- **AI/ML:** ONNX Runtime Web (v1.23.2) for TTS
- **Testing:** Vitest + Playwright + React Testing Library
- **Linting:** ESLint with React plugins

## Project Structure

```
src/
├── components/          # React components (sequencer UI, hardware controls)
│   ├── sequencer/       # Core sequencer UI components
│   └── assets/          # Asset/sample management
├── stores/              # Global state management
├── hooks/
│   └── audioEngine/     # Audio engine integration hooks
├── engines/             # Audio engine implementations
│   ├── rubberband/      # Time-stretching engine
│   └── __tests__/
├── audio/               # Audio processing utilities
│   └── playback/        # Audio playback system
├── services/            # Business logic services
├── importers/           # Format importers (RBS, AI song)
├── types/               # TypeScript type definitions
└── __tests__/          # Integration tests
```

## Development Workflow

### Prerequisites
- Node.js 18+
- For TTS models: Run `bash download_models.sh` (~235 MB)
- Emscripten/C++ tooling (for audio engine compilation)

### Commands

```bash
# Development (builds WASM + runs Vite dev server)
npm run dev

# Build everything (WASM, Emscripten, Rust, optimizations)
npm run build

# Run tests
npm test

# Preview production build
npm run preview

# Lint code
npm lint

# Optimize assets
npm run optimize

# Deploy
npm run deploy
```

### WASM Build Details

The project has multiple WASM builds with specific purposes:
- `build:wasm:oscillators` - AssemblyScript oscillator engines
- `build:wasm:freezer` - Track freezer/time-stretch prep
- `build:wasm:rust` - Rust audio modules
- `build:wasm:jc303` - JC303 synth (C++ via Emscripten + OpenMP)

⚠️ **Important:** Individual WASM rebuilds may be needed after changes. The main `dev` and `build` commands handle this, but specific engine changes may require targeted rebuilds.

## Architecture Notes

### Key Systems to Understand

1. **Audio Engine Integration** (`src/hooks/audioEngine/`)
   - Manages lifecycle of audio engines
   - Handles playback state and timing
   - Integrates WASM modules

2. **Sequencer State** (`src/stores/`)
   - Pattern data (32 steps, 8 pattern slots per track)
   - Track configuration (synth params, drum samples)
   - Song arrangement mode
   - Per-bank TTS text storage

3. **Voice Designer** (`src/components/`)
   - GPU-accelerated DSP via WebGPU
   - CPU fallback for unsupported browsers
   - Geometric transformations (mirror, invert, shift)
   - Real-time heatmap visualization

4. **TTS System**
   - ONNX Runtime inference pipeline
   - Per-bank text phrases (separate for each of 8 sample banks)
   - Requires ONNX models + voice style files
   - Gracefully disabled if models unavailable

### Performance Considerations

- WebAssembly is critical for real-time audio performance
- GPU-accelerated DSP in Voice Designer uses WebGPU with CPU fallback
- Track freezer (WASM) used to render complex patterns as audio
- Memory-intensive: WASM modules configured with specific initialMemory values

## Testing Requirements

**Before committing:**
```bash
npm test          # Run all Vitest tests
npm lint          # Check code style
npm run build     # Ensure production build succeeds
```

**Test files:** Located alongside source files with `.test.ts(x)` suffix
- Unit tests in `src/__tests__/`
- Component tests in `src/components/__tests__/`
- Engine tests in `src/engines/__tests__/`

## Code Style & Conventions

- **TypeScript strict mode** - Use proper types, avoid `any`
- **React best practices** - Functional components, hooks over classes
- **Component naming** - PascalCase for components
- **Utility functions** - camelCase, kept in `services/` or colocated
- **Constants** - UPPER_SNAKE_CASE
- **WASM imports** - Use dynamic `import()` to handle loading

## Git Workflow

**Designated branch:** `claude/create-claude-docs-cHGb2`

**Important Git Rules:**
1. Develop on the assigned branch (starts with `claude/` and ends with session ID)
2. Use `git push -u origin <branch-name>` for first push
3. Branch validation: Must match pattern `claude/.*-cHGb2`
4. Commit with clear, descriptive messages
5. Never push to main/master without explicit permission

## Common Tasks & Gotchas

### Adding Audio Features
- Understand the audio engine pipeline in `src/hooks/audioEngine/`
- Test with Web Audio context lifecycle (suspend/resume)
- WASM modules must be properly imported async

### Modifying Synth Parameters
- Changes to JC303 require recompilation: `npm run build:wasm:jc303`
- Parameter changes propagate through audio engine hooks
- Test with both pre-allocated and real-time synthesis

### UI Changes to Sequencer
- Be careful with event handlers on step buttons (touch + mouse events)
- Knob interactions use custom canvas rendering or Three.js
- Hardware-style interface expects specific visual feedback

### TTS Integration
- Per-bank text is stored in sequencer state
- Generation is async and uses Web Workers via ONNX Runtime
- Voice Designer requires WebGPU context (with CPU fallback)
- Models download on first TTS use or via `download_models.sh`

## Debugging Tips

1. **Audio Issues:** Check Web Audio context state and analyser values
2. **WASM Loading:** Verify CORS headers and module paths in network tab
3. **State Management:** Use React DevTools to inspect store contents
4. **Performance:** Profile with DevTools, check for excessive re-renders
5. **TTS:** Check browser console for ONNX Runtime initialization

## Documentation References

- `README.md` - Quick start and feature overview
- `TTS_DEPLOYMENT.md` - Complete TTS setup and troubleshooting
- `DEVELOPER_CONTEXT.md` - Additional development context
- `INTEGRATION_SUMMARY.md` - Technical architecture details
- Various `*_IMPLEMENTATION_SUMMARY.md` files - Feature-specific docs

## Collaboration Notes

- Multiple engineers have contributed (ford442 most recent)
- Uses structured issue/PR workflow with meaningful descriptions
- Complex features are documented in markdown files before/after implementation
- Pay attention to existing patterns and conventions when extending features
