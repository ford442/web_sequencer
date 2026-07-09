1. **Identify Bottleneck**: Inside `useAudioEngine.ts` `playSamplerVoice`, creating complex native Web Audio graphs dynamically inside the `notes.forEach` loop per note/step trigger introduces massive garbage collection and main-thread stalling in dense sequences.
   - For example, `const filter = context.createBiquadFilter()` is created per step.
   - Spectral panning creates 3 filters, 3 panners, 3 oscillators, 4 gain nodes *per polyphonic note*.
   - Reverb routing creates `reverbGain`, `formantReverbEq` (a filter), an oscillator, and `reverbLfoDepthGain` per note.

2. **Wait!** The prompt memory says:
   `Creating Web Audio nodes (like BiquadFilterNode, StereoPannerNode, GainNode) dynamically on every step trigger (e.g., inside useAudioEngine) causes severe garbage collection thrashing and performance drops in dense sequences. Pre-allocate these natively allocated nodes into persistent wrapper classes (like VoiceFXStrip) attached to the voice lifecycle and update them via fast AudioParam.setValueAtTime() calls instead.`

3. **Solution**:
   - `VoiceFXStrip` is already available in the codebase (`src/engines/audio-fx/VoiceFXStrip.ts`).
   - We will replace the native node allocations inside the `playSamplerVoice`'s `notes.forEach` loop with `VoiceFXStrip` pooling or instance reuse.
   - We can create an array of pre-allocated `VoiceFXStrip` instances and pull from them per voice inside `useAudioEngine.ts`.
   - The pool can be managed in `useAudioEngine.ts` (e.g., `const fxStripPoolRef = useRef<VoiceFXStrip[]>([])`).
   - Initialize it with a few strips (e.g. 16 or 32) inside the `initializeAudio` function.
   - Inside `playSamplerVoice`, acquire a `VoiceFXStrip` from the pool, apply parameters using its methods (`updateFilter`, `updateSpectralPanning`, `updateReverbSend`, `updateDelaySend`), route audio through it, and release it on the `source.addEventListener('ended', ...)` callback.

   - Let's check `VoiceFXStrip.ts`. It has `updateFilter`, `updateSpectralPanning`, `updateReverbSend`, `connectReverb`, `updateDelaySend`, `connectDelay`. It exposes `input` and `output` (`GainNode`s).
   - This fits perfectly into replacing the inline creation.

4. **Detailed Implementation**:
   - In `useAudioEngine.ts`, add `const fxStripPoolRef = useRef<VoiceFXStrip[]>([]);`
   - In `initializeAudio`:
     ```typescript
     for (let i = 0; i < 32; i++) {
         fxStripPoolRef.current.push(new VoiceFXStrip(context));
     }
     ```
   - In `playSamplerVoice` (both stretch mode and legacy mode):
     - Acquire: `const fxStrip = fxStripPoolRef.current.pop() || new VoiceFXStrip(context);`
     - Route:
       - Stretch Mode: `voice.connectOutput(fxStrip.input)`
       - Legacy Mode: `source.connect(fxStrip.input)`
     - Connect FX Strip to destination: `fxStrip.output.connect(finalDest)`
     - Call `fxStrip.updateFilter(pFilterCutoff, pFilterResonance, triggerTime)`
     - Call `fxStrip.updateSpectralPanning(spectralPanDepth || 0, spectralPanLfoRate, triggerTime)`
     - Call `fxStrip.updateReverbSend(reverbSendAmount, revLfoRate, revLfoDepth, reverbEqCutoff, triggerTime)`
     - Call `fxStrip.connectReverb(targetReverbNode)`
     - Call `fxStrip.updateDelaySend(delaySendAmount, triggerTime)`
     - Call `fxStrip.connectDelay(delayNodeRef.current)`
     - On release: `fxStrip.output.disconnect(); fxStrip.connectReverb(null); fxStrip.connectDelay(null); fxStripPoolRef.current.push(fxStrip);`

Let's double-check the `playSamplerVoice` function in `useAudioEngine.ts` to see how the current routing works and replace it correctly.
