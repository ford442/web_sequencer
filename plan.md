1. **Add `sidechainGainRef` to Types**:
   - In `src/hooks/audioEngine/audioPlayback.ts`, update `PlaybackRefs` interface to include `sidechainGainRef: MutableRefObject<GainNode | null>;`.
2. **Add `sidechainGainRef` to `useAudioEngine` state**:
   - In `src/hooks/useAudioEngine.ts`, define `const sidechainGainRef = useRef<GainNode | null>(null);`. Add it to `playbackRefs` memoization block.
3. **Modify `initializeMasterOutput`**:
   - In `src/hooks/audioEngine/initialization.ts`, modify `initializeMasterOutput` to accept `sidechainGainRef`.
   - Update its signature:
     ```typescript
     export function initializeMasterOutput(
         context: AudioContext,
         masterGainRef: MutableRefObject<GainNode | null>,
         masterPannerRef: MutableRefObject<StereoPannerNode | null>,
         masterSaturationRef: MutableRefObject<WaveShaperNode | null>,
         masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>,
         sidechainGainRef: MutableRefObject<GainNode | null>
     ): WaveShaperNode
     ```
   - Inside `initializeMasterOutput`, create `sidechainBus`:
     ```typescript
     const sidechainBus = context.createGain();
     sidechainBus.gain.setValueAtTime(1.0, context.currentTime);
     sidechainGainRef.current = sidechainBus;

     masterSaturation.connect(sidechainBus);
     sidechainBus.connect(masterCompressor);
     masterCompressor.connect(masterGain);
     ```
   - *Self-correction*: Currently `masterSaturation` acts as the bus where everything (Synths, Samplers) goes. `masterSaturation.connect(masterCompressor)`. By inserting `sidechainBus` between them, we effectively duck all Synths and Samplers, while Drums (which connect directly to `masterGain`) bypass the ducking and compression. This matches perfectly with the EDM pump style (drums stay punchy, rest of mix ducks).
4. **Create `triggerSidechainDuck`**:
   - Add this to `src/hooks/audioEngine/audioPlayback.ts`:
     ```typescript
     export const triggerSidechainDuck = (
       audioCtx: AudioContext,
       sidechainGainNode: GainNode,
       time: number,
       depth: number = 0.15,
       releaseTime: number = 0.25
     ) => {
       const gain = sidechainGainNode.gain;
       gain.cancelScheduledValues(time);
       gain.setValueAtTime(gain.value, time);
       gain.linearRampToValueAtTime(depth, time + 0.01);
       gain.exponentialRampToValueAtTime(1.0, time + releaseTime);
     };
     ```
5. **Call `triggerSidechainDuck` when Kick plays**:
   - In `src/hooks/audioEngine/audioPlayback.ts`, update `createPlayDrum` to include `sidechainGainRef` in its `refs`.
   - Inside the `sound === 'kick'` condition:
     ```typescript
     if (refs.sidechainGainRef.current) {
         triggerSidechainDuck(context, refs.sidechainGainRef.current, now);
     }
     ```
6. **Update `useAudioEngine.ts` to call `initializeMasterOutput` with new arguments**.
   - `const masterBusInput = initializeMasterOutput(context, masterGainRef, masterPannerRef, masterSaturationRef, masterCompressorRef, sidechainGainRef);`
7. **Update `agent_plan.md`**: Mark "Sidechain Compression" as implemented.

Does this plan look correct?
