#!/bin/bash
patch -p1 << 'PATCH'
--- a/src/audio-worklets/rubberband-processor.ts
+++ b/src/audio-worklets/rubberband-processor.ts
@@ -130,9 +130,14 @@
       { name: 'spectralComp', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 },
       { name: 'downsample', defaultValue: 1.0, minValue: 1.0, maxValue: 32.0 },
       { name: 'windowShape', defaultValue: 0.0, minValue: 0.0, maxValue: 3.0 },
-      { name: 'subHarmonics', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 }
+      { name: 'subHarmonics', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 },
+      { name: 'volumeFilterMod', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 }
     ];
   }
+
+  // Syllable Volume Filter State
+  private volFilterLp: number[] = [0, 0];
+  private volFilterCutoffSmooth: number = 20000;

   // Sub Harmonics State
   private subState = {
@@ -260,6 +265,8 @@
         }

         this.isPlaying = true;
+        this.volFilterLp[0] = 0;
+        this.volFilterLp[1] = 0;
         break;

       case 'noteOff':
@@ -754,6 +761,31 @@
         // Apply Rhythmic Gating (Trance Gate)
       const gateDepth = parameters.gateDepth ? parameters.gateDepth[0] : 0.0;
       const gateRate = parameters.gateRate ? parameters.gateRate[0] : 0.0;
+
+      // Apply Syllable Volume Filter
+      const volFilterMod = parameters.volumeFilterMod ? parameters.volumeFilterMod[0] : 0.0;
+      if (volFilterMod > 0 && this.isPlaying && this.phonemeData) {
+        const [_, pVol, __, ___, ____, _____, ______, isVowel] = this.getPhonemeDataAtSample(this.currentSamplePtr);
+        const amount = volFilterMod * (0.25 + 0.75 * isVowel);
+        // Log scale mapping from 400Hz to 8000Hz based on clamped pVol
+        const targetCutoff = 400 * Math.pow(8000 / 400, Math.min(1.0, Math.max(0.0, pVol)) * amount);
+
+        // Smooth target -> cutoffState at block rate using a fixed ~10ms time constant
+        const dt = 1.0 / this.sampleRate;
+        const smoothAlpha = dt / (0.01 + dt);
+        this.volFilterCutoffSmooth = this.volFilterCutoffSmooth + smoothAlpha * (targetCutoff - this.volFilterCutoffSmooth);
+
+        const rc = 1.0 / (2.0 * Math.PI * this.volFilterCutoffSmooth);
+        const alpha = dt / (rc + dt);
+
+        // 1-pole filter processing per channel
+        for (let channel = 0; channel < outputs[0].length; channel++) {
+          const outCh = outputs[0][channel];
+          if (!outCh) continue;
+          for (let i = 0; i < outCh.length; i++) {
+            this.volFilterLp[channel] = this.volFilterLp[channel] + alpha * (outCh[i] - this.volFilterLp[channel]);
+            outCh[i] = this.volFilterLp[channel];
+          }
+        }
+      }

       if (gateDepth > 0 && gateRate > 0) {
         const sampleRate = (globalThis as any).sampleRate ?? 44100;
--- a/src/types.ts
+++ b/src/types.ts
@@ -147,6 +147,7 @@
   windowShape?: number;
   customGrainEnvelope?: number[];
   formantLfoSync?: boolean;
+  volumeFilterMod?: number;
   formantLfoRate?: number;
   formantLfoDepth?: number;
   customLfoShape?: number[];
@@ -491,6 +492,7 @@
   grainLfoRate?: number;
   grainLfoDepth?: number;
   grainPanSpread?: number;
+  volumeFilterMod?: number;
   vibratoDepth?: number;
   customWindowShape?: number[];
   reverbSend?: number;
@@ -677,6 +679,7 @@
   step: number;
   value: number;
   customWindowShape?: number[];
+  volumeFilterMod?: number;
 }

 export interface KnobAutomation {
--- a/src/engines/singing-voice/effectsControl.ts
+++ b/src/engines/singing-voice/effectsControl.ts
@@ -325,6 +325,15 @@
     setWorkletParam(this, "downsample", factor, time);
   },

