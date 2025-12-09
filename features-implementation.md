Hybrid Audio Engine & XM Export Overhaul
1. Objective
Build a professional-grade browser audio engine that blurs the line between Sampler and Synthesizer. The engine must support real-time performance (AudioWorklet), advanced sustain modes (Granular/Looping), and high-fidelity export to FastTracker 2 (.XM) format.

2. Architecture Overview
The "Unified Voice" Concept
Instead of separate engines for Synth and Sampler, we create a single HybridVoice processor.

Input: Audio Buffer (Sample Data) + Parameters.

Mode Switch: Determines how the playback head moves through the buffer.

3. Phase 1: The Audio Engine (AudioWorklet)
Goal: Create a glitch-free, high-performance playback engine in sustain-processor.js.

3.1 Core Playback Logic
Implementation: AudioWorkletProcessor

Features:

Interpolation: Implement Linear (MVP) or Cubic Hermite (Pro) interpolation to prevent aliasing when pitching samples down.

Stereo Support: Ensure logic handles Mono -> Stereo and Stereo -> Stereo mapping.

3.2 The Three Playback Modes
Standard Loop (Sampler Mode)

Behavior: Play linearly. When playhead >= loopEnd, set playhead = loopStart.

Use Case: Drum loops, traditional instrument patches.

Granular Time-Stretch (Texture Mode)

Behavior: Play linearly. When playhead >= loopStart + grainSize:

Calculated jitter = Random(0, grainSize).

Jump to loopStart + jitter.

Use Case: Infinite pads, sustained vocals, atmospheric noise.

Wavetable (Synth Mode)

Behavior: Treat the buffer as a single-cycle waveform.

Math: increment = (frequency * bufferLength) / sampleRate.

Use Case: Turning any sample into a synth oscillator.

3.3 The Arpeggiator (Internal)
Logic: Count samples to determine 16th note steps.

Action: Trigger internal noteOn events (reset playhead, change pitch) completely inside the Worklet to ensure perfect timing.

4. Phase 2: The "Render & Freeze" Pipeline
Goal: Convert complex WebAudio graphs into static AudioBuffer objects for export or low-CPU playback.

4.1 The Offline Render Context
Task: Create a helper function render_to_buffer(audio_node_graph, duration).

Auto-Sustain Logic (For Synths):

Render 2.0 seconds of audio.

Analyze the middle 50% of the buffer.

Find the best Zero-Crossing points to create a seamless loop.

Save these loop_start and loop_end indices with the buffer.

4.2 Normalization
Task: Analyze peak volume of rendered buffers.

Action: If peak < -6dB, normalize to -1dB to ensure exported samples aren't too quiet in the tracker.

5. Phase 3: The XM Export (Python/Pyodide)
Goal: Generate .xm files that sound identical to the browser playback.

5.1 The HighQualityXMWriter Class
16-bit Support: Map Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767).

Delta Compression: Implement correct 16-bit delta math.

Header Flags:

Set Loop Type = 1 (Forward Loop) for sustained instruments.

Convert sample-based loop points to byte-offset loop points (x2 for 16-bit).

5.2 Arpeggiator to Pattern
Logic: If the Arpeggiator was active, do not export a single long note.

Action: Iterate through the Arp pattern in Python and write actual Note events into the XM Pattern slots.

6. Phase 4: Integration Steps
Step-by-Step Implementation Guide
Update sustain-processor.js

Add the mode parameter (0=Loop, 1=Stretch, 2=Wavetable).

Implement the switch logic in the process loop.

Update Python Controller

Add render_track_to_xm() function.

Implement the normalization and auto-loop detection.

UI Updates

Add a Toggle Switch: [Loop | Stretch | Wavetable].

Add a Button: Export Track to .XM.

7. Technical Requirements Checklist
[ ] Latency: AudioWorklet must not allocate memory (no new Array) inside the process() method.

[ ] Quality: Exported XM samples must be 16-bit.

[ ] Compatibility: Loop points must align to even bytes for 16-bit samples to avoid tracker crashing.

[ ] Fidelity: Normalized gain must apply before 16-bit integer conversion.
Phase 5: User Interface Polish (New)
[ ] Knob & Scroll Interaction: Implement mousedown -> mousemove (delta) logic for Knobs, Pattern Selectors, and Tempo. Remove "double-tap" behavior.

[ ] Musical Keyboard: Fix mouseup / mouseleave events to properly trigger NoteOff (solving the stuck note sustain issue).

[ ] Visual Feedback:

Color code keyboard keys (C = Red, D = Orange, etc.).

Color code pattern numbers (Active = Green, Empty = Grey).

Phase 6: Advanced Audio Features (New)
[ ] Polyphonic Lead: Upgrade HybridVoice to manage an array of voices (e.g., voices = [Voice(), Voice(), Voice()]). Allocator logic needed (Steal oldest note).

[ ] Bank Expansion: Update data structure to support 4 Banks x 8 Patterns (32 total patterns).

Phase 7: Optimization & System (New)
[ ] WebGPU Memory Manager: Refactor shader code to reuse GPUBuffers instead of recreating them.

[ ] Save/Load System: Implement Python-based Zip export for full song state.
