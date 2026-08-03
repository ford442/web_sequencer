1. Modify `src/engines/SingingVoiceManager.ts` to actually invoke `.noteOff()` for each active voice inside the `stopAll` function before clearing the active voices map. This matches the behavior of the other `VoiceManager`.
2. Ensure we use an iterator that doesn't instantiate closures or arrays, like a simple `for...of` loop over `this.activeVoices.values()`.
