## 2026-06-14 - Inner Loop Redundant Calculation Hoisting
**Learning:** In highly polyphonic Web Audio / Canvas systems, calculations derived solely from per-step or global configurations (like determining EQ cutoffs, LFO rates, and Formant Shift targets) are redundantly executed multiple times inside `notes.forEach` inner loops if not carefully managed. Moving these simple math operations outside the inner loop to compute once per trigger step significantly reduces main thread pressure during dense chords or granular retriggering without breaking the engine architecture.
**Action:** Always audit `.forEach` inner loops inside high-frequency triggers (like `playSamplerVoice`) and hoist calculations that only depend on invariant outer scope step configuration parameters (like `noteParams` or `params`).
## 2024-05-18 - Polyphonic Param Resolution Hoisting
**Learning:** In the core `useAudioEngine.ts` Web Audio trigger flow, resolving fallback parameters (checking `noteParams?.xyz !== undefined ? noteParams.xyz : params.xyz`) and running tempo-sync math inside the polyphony chord loop (`notes.forEach`) causes massive redundant CPU math and object lookups during dense polyphonic chords and rapid granular re-triggers (glitch effects).
**Action:** Always pre-calculate and hoist complex configuration, fallback structures, and tempo-sync math for `AudioWorkletNode` settings out of inner trigger loops so that they are evaluated once per global trigger event, not per polyphonic voice or granular sub-slice.
## 2026-06-17 - Decoupling High-Frequency Drag Events from Global State
**Learning:** During the evaluation of the new automation CurveEditor, it was discovered that binding global store updates directly to continuous \`onMouseMove\` events triggers catastrophic UI reflows and full global state recalculations at 60fps per dragged pixel.
**Action:** Always decouple continuous high-frequency inputs (dragging, scrubbing) from the global store (e.g., \`automationStore\`). Employ a pattern of local React state (\`localPoints\`) for live visual feedback during the action, coupled with pointer capturing, and only flush the final result to the global store on \`onPointerUp\`.

## 2026-06-21 - Drum Param Resolution Hot-Path
**Learning:** In hot audio paths like `createPlayDrum`, even simple `for` loops that execute once and unnecessary object spread operators (`{ ...params, pitch: ... }`) create significant garbage collection (GC) overhead and CPU spikes when handling dense rhythmic patterns (e.g., 16th notes).
**Action:** When a parameter requires conditional modification based on external calculations (like pitch scaling), avoid unconditionally cloning the parameters. Always clone only when necessary and flatten unnecessary fixed-iteration loop wrappers.
## 2026-06-18 - Outer Loop Redundant Note Handling Hoisting
**Learning:** In audio synthesis functions like `createPlaySynth` and `createPlayDrum` in `audioPlayback.ts`, operations parsing the target `noteStr` and generating the `midi` or `pitchRatio` scale values were placed inside the `for (let i = 0; i < retrigger; i++)` loops, causing them to execute on every retrigger tick instead of just once per note trigger.
**Action:** Hoisted the note extraction logic and calculations to strictly run once before entering any loops to prevent unnecessary processing cycles during dense patterns with stutter/retrigger effects.

## 2026-06-25 - Redundant Worklet Param Resolution in Audio Playback
**Learning:** Discovered that polyphonic trigger loops inside `createPlaySynth` and `createPlayDrum` redundantly re-parse notes, calculate midi numbers, and compute pitch ratios on every iteration/sub-step instead of hoisting these invariant calculations.
**Action:** Hoisted the note extraction logic and calculations to strictly run once before entering any loops to prevent unnecessary processing cycles during dense patterns with stutter/retrigger effects.

## 2026-06-25 - Real-time Polyphonic Closure Hoisting
**Learning:** During polyphonic granular playback (`useAudioEngine.ts` inside `playSamplerVoice`), defining complex closures like `triggerVoice` and `runVoices` inside the `notes.forEach` loop forces the engine to re-allocate and capture these heavy functions for every note triggered. In glitch effects or wide chords, this creates intense garbage collection overhead per frame.
**Action:** Always identify and hoist closures out of high-frequency inner loops. Pass dynamic iteration variables (like `noteStr`) as explicit parameters instead of capturing them implicitly, fully decoupling the logic from the inner loop execution phase and avoiding per-note memory reallocation.

## 2026-06-30 - Hoisted Voice Trigger Closures + SamplerVoiceContext
**Learning:** During polyphonic granular playback, defining complex closures like `triggerVoice` and `runVoices` inside the `playSamplerVoice` function forces the engine to re-allocate and capture these heavy functions for every voice triggered. In glitch effects or wide chords, this creates intense garbage collection overhead per frame.
**Action:** Always identify and hoist closures out of high-frequency triggering inner loops and functions. Pass dynamic parameters using an explicit, typed context object (`SamplerVoiceContext`) instead of capturing them implicitly via closures, fully decoupling the logic from the inner loop execution phase and avoiding per-note memory reallocation.
## 2026-29-29 - Redundant Worklet Param Resolution in Audio Playback
**Learning:** Discovered that polyphonic trigger loops inside `createPlaySynth` and `createPlayDrum` redundantly re-parse notes, calculate midi numbers, and compute pitch ratios on every iteration/sub-step instead of hoisting these invariant calculations.
**Action:** Hoisted the note extraction logic and calculations to strictly run once before entering any loops to prevent unnecessary processing cycles during dense patterns with stutter/retrigger effects.