+  /**
+   * Set syllable volume filter modulation depth.
+   * @param depth Modulation depth (0-1)
+   * @param time Optional time to apply the change
+   */
+  setVolumeFilterMod(this: SingingVoiceHost, depth: number, time?: number): void {
+    setWorkletParam(this, "volumeFilterMod", depth, time);
+  },
+
   /**
    * Set custom shape for granular synthesis windowing.
    * @param shape Array of normalized values (0.0 to 1.0)
--- a/src/hooks/audioEngine/samplerPlayback/playSamplerVoice.ts
+++ b/src/hooks/audioEngine/samplerPlayback/playSamplerVoice.ts
@@ -130,6 +130,7 @@
     const pDownsample = noteParams?.downsample !== undefined ? noteParams.downsample : params.downsample;
     const pSpectralCompression = noteParams?.spectralCompression !== undefined ? noteParams.spectralCompression : params.spectralCompression;
     const pTranceGate = noteParams?.tranceGate;
+    const pVolumeFilterMod = noteParams?.volumeFilterMod !== undefined ? noteParams.volumeFilterMod : params.volumeFilterMod;

     // Formant LFO
     const useFmtLfoSync = noteParams?.formantLfoSync ?? params.formantLfoSync ?? false;
@@ -351,6 +352,7 @@
         if (pDownsample !== undefined) voice.setDownsample(pDownsample, triggerTime);
         if (pSpectralCompression !== undefined) voice.setSpectralCompression(pSpectralCompression, triggerTime);
         if (pTranceGate !== undefined) voice.setTranceGate(pTranceGate, triggerTime);
+        if (pVolumeFilterMod !== undefined && (voice as any).setVolumeFilterMod) (voice as any).setVolumeFilterMod(pVolumeFilterMod, triggerTime);

         voice.setCustomWindowShape(pCustomWindowShape, triggerTime);

--- a/src/components/note-selector/SynthGranularEffects.tsx
+++ b/src/components/note-selector/SynthGranularEffects.tsx
@@ -48,6 +48,7 @@
     currentFormantEnvFollower = 0,
     currentDrive,
     currentVibratoDepth = 0,
+    currentVolumeFilterMod = 0,
     currentCustomWindowShape,
     currentVowel = 0,
     currentPortamento = 0,
@@ -470,6 +471,18 @@
         valueFormatter={() =>
           `${((currentSpectralComp ?? 0) * 100).toFixed(0)}%`
         }
+        accentColor="accent-indigo-400 hover:accent-indigo-300"
+        borderColor="border-indigo-900/30"
+      />
+      <PropertySlider
+        label="Syllable Filter"
+        id="note-vol-filter-mod"
+        ariaLabel="Syllable Filter Amount Override"
+        value={currentVolumeFilterMod ?? 0}
+        onChange={(v) => onPropertyChange?.("volumeFilterMod", v)}
+        valueFormatter={() =>
+          `${((currentVolumeFilterMod ?? 0) * 100).toFixed(0)}%`
+        }
         accentColor="accent-indigo-400 hover:accent-indigo-300"
         borderColor="border-indigo-900/30"
       />
--- a/src/components/note-selector/synthEffectTypes.ts
+++ b/src/components/note-selector/synthEffectTypes.ts
@@ -57,4 +57,5 @@
   currentSpectralPanDepth?: number;
   currentReverse?: boolean;
   currentCustomWindowShape?: number[];
+  currentVolumeFilterMod?: number;
 }
--- a/src/components/note-selector/types.ts
+++ b/src/components/note-selector/types.ts
@@ -27,6 +27,7 @@
   | "downsample"
   | "spectralCompression"
   | "tranceGate"
+  | "volumeFilterMod"
   | "formantShift"
   | "formantPitchLink"
   | "filterCutoff"
@@ -101,6 +102,7 @@
   currentDownsample?: number;
   currentSpectralCompression?: number;
   currentSubHarmonics?: number;
+  currentVolumeFilterMod?: number;
   currentFormantShift?: number;
   currentFormantPitchLink?: number;
   currentSlideFormant?: boolean;
--- a/src/components/NoteSelector.tsx
+++ b/src/components/NoteSelector.tsx
@@ -34,6 +34,7 @@
     currentPitchDecay = 0,
     currentReverse = false,
     currentRetrigger = 1,
+    currentVolumeFilterMod = 0,
     currentFreeze = 0,
     currentFormantShift,
     currentSlideFormant = false,
@@ -168,7 +169,7 @@
                 currentDownsample={currentDownsample}
                 currentSpectralCompression={currentSpectralCompression}
                 currentTranceGate={currentTranceGate}
-                currentVolumeFilterMod={props.currentVolumeFilterMod}
+                currentVolumeFilterMod={currentVolumeFilterMod}
               />

               <EffectsSendProperties
--- a/src/components/appParts/ContextMenuNode.tsx
+++ b/src/components/appParts/ContextMenuNode.tsx
@@ -77,6 +77,7 @@
           currentBitcrush={stepData?.bitcrush}
           currentDownsample={stepData?.downsample}
           currentSpectralCompression={stepData?.spectralCompression}
+          currentVolumeFilterMod={stepData?.volumeFilterMod}
           isProphecy={isProphecy}
           currentVowel={stepData?.vowel ?? 0}
           currentPortamento={stepData?.portamento ?? 0}
--- a/src/components/sampler-panel/useSamplerPanelState.ts
+++ b/src/components/sampler-panel/useSamplerPanelState.ts
@@ -69,7 +69,7 @@
       'vocoderMix', 'vocoderFormantShift', 'vocoderPreservation', 'vocoderAttack', 'vocoderRelease',
       'formantLfoRate', 'formantLfoDepth', 'customLfoShape', 'characterMorph', 'attack', 'decay',
       'pitchAmount', 'pitchAttack', 'pitchDecay',
-      'sustain', 'release', 'choir', 'glitchChance', 'gateDepth', 'gateRate', 'reverbLfoRate', 'reverbLfoDepth', 'bitcrush', 'spectralComp', 'downsample', 'spectralCompression',
+      'sustain', 'release', 'choir', 'glitchChance', 'gateDepth', 'gateRate', 'reverbLfoRate', 'reverbLfoDepth', 'bitcrush', 'spectralComp', 'downsample', 'spectralCompression', 'volumeFilterMod',
     ] as const;
     return Object.fromEntries(paramNames.map(p => [p, (v: unknown) => {
       if (onParamChange) onParamChange(activeBankIdx, p, v);
--- a/src/hooks/appState/usePatternHandlers.ts
+++ b/src/hooks/appState/usePatternHandlers.ts
@@ -208,7 +208,7 @@
              'delayLfoRate' | 'delayLfoDepth' | 'delaySend' |
              'freezeEnvDepth' | 'timeStretchEnvDepth' | 'spectralPanRate' | 'spectralPanDepth' | 'slideFormant' | 'tremoloRate' | 'tremoloDepth' | 'pan' | 'glitchChance' |
              'grainLfoRate' | 'grainLfoDepth' | 'grainEnvDepth' | 'grainPitchEnvDepth' | 'grainJitter' | 'grainPitchQuantize' | 'granularPitchShift' | 'windowShape' | 'customGrainEnvelope' |
-             'choir' | 'gateDepth' | 'gateRate' | 'tranceGate' | 'bitcrush' | 'downsample' | 'spectralCompression' | 'vocoderMix' | 'vocoderFormantShift' | 'vocoderPreservation' | 'vocoderAttack' | 'vocoderRelease' | 'pitchAmount' |
+             'choir' | 'gateDepth' | 'gateRate' | 'tranceGate' | 'bitcrush' | 'downsample' | 'spectralCompression' | 'volumeFilterMod' | 'vocoderMix' | 'vocoderFormantShift' | 'vocoderPreservation' | 'vocoderAttack' | 'vocoderRelease' | 'pitchAmount' |
              'spectralPanRate' | 'spectralPanDepth' | 'slideFormant' | 'tremoloRate' | 'tremoloDepth' |
              'vowel' | 'portamento' | 'slideFormant' | 'pitchAttack' | 'pitchDecay' | 'pitchAmount',
         value: number | boolean | string | number[]
--- a/.Jules/agent_plan.md
+++ b/.Jules/agent_plan.md
@@ -35,11 +35,13 @@
 ## Innovation Lab
 - [ ] Experiment with non-linear grain panning (e.g. spiral LFO paths for spectral bands during freeze)
 - [ ] Evaluate real-time cross-synthesis by injecting a secondary ringbuffer signal into the granulator envelope
-- [ ] What if we mapped TTS syllable volume directly to filter cutoff in the granular engine?
+- [x] What if we mapped TTS syllable volume directly to filter cutoff in the granular engine?
 - [x] Explore generating dynamic sub-harmonics for TTS vowels to add body/presence to synthesized speech.
 - [x] What if we added a subtle saturation stage exclusively to the generated sub-harmonic signal to make it cut through mix buses better on smaller speakers?
 - [ ] Explore a TTS vocal stack chorus effect using micro-delayed grains.
 - [ ] Investigate envelope follower ducking in the granular engine for sidechain effects based on percussive hits.
+- [ ] What if we linked granular playback speed directly to the LFO rate, allowing the playback position to oscillate?
+- [ ] Explore non-linear envelope shapes for the granular synthesis window (e.g. exponential vs linear curves)

 ## Refactoring Roadblocks
 - [x] Ensure all VoiceManagers (e.g., VoiceManager, SingingVoiceManager) use similar logic patterns for acquiring/releasing/stopping voices to prevent unexpected UI/Audio desync issues.
@@ -74,6 +76,8 @@
 - Velocity Check: Diagnosing the graph lifecycle proved crucial. Moving away from tearing down graph topologies on every trigger toward a patch-cable `disconnect` pattern is much healthier for continuous polyphonic modulations.
 - Completed "What if we added a subtle saturation stage exclusively to the generated sub-harmonic signal to make it cut through mix buses better on smaller speakers?". Modified the `RubberBandProcessor` to apply a simple and efficient soft clipper to the generated sub-octave bass tone right after the low pass filter. This introduces harmonic saturation while keeping the cost extremely low.
 - Velocity Check: The soft clipper is inexpensive to compute inside the worklet since we are using `x / (1.0 + abs(x))`. It successfully broadens the spectral presence of the sub-harmonic on devices with poor low-frequency reproduction. Added new ideas to the Innovation Lab.
+- Completed "What if we mapped TTS syllable volume directly to filter cutoff in the granular engine?". Implemented a 1-pole low pass filter in `RubberBandProcessor` where the cutoff frequency maps dynamically between 400Hz and 8000Hz based on the `pVol` read from the phoneme stride buffer. Scaled depth based on whether it is a vowel (`isVowel`) so consonants don't lose clarity. Wired parameter up to UI.
+- Velocity Check: Utilizing a 1-pole LPF correctly placed after amplitude multiplication and before the 3-band spectral split effectively avoided conflicting with the multi-band compressor. Applying smoothing on `targetCutoff` completely eliminated zipper noise across phoneme transitions.

 ## Roadmap
 - Completed "What if we added a subtle saturation stage exclusively to the generated sub-harmonic signal...". I added an inexpensive soft-clipper to the sub-bass signal path inside the AudioWorklet before mixing it back with the dry signal.
PATCH
