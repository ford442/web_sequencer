# DEVELOPER_CONTEXT.md

## 1. High-Level Architecture & Intent

### Core Purpose
**Hyphon DAW** is a browser-based, pattern-oriented audio workstation (DAW) inspired by grooveboxes like the Korg Electribe. It focuses on rhythmic sequencing, pattern chaining (Song Mode), and "hybrid" audio generation that leverages multiple browser technologies for performance and flexibility.

### Tech Stack
*   **Frontend:** React 19 (Vite), TypeScript, TailwindCSS.
*   **Backend (Storage):** Python 3.10+ (FastAPI) handling SFTP storage, concurrency, and caching.
*   **Audio Engine (Hybrid):**
    *   **Web Audio API:** Native nodes for routing, mixing, and basic sample playback.
    *   **Pyodide (WASM):** Python in the browser for complex audio rendering (drums, samplers) and DSP algorithms using `numpy`.
    *   **WebGPU:** Custom Compute Shaders (WGSL) for high-performance synthesizer waveform generation.
    *   **AssemblyScript (WASM):** Compiled WASM modules for low-latency, real-time waveform generation fallback.
*   **Storage:** JSON-based project files, SFTP-based cloud library.
*   **Export:** Client-side XM (FastTracker 2) binary generation.

### Design Patterns
*   **Hybrid Audio Kernel:** The audio engine is not a single monolith but a collection of "Strategies" (WebGPU, WASM, Pyodide, Native) that can be swapped or combined based on availability and specific task (e.g., real-time vs. offline render).
*   **Lookahead Scheduler:** Audio timing is decoupled from the UI render loop. A scheduler calculates events in advance and queues them in the Audio Context to ensure precise rhythmic timing.
*   **Immutable-ish State:** The Pattern and Song state uses shallow copies for updates (`...prev`) to trigger React reconciliations efficiently without the overhead of deep cloning, except where specifically needed (like clear/copy operations).
*   **Worker Offloading:** Heavy audio rendering (offline export) and clock timing are offloaded to Web Workers to prevent Main Thread UI blocking.

## 2. Feature Map

*   **Pattern Sequencer:** The core grid interface.
    *   *Entry:* `src/components/Sequencer.tsx` (Logic moved to `src/App.tsx` directly).
    *   *State:* `pattern` state object in `App.tsx`.
*   **Song Mode:** Chaining patterns into a full arrangement.
    *   *Entry:* `src/components/SongMode.tsx`.
    *   *Logic:* `songStructure` state in `App.tsx` + `updateStorageForTrack` helper.
*   **Audio Engine:** The central sound coordinator.
    *   *Entry:* `src/hooks/useAudioEngine.ts`.
    *   *Key Functions:* `playSynth`, `playDrum`, `playSampler`, `initializeAudio`.
*   **Cloud Library:** Saving/Loading songs to the remote backend.
    *   *Entry:* `src/components/CloudLibrary.tsx`.
    *   *Service:* `src/services/CloudStorage.ts` (Note: File currently missing in some contexts, but referenced).
    *   *Backend:* `app.py`.
*   **Hardware Module:** The "knob" interface for synthesizer parameters.
    *   *Entry:* `src/components/HardwareModule.tsx`.
    *   *Rendering:* Uses WebGPU (canvas) for UI rendering of knobs.
*   **XM Export:** Converting the project to a legacy tracker format.
    *   *Entry:* `src/utils/xmExport.ts`.
*   **Voice Editor/Sampler:** TTS and sampling features.
    *   *Entry:* `src/components/SamplerPanel.tsx` & `VoiceEditor.tsx`.

## 3. Complexity Hotspots

### The "Hybrid" Audio Race
*   **Context:** `useAudioEngine.ts` initializes WebGPU, WASM, and Pyodide.
*   **Complexity:** These engines load asynchronously at different speeds. The engine must support "Graceful Degradation". If WebGPU fails, it falls back to WASM, then to Pyodide, then to Native Oscillators.
*   **Agent Note:** When modifying audio logic, **never assume an engine is present**. Always check `if (gpuEngineRef.current?.isSupported)` or `if (pyodideRef.current)`. The system is designed to run even if all "advanced" engines fail.

