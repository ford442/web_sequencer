# AGENTS.md

## Project Context
**web_sequencer** is a browser-based music production environment (DAW) utilizing a high-performance hybrid architecture.
* **Frontend:** React + TypeScript + Vite.
* **Audio Engine A (Synthesis):** Rust (compiled to WASM via `wasm-pack`).
* **Audio Engine B (Legacy/Effects):** C++ (compiled to WASM via Emscripten).
* **Audio Engine C (Compute):** WebGPU (Compute Shaders) for massive oscillator counts.
* **Voice Synthesis:** Python (Supertonic) for offline generation.

## Key Directives (The "Three Worlds" Rule)
You must treat this repository as three distinct environments. Do not mix their build steps.

### 1. The Frontend World (`/src`)
* **Standard:** React functional components with Tailwind CSS.
* **State:** Uses `zustand` (implied by complex audio state) or React Context.
* **Audio Bridge:** The frontend *never* generates sound directly. It sends messages to the Audio Worklets or SharedArrayBuffers.
* **Visuals:** Canvas/WebGL for oscilloscopes (`Oscilloscope.tsx`) and grid indicators.

### 2. The Rust World (`/rust-audio`)
* **Role:** High-precision synthesis (WasmOscillator).
* **Build Rule:** If you modify `.rs` files, you **MUST** rebuild the WASM.
    * *Command:* `cd rust-audio && wasm-pack build --target web --out-dir ../public/wasm-rust` (Verify output path).
* **Interface:** helper function in `src/engines/RustOscillator.ts`.

### 3. The Emscripten World (`/emscripten`)
* **Role:** Legacy effects or heavy C++ processing.
* **Build Rule:** Uses a shell script.
    * *Command:* `./emscripten/build.sh`
* **Output:** Generates `.wasm` and `.js` glue in `public/`.

## Directory Structure
* **`/src`**: React Application.
    * **`/components`**: UI Widgets (Knobs, Sequencer Grid).
    * **`/engines`**: TypeScript wrappers for the WASM/WebGPU cores.
    * **`/hooks`**: `useAudioEngine.ts` (The central switchboard).
* **`/rust-audio`**: Rust source code.
* **`/emscripten`**: C++ source code.
* **`/assembly`**: AssemblyScript source (TrackFreezer/Oscillators).
* **`/public`**: Static assets. **CRITICAL:** This is where compiled WASM binaries live.
* **`/Supertonic-Voice-Mixer`**: Python tools for TTS generation.

## Available Tools & Commands

### Development
* **Start App:** `npm run dev`
* **Typecheck:** `npm run typecheck` (or `tsc`).

### Build & Deploy
* **Build Frontend:** `npm run build`
* **Deploy:** `python3 deploy.py`
    * *Description:* Uploads the `dist/` folder to the staging server.
    * *Requirement:* Run `npm run build` first.

### Generators (Python)
* **Voice Mixer:** `python3 Supertonic-Voice-Mixer/voice-mixer.py`
    * *Usage:* Generates new voice sample banks for the sampler.

## Common Pitfalls
1.  **"WASM changes ignored":** If you edit C++ or Rust but don't run their specific build commands, the `public/` folder will contain old binaries. The browser will load the old code.
2.  **SharedArrayBuffer:** This project relies on `SharedArrayBuffer` for audio thread communication. It requires specific COOP/COEP headers. If the app fails to load in a new environment, check the server headers.
3.  **AudioWorklet Loading:** Worklets are loaded asynchronously. Ensure `useAudioEngine` has initialized (`isReady`) before attempting to trigger notes.
