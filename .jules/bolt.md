## 2026-07-06 - [Optimization] Hoist Invariant Audio Parameter Configuration Outside of Polyphonic Loops

**Learning:** When debugging the hot path for synthesizer and sampler playback, it's critical to realize that WASM engine parameter applications (`applyBass1Params`, `applyPartBParams`, and `setCutoff`) frequently trigger expensive FFI (Foreign Function Interface) calls across thread or memory boundaries. If these apply methods are inside inner polyphonic loops (`notes.forEach`) or note-retrigger loops (`for (let i = 0; i < retrigger; i++)`), they execute redundantly for every sub-step or voice layer, multiplying CPU cost with no audio benefit. Similarly, parsing notes strings to MIDI (`noteToMidi`) should only happen strictly when notes differ.

## 2026-06-25 - Redundant Worklet Param Resolution in Audio Playback
**Learning:** Discovered that polyphonic trigger loops inside `createPlaySynth` and `createPlayDrum` redundantly re-parse notes, calculate midi numbers, and compute pitch ratios on every iteration/sub-step instead of hoisting these invariant calculations.
**Action:** Hoisted the note extraction logic and calculations to strictly run once before entering any loops to prevent unnecessary processing cycles during dense patterns with stutter/retrigger effects.

## 2026-06-22 - Nested function closures and array checks hoisted
**Learning:** Found instances of array parsing `Array.isArray(note)` and massive 300+ line function declarations (`triggerVoice`) inside high frequency inner-loops like `for (let i = 0; i < retrigger; i++)` and `notes.forEach`. This allocates memory per note per cycle in a WebAudio hot path.
**Action:** Relocated block invariants like `const midi = noteToMidi(noteStr)` and scoped function signatures out of the tight loops to execute strictly once per global sequence step context rather than per voice iteration.
## 2026-06-26 - Audio Engine Inner Loop Function Hoisting
**Learning:** Defining large function closures (like `triggerVoice` and `runVoices`) inside inner loops (like `notes.forEach`) in real-time polyphonic audio triggers causes redundant function recreation and closure allocations per note.
**Action:** Always hoist complex inner functions outside of polyphonic trigger loops in the Web Audio hot path, passing loop-specific variables (like `noteStr`) as parameters instead to minimize GC pressure and CPU overhead.
**Action:** Before optimizing loops inside `createPlaySynth` or `playSamplerVoice`, trace the invariants. Hoist the initialization and cloning of parameter objects, the WASM parameter calls (`apply*Params`), and string parsing logic outside the loops. Keep dynamic math (like `noteTime`, envelopes) tightly scoped inside the loop. When refactoring complex legacy closures in `useAudioEngine.ts` and `audioPlayback.ts`, rely on safe text modifications since manual bracket-mangling or naive find/replaces often break React hooks structure.
