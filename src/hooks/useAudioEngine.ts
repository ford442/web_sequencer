import { useState, useCallback, useRef, useEffect } from 'react'; // <-- 1. IMPORT useEffect
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, SamplerParams, PartSequence } from '../types';
import { noteToFrequency, NUM_STEPS } from '../constants';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';

export const useAudioEngine = (pyodide: any) => {
  const [isReady, setIsReady] = useState(false);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);
  const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const ambianceGainNodeRef = useRef<GainNode | null>(null);
  const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const rendererWorkerRef = useRef<Worker | null>(null);
  const gpuEngineRef = useRef<WebGpuOscillator | null>(null);
  const wasmEngineRef = useRef<WasmOscillator | null>(null);

  // 2. CREATE A REF to hold the pyodide prop
  const pyodideRef = useRef(pyodide);

  // 3. UPDATE THE REF whenever the prop changes
  useEffect(() => {
    pyodideRef.current = pyodide;
  }, [pyodide]);

  const initializeAudio = useCallback(async () => {
    if (audioEngineRef.current) return;

    const context = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Initialize GPU Engine
    const gpuEngine = new WebGpuOscillator();
    await gpuEngine.init();
    gpuEngineRef.current = gpuEngine;

    // Initialize Wasm Engine
    const wasmEngine = new WasmOscillator();
    await wasmEngine.init();
    wasmEngineRef.current = wasmEngine;

    if (context.state === 'suspended') {
      await context.resume();
    }

    // Create a white noise buffer
    const bufferSize = context.sampleRate * 2;
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noiseBufferRef.current = buffer;

const playSynth = async (params: SynthParams, note: string, time: number, destination: AudioNode = context.destination) => {
  const isPyodideWave = params.waveform.startsWith('pyodide-');
  const isWgslWave = params.waveform.startsWith('wgsl-');
  const isWasmWave = params.waveform.startsWith('wam-');

  // ADSR Logic
  const gateTime = params.length || 0.25; // Gate time
  const totalDuration = gateTime + params.release; // When to stop sound completely

  // --- Gain Envelope (used by both) ---
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, time);

  // Attack
  gain.gain.linearRampToValueAtTime(params.volume, time + params.attack);

  // Decay to Sustain
  const sustainLevel = params.volume * params.sustain;
  // If Attack + Decay is shorter than Gate, we decay to sustain.
  // If not, we might cut it short, but standard behavior is usually to just finish decay or interrupt.
  // We'll assume decay completes before gate normally, but if not:
  // We want to reach Sustain Level at (time + attack + decay).
  gain.gain.linearRampToValueAtTime(sustainLevel, time + params.attack + params.decay);

  // Sustain holds until 'gateTime' (time + length)
  gain.gain.setValueAtTime(sustainLevel, time + gateTime);

  // Release
  gain.gain.linearRampToValueAtTime(0, time + gateTime + params.release);


  // --- Delay (used by both) ---
  let outputNode: AudioNode = destination;
  if (params.delayMix > 0 && params.delayTime > 0) {
    // ... (delay logic is unchanged)
    const dryGain = context.createGain();
    const wetGain = context.createGain();
    const delay = context.createDelay(1.0);
    const feedback = context.createGain();

    dryGain.gain.setValueAtTime(1.0 - params.delayMix, time);
    wetGain.gain.setValueAtTime(params.delayMix, time);
    delay.delayTime.setValueAtTime(params.delayTime, time);
    feedback.gain.setValueAtTime(params.delayFeedback, time);

    gain.connect(dryGain);
    dryGain.connect(destination);

    gain.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wetGain);
    wetGain.connect(destination);
    
    outputNode = gain; 
  } else {
    gain.connect(destination);
    outputNode = gain;
  }

  // --- Waveform Generation ---

  if (isWgslWave && gpuEngineRef.current?.isSupported) {
    // --- WGSL GPU PATH ---
    try {
        const baseFreq = noteToFrequency(note);
        const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);

        // Extract type: 'wgsl-saw' -> 'saw'
        const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';

        // Generate Buffer
        const rawData = await gpuEngineRef.current.generate(
            freqWithPitch,
            totalDuration + 0.1,
            context.sampleRate,
            type
        );

        if (rawData) {
            const buffer = context.createBuffer(1, rawData.length, context.sampleRate);
            buffer.getChannelData(0).set(rawData);

            const source = context.createBufferSource();
            source.buffer = buffer;

            // Create Filter Node specifically for this voice
            const filter = context.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(params.filterCutoff, time);
            filter.Q.setValueAtTime(params.filterResonance, time);

            // Connect Chain
            source.connect(filter);
            filter.connect(outputNode); // outputNode is the Envelope Gain

            source.start(time);
        }
    } catch (e) {
        console.error("WGSL Render Error:", e);
    }

  } else if (isWasmWave && wasmEngineRef.current?.isReady) {
    // --- NEW: Wasm Audio Generation ---
    try {
        const baseFreq = noteToFrequency(note);
        const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
        const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';

        const rawData = wasmEngineRef.current.generate(
            freqWithPitch,
            totalDuration + 0.1, // Matches WGSL logic to ensure coverage
            context.sampleRate,
            type
        );

        if (rawData) {
            const buffer = context.createBuffer(1, rawData.length, context.sampleRate);
            buffer.getChannelData(0).set(rawData);

            const source = context.createBufferSource();
            source.buffer = buffer;

             // Create Filter Node specifically for this voice
            const filter = context.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(params.filterCutoff, time);
            filter.Q.setValueAtTime(params.filterResonance, time);

            source.connect(filter);
            filter.connect(outputNode);

            source.start(time);
        }
    } catch(e) {
        console.error("Wasm Render Error:", e);
    }

  // 5. USE THE REF (pyodideRef.current)
  } else if (isPyodideWave && pyodideRef.current) {
    // --- NEW: Pyodide Audio Generation ---
    try {
      // 1. Set sample rate in Python
      pyodideRef.current.globals.get('set_sample_rate')(context.sampleRate); // <-- Use ref

      // 2. Get parameters
      const baseFreq = noteToFrequency(note);
      const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
      const pyOscType = params.waveform.split('-')[1]; // 'saw', 'square', 'sine'
      
      // 3. Call Python!
      let pyProxy = pyodideRef.current.globals.get('generate_wave')( // <-- Use ref
          freqWithPitch,
          totalDuration, // Use total duration (Gate + Release)
          pyOscType,
          params.filterCutoff,
          params.filterResonance
      );

      // 4. Copy data from Python (64-bit) to JS (32-bit)
      const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
      pyProxy.destroy(); // Free memory

      // 5. Create Web Audio Buffer
      const buffer = context.createBuffer(
          1, 
          audioSamples.length, 
          context.sampleRate
      );
      buffer.getChannelData(0).set(audioSamples);

      // 6. Create a player (BufferSource) and schedule it
      const source = context.createBufferSource();
      source.buffer = buffer;
      
      // 7. Connect to the envelope and schedule playback
      source.connect(outputNode); // Connect to our 'gain' node
      source.start(time);
      source.stop(time + totalDuration + 0.05); // Stop buffer playback
      
    } catch (e) {
        console.error("Pyodide synth error:", e);
    }

  // 5. USE THE REF (pyodideRef.current)
  } else if (isPyodideWave && !pyodideRef.current) {
      console.warn("Pyodide not ready, skipping synth trigger.");
  } else {
    // --- ORIGINAL: Web Audio API Generation ---
    // ... (this part is unchanged)
    const baseFreq = noteToFrequency(note);
    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);

    const osc = context.createOscillator();

    // FALLBACK MAPPING: If we are here with a wgsl- waveform (e.g. GPU not supported), map to standard
    let waveType = params.waveform;
    if (waveType === 'wgsl-saw') waveType = 'sawtooth';
    if (waveType === 'wgsl-sqr') waveType = 'square';
    if (waveType === 'wgsl-tri') waveType = 'triangle';
    if (waveType === 'wgsl-sin') waveType = 'sine';

    // @ts-ignore
    osc.type = waveType as OscillatorType;
    osc.frequency.setValueAtTime(freqWithPitch, time);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(params.filterCutoff, time);
    filter.Q.setValueAtTime(params.filterResonance, time);

    osc.connect(filter);
    filter.connect(outputNode);

    osc.start(time);
    osc.stop(time + totalDuration + 0.05);
  }
};

    // 5. USE THE REF (pyodideRef.current)
    const playDrum = (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => {
        // Check the ref
        if (!pyodideRef.current) {
            console.warn("Pyodide not ready, skipping drum trigger.");
            return;
        }
        
        try {
            let pyProxy;
            let p = params as any; 
            let bufferLengthSeconds;
            let finalVolume;
            
            // Get the current pyodide instance from the ref
            const pyodide = pyodideRef.current;

            switch(sound) {
                case 'kick':
                    pyProxy = pyodide.globals.get('generate_kick')(
                        p.pitch,
                        p.decay,
                        p.tone,
                        p.volume
                    );
                    bufferLengthSeconds = p.decay;
                    finalVolume = p.volume;
                    break;
                case 'snare':
                    pyProxy = pyodide.globals.get('generate_snare')(
                        p.decay,
                        p.tone,     // tone_pitch
                        p.noise,    // noise_freq
                        p.volume
                    );
                    bufferLengthSeconds = p.decay * 1.5;
                    finalVolume = p.volume;
                    break;
                case 'closedHat':
                case 'openHat':
                    pyProxy = pyodide.globals.get('generate_hat')(
                        (p as HatParams).pitch,
                        (p as HatParams).decay,
                        (p as HatParams).volume
                    );
                    bufferLengthSeconds = (p as HatParams).decay;
                    finalVolume = (p as HatParams).volume;
                    break;
                default:
                    return;
            }

            // --- Common logic for all drum sounds ---

            // 1. Copy data from Python (64-bit) to JS (32-bit)
            const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
            pyProxy.destroy(); // Free memory

            // 2. Create Web Audio Buffer
            // ... (rest of this function is unchanged)
            const buffer = context.createBuffer(
                1, 
                audioSamples.length, 
                context.sampleRate
            );
            buffer.getChannelData(0).set(audioSamples);

            const gainNode = context.createGain();
            gainNode.gain.setValueAtTime(finalVolume, time);
            gainNode.connect(context.destination);

            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNode);
            source.start(time);
            source.stop(time + bufferLengthSeconds + 0.05);
            
        } catch (e) {
            console.error(`Pyodide drum error (${sound}):`, e);
        }
    };

    const loadSampleToEngine = (name: string, buffer: AudioBuffer) => {
        if (!pyodideRef.current) return;

        // Convert AudioBuffer to float array (mono)
        const channelData = buffer.getChannelData(0); // Use first channel

        // Pass to Python
        try {
           pyodideRef.current.globals.get('load_sample')(name, Array.from(channelData));
        } catch(e) {
            console.error("Error sending sample to Python:", e);
        }
    };

    const playSampler = (params: SamplerParams, note: string, time: number) => {
        if (!pyodideRef.current) return;

        try {
             // Calculate pitch ratio relative to C4 (Middle C)
             // If note is C4, ratio is 1.0.
             // If note is C5, ratio is 2.0 (faster).
             // If note is C3, ratio is 0.5 (slower).
             const baseFreq = noteToFrequency('C4');
             const targetFreq = noteToFrequency(note);
             const ratio = targetFreq / baseFreq * params.playbackSpeed;

             const pyProxy = pyodideRef.current.globals.get('generate_sampler')(
                 params.sampleName,
                 ratio,
                 params.volume
             );

             const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
             pyProxy.destroy();

             if (audioSamples.length === 0) return;

             const buffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
             buffer.getChannelData(0).set(audioSamples);

             const source = context.createBufferSource();
             source.buffer = buffer;
             source.connect(context.destination);
             source.start(time);
        } catch(e) {
            console.error("Pyodide sampler error:", e);
        }
    };

    const renderSynthPartToBuffer = (params: SynthParams, sequence: PartSequence, tempo: number): Promise<AudioBuffer> => {
        return new Promise((resolve, reject) => {
            if (rendererWorkerRef.current) {
                rendererWorkerRef.current.terminate();
            }

            const worker = new Worker(new URL('../workers/renderer.worker.ts', import.meta.url), { type: 'module' });
            rendererWorkerRef.current = worker;

            worker.onmessage = (event: MessageEvent<AudioBuffer>) => {
                resolve(event.data);
                worker.terminate();
                rendererWorkerRef.current = null;
            };

            worker.onerror = (error) => {
                console.error("Renderer worker error:", error);
                reject(error);
                worker.terminate();
                rendererWorkerRef.current = null;
            };

            worker.postMessage({
                params,
                sequence,
                tempo,
                sampleRate: context.sampleRate,
                numSteps: NUM_STEPS
            });
        });
    };

    const playBufferedPart = (buffer: AudioBuffer, time: number) => {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(time);
    };

    const playAmbiance = async (url: string) => {
        if (ambianceSourceNodeRef.current) {
            ambianceSourceNodeRef.current.stop();
        }
        if (!url) return;

        let buffer = loadedAmbianceBuffersRef.current.get(url);
        if (!buffer) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                buffer = await context.decodeAudioData(arrayBuffer);
                loadedAmbianceBuffersRef.current.set(url, buffer);
            } catch (e) {
                console.error("Failed to load ambiance track:", e);
                return;
            }
        }

        if (!ambianceGainNodeRef.current) {
            ambianceGainNodeRef.current = context.createGain();
            ambianceGainNodeRef.current.connect(context.destination);
        }

        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(ambianceGainNodeRef.current);
        source.start(0);
        ambianceSourceNodeRef.current = source;
    };

    const stopAmbiance = () => {
        if (ambianceSourceNodeRef.current) {
            ambianceSourceNodeRef.current.stop();
            ambianceSourceNodeRef.current = null;
        }
    };

    const setAmbianceVolume = (volume: number) => {
        if (ambianceGainNodeRef.current) {
            ambianceGainNodeRef.current.gain.setValueAtTime(volume, context.currentTime);
        }
    };

    audioEngineRef.current = { context, playSynth, playDrum, playSampler, loadSampleToEngine, renderSynthPartToBuffer, playBufferedPart, playAmbiance, stopAmbiance, setAmbianceVolume };
    setIsReady(true);
  }, []);

  return { audioEngine: audioEngineRef.current, isReady, initializeAudio };
};
