# Architectural Implementation of High-Fidelity Singing Synthesis in Web Sequencers
*Technical Analysis: Supertonic TTS + Rubber Band WASM*

## 1. Introduction
This document outlines the architecture for integrating a singing voice synthesizer into the Hyphon DAW. The goal is to converge high-latency neural phoneme generation (Supertonic) with low-latency, phase-coherent time-stretching (Rubber Band Library) to create a "zero-latency" feeling vocal instrument.

## 2. Core Components

### 2.1 Neural Phoneme Generation (Supertonic)
* **Role:** Generates the raw "prototypical" utterance of lyrics.
* **Engine:** ONNX Runtime Web (WebGPU/WASM).
* **Output:** Flat speech audio (not pitched to score).
* **Constraints:** Non-autoregressive flow matching. Must run in a Worker or background thread to prevent UI locking.

### 2.2 DSP Pitch & Time (Rubber Band Library)
* **Role:** Forces the speech sample to conform to the MIDI score's pitch and duration.
* **Key Feature:** Formant preservation (avoids "chipmunk" effect).
* **Engine:** C++ Library compiled to WebAssembly (WASM).
* **Processing:** Phase Vocoder with adaptive time-domain transient handling.

## 3. Real-Time Architecture

### 3.1 The Buffer Mismatch Problem
* **Web Audio API:** Demands blocks of **128 frames**.
* **Rubber Band DSP:** Requires variable/large blocks (e.g., **1024+ frames**) for frequency resolution.
* **Constraint:** `AudioWorkletProcessor.process()` cannot block.

### 3.2 Solution: Lock-Free Ring Buffers
We will implement a Single-Producer Single-Consumer (SPSC) Ring Buffer using `SharedArrayBuffer` and `Atomics`.

1.  **Input Ring Buffer:** Transfers raw audio from the Decoder/Main Thread -> AudioWorklet.
2.  **Output Ring Buffer:** Transfers processed audio from AudioWorklet -> Playback.

**Data Flow:**
1.  `SupertonicService` generates raw WAV.
2.  Audio is decoded and pushed to `InputRingBuffer`.
3.  `AudioWorklet` pulls data into an internal accumulator.
4.  When `accumulator >= 1024` frames, pass to `rubberband-wasm`.
5.  Output pushed to `OutputRingBuffer`.
6.  `AudioWorklet` pops 128 frames for the browser output.

## 4. Algorithmic Strategy

### 4.1 Selective Stretching
To prevent "slurred" consonants when stretching words to fit long notes:
* **Consonants:** Fixed duration (stretch ratio ~1.0).
* **Vowels:** Elastic duration (absorbs the remaining time).
* **Implementation:** Use Rubber Band's "Time Map" feature to apply variable stretch ratios across the sample.

### 4.2 Expression (Vibrato & Portamento)
* **Vibrato:** Implemented via LFO (Sine Oscillator) modulating the pitch target in real-time, or a post-processing delay line.
* **Portamento:** Calculated pitch glides updated at control rate (e.g., 10ms) sent to Rubber Band's `setPitch`.

## 5. Implementation Stages
1.  **Build:** Compile `rubberband` to WASM using Emscripten.
2.  **Transport:** Implement `SharedArrayBuffer` Ring Buffer.
3.  **Worklet:** Create `RubberBandProcessor.ts`.
4.  **Integration:** Connect `SupertonicService` output to the Worklet.