### Lookahead Scheduling & Threading
*   **Context:** `src/hooks/useScheduler.ts`.
*   **Complexity:** The scheduler runs on `requestAnimationFrame` (main thread) but schedules audio events in the future (`audioContext.currentTime + lookahead`).
*   **Danger:** If the main thread blocks (e.g., React rendering a huge list), the scheduler can "fall behind". The logic includes a "Catch-up Breaker" (`if (now > nextStepTime.current + stepDuration * 4)`) that resets the clock to prevent a machine-gun burst of delayed notes.
*   **Agent Note:** Do not remove the `while` loop or the catch-up guard in `useScheduler.ts`. They are critical for handling background tab throttling.

### State Synchronization (UI vs Audio)
*   **Context:** `App.tsx`.
*   **Complexity:** React State (`pattern`, `synthParams`) is too slow for the audio thread.
*   **Solution:** The app uses `useRef` mirrors (e.g., `synthARef`, `patternRef`) that are updated via `useEffect` whenever the React state changes. The Audio Engine reads from these **Refs**, not the State, to get the absolute latest values without waiting for a re-render cycle.
*   **Agent Note:** If you add a new synth parameter, you MUST update both the `useState` (for UI) and the `useRef` (for Audio).

### Backend Concurrency
*   **Context:** `app.py`.
*   **Complexity:** Uses `asyncio` for the web server but `paramiko` (SFTP) is blocking.
*   **Pattern:** All SFTP operations are wrapped in `run_in_executor` to offload them to a thread pool (`io_executor`).
*   **Danger:** `INDEX_LOCK` is used to prevent two uploads from corrupting the JSON index file simultaneously.
*   **Agent Note:** Do not make SFTP calls directly in the async route handlers; they will block the entire server.

## 4. Inherent Limitations & "Here be Dragons"

### Known Issues
*   **Pyodide Boot Time:** The application waits for Python to load (~3-5s). The "LOADING..." screen is mandatory.
*   **WebGPU Support:** Not all browsers support WebGPU. The `WebGpuOscillator.ts` has a hard check `if (!navigator.gpu)`.
*   **Worker Modules:** The project uses specific Vite worker imports (`new Worker(..., { type: 'module' })`). This can be fragile in some testing/bundling environments.

### Technical Debt
*   **Sequencer Rendering:** `SequencerRow` uses direct DOM manipulation (via `stepRefs`) to toggle CSS classes (`is-current`) instead of React props. This was done for performance (64+ steps updating at 160 BPM killed React performance). **Do not refactor this back to pure React props without ensuring 60fps performance.**
*   **Hardcoded Tracks:** The system assumes exactly 2 Synths, 4 Drums, and 1 Sampler. This is deeply hardcoded in `App.tsx` and `useAudioEngine.ts`. Adding a 3rd synth would require significant refactoring.

### Hard Constraints
*   **XM Compatibility:** The `xm_save_lib` expects 16-bit PCM data. We must normalize and convert float32 audio carefully (`utils/xmExport.ts`), or the exported files will be static noise.
*   **Browser Autoplay Policy:** The `AudioContext` must be resumed (`context.resume()`) inside a user interaction handler (like the "Start" button) before any sound can play.

## 5. Dependency Graph & Key Flows

### Critical Flow: Playback
1.  **Clock:** `useScheduler` loop ticks.
2.  **Logic:** Calculates `currentStep`.
3.  **Ref Read:** Reads `patternRef.current` and `synthARef.current` (bypassing React render).
4.  **Dispatch:** Calls `audioEngine.playSynth(...)`.
5.  **Route:** `playSynth` -> Checks Engine (WebGPU/WASM/Pyodide) -> Generates/Fetches Buffer -> Connects to `MasterGain` -> `Destination`.

### Critical Flow: Save to Cloud
1.  **User:** Clicks "Upload".
2.  **App:** `getSongData()` serializes the state to a specific JSON structure.
3.  **POST:** Sends JSON to `app.py` (`/api/songs`).
4.  **Backend:**
    *   Acquires `INDEX_LOCK`.
    *   Writes file to SFTP via ThreadPool.
    *   *Verification:* Reads the file back immediately to ensure integrity.
    *   Updates `_songs.json` index.
    *   Releases Lock.
5.  **UI:** Receives 200 OK -> Updates List.

### Critical Flow: XM Export
1.  **User:** Clicks "Export XM".
2.  **Process:**
    *   Iterates all active instruments.
    *   **Render:** Calls `renderSynthToBuffer` (offline render).
    *   **Normalize:** `normalizeBuffer` ensures max volume without clipping.
    *   **Loop Finding:** `findSynthLoopPoints` analyzes the waveform to create seamless loops for the tracker.
    *   **Pack:** Assembles the binary XM structure.
3.  **Download:** Triggers browser download blob.
