import { useState, useCallback, useRef, useEffect } from 'react';
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, SamplerParams, PartSequence } from '../types';
import { noteToFrequency, NUM_STEPS } from '../constants';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { useDistributedAudio, type RenderRequest, type AudioResponse } from './useDistributedAudio';

// Declare global types for the external libraries to avoid TS errors
declare const EssentiaWASM: any;
declare const Essentia: any;

export const useAudioEngine = (pyodide: any) => {
  const { role, setRole, sendRenderRequest, setRenderRequestHandler, setAudioReceivedHandler } = useDistributedAudio();
  const [isReady, setIsReady] = useState(false);
  const [remoteTracks, setRemoteTracks] = useState<Record<string, boolean>>({});
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);
  const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const ambianceGainNodeRef = useRef<GainNode | null>(null);
  const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const rendererWorkerRef = useRef<Worker | null>(null);
  const gpuEngineRef = useRef<WebGpuOscillator | null>(null);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const masterPannerNodeRef = useRef<StereoPannerNode | null>(null);
  const essentiaRef = useRef<any | null>(null);

  // Helper to timeout promises to prevent hanging
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
    ]);
  };

  // Helper function to dynamically load a script
  const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script ${src}`));
      document.head.appendChild(script);
    });
  };

  const pyodideRef = useRef(pyodide);
  const pendingRenderRequests = useRef<Map<string, { targetTime: number, params: SynthParams }>>(new Map());

  useEffect(() => {
    pyodideRef.current = pyodide;
  }, [pyodide]);

  useEffect(() => {
    if (!isReady || !audioEngineRef.current) return;
    const { context } = audioEngineRef.current;

    // Master: Set up handler to play received audio
    setAudioReceivedHandler((res: AudioResponse) => {
      if (!audioEngineRef.current) return;
      const { track, stepId, audioData } = res;
      const key = `${track}-${stepId}`;
      const requestData = pendingRenderRequests.current.get(key);

      if (requestData) {
        const { targetTime, params } = requestData;

        const buffer = context.createBuffer(1, audioData.length, context.sampleRate);
        buffer.getChannelData(0).set(audioData);

        const source = context.createBufferSource();
        source.buffer = buffer;

        // Re-apply ADSR envelope on the master context
        const gain = context.createGain();
        const gateTime = params.length || 0.25;
        const totalDuration = gateTime + params.release;

        gain.gain.setValueAtTime(0, targetTime);
        gain.gain.linearRampToValueAtTime(params.volume, targetTime + params.attack);
        const sustainLevel = params.volume * params.sustain;
        gain.gain.linearRampToValueAtTime(sustainLevel, targetTime + params.attack + params.decay);
        gain.gain.setValueAtTime(sustainLevel, targetTime + gateTime);
        gain.gain.linearRampToValueAtTime(0, targetTime + totalDuration);

        const finalNode = createDelayEffect(context, gain, params, targetTime);
        finalNode.connect(masterGainNodeRef.current || context.destination);

        source.connect(gain);
        source.start(targetTime);

        pendingRenderRequests.current.delete(key);
      }
    });
  }, [isReady, setRenderRequestHandler, setAudioReceivedHandler]);

  const createDelayEffect = (context: AudioContext, inputNode: AudioNode, params: SynthParams, time: number): AudioNode => {
    if (params.delayMix > 0 && params.delayTime > 0) {
      const dryGain = context.createGain();
      const wetGain = context.createGain();
      const delay = context.createDelay(1.0);
      const feedback = context.createGain();
      const output = context.createGain();

      dryGain.gain.setValueAtTime(1.0 - params.delayMix, time);
      wetGain.gain.setValueAtTime(params.delayMix, time);
      delay.delayTime.setValueAtTime(params.delayTime, time);
      feedback.gain.setValueAtTime(params.delayFeedback, time);

      inputNode.connect(dryGain);
      dryGain.connect(output);

      inputNode.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wetGain);
      wetGain.connect(output);

      return output;
    }
    return inputNode;
  };

  const initializeAudio = useCallback(async () => {
    if (audioEngineRef.current) return audioEngineRef.current;

    const context = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // 1. Initialize GPU Engine (Core Feature)
    // We try to init this, but don't block everything if it fails
    try {
        const gpuEngine = new WebGpuOscillator();
        await gpuEngine.init();
        gpuEngineRef.current = gpuEngine;
    } catch (e) {
        console.warn("GPU Engine failed to init", e);
    }

    if (context.state === 'suspended') {
      try { await context.resume(); } catch (e) { console.error(e); }
    }

    // 2. Create Master Chain (Critical)
    const masterGain = context.createGain();
    masterGainNodeRef.current = masterGain;

    const masterPanner = context.createStereoPanner();
    masterPannerNodeRef.current = masterPanner;

    masterGain.connect(masterPanner);
    masterPanner.connect(context.destination);

    // 3. Create Noise Buffer (Critical)
    const bufferSize = context.sampleRate * 2;
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noiseBufferRef.current = buffer;

    // 4. Load Essentia.js (Optional / Secondary Feature)
    // We run this in the background *after* core init so the UI becomes ready immediately.
    // We also use the correct instantiation pattern: await EssentiaWASM().
    (async () => {
        try {
            await withTimeout(loadScript('https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia-wasm.web.js'), 5000);
            await withTimeout(loadScript('https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia.js-core.js'), 5000);
            
            // Correct initialization: await the WASM backend first
            const wasmModule = await EssentiaWASM(); 
            essentiaRef.current = new Essentia(wasmModule);
            
            console.log('Essentia.js Initialized. Version:', essentiaRef.current.version);
        } catch (e) {
            console.warn("Failed to load Essentia.js (Autotune will be disabled):", e);
        }
    })();

    // Helper functions need to be defined here to close over context/refs
    const generateRawAudio = async (params: SynthParams, note: string, duration: number): Promise<Float32Array | null> => {
      if (!audioEngineRef.current) return null;
      const { context } = audioEngineRef.current;

      const isPyodideWave = params.waveform.startsWith('pyodide-');
      const isWgslWave = params.waveform.startsWith('wgsl-');

      const baseFreq = noteToFrequency(note);
      const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
      const totalDuration = duration + 0.1; // Add padding

      if (isWgslWave && gpuEngineRef.current?.isSupported) {
        try {
          const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';
          return await gpuEngineRef.current.generate(freqWithPitch, totalDuration, context.sampleRate, type);
        } catch (e) {
          console.error("WGSL Render Error:", e);
          return null;
        }
      } else if (isPyodideWave && pyodideRef.current) {
        try {
          pyodideRef.current.globals.get('set_sample_rate')(context.sampleRate);
          const pyOscType = params.waveform.split('-')[1];
          const pyProxy = pyodideRef.current.globals.get('generate_wave')(
            freqWithPitch,
            duration,
            pyOscType,
            params.filterCutoff,
            params.filterResonance
          );
          const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
          pyProxy.destroy();
          return audioSamples;
        } catch (e) {
          console.error("Pyodide synth error:", e);
          return null;
        }
      } else {
        // Fallback to OfflineAudioContext
        const offlineContext = new OfflineAudioContext(1, context.sampleRate * totalDuration, context.sampleRate);
        const osc = offlineContext.createOscillator();

        let waveType = params.waveform;
        if (waveType === 'wgsl-saw') waveType = 'sawtooth';
        if (waveType === 'wgsl-sqr') waveType = 'square';
        if (waveType === 'wgsl-tri') waveType = 'triangle';
        if (waveType === 'wgsl-sin') waveType = 'sine';
        
        // Safety check for Web Audio API standard types
        const standardTypes = ['sawtooth', 'sine', 'square', 'triangle'];
        if (!standardTypes.includes(waveType as string)) {
             waveType = 'sawtooth'; 
        }

        // @ts-ignore
        osc.type = waveType as OscillatorType;
        osc.frequency.value = freqWithPitch;

        const filter = offlineContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = params.filterCutoff;
        filter.Q.value = params.filterResonance;

        osc.connect(filter);
        filter.connect(offlineContext.destination);
        osc.start(0);

        const renderedBuffer = await offlineContext.startRendering();
        return renderedBuffer.getChannelData(0);
      }
    };

    const playSynth = async (params: SynthParams, note: string, time: number, destination: AudioNode | null = null, trackId?: string, stepId?: number) => {
      if (!audioEngineRef.current) return;
      const { context } = audioEngineRef.current;
      const outputDest = destination || masterGainNodeRef.current || context.destination;

      const gateTime = params.length || 0.25;
      const totalDuration = gateTime + params.release;

      if (role === 'master' && trackId && remoteTracks[trackId] && stepId !== undefined) {
        const key = `${trackId}-${stepId}`;
        pendingRenderRequests.current.set(key, { targetTime: time, params });
        sendRenderRequest({
          stepId,
          track: trackId,
          note,
          params,
          duration: totalDuration,
          targetTime: time,
        });
        return;
      }

      const rawAudio = await generateRawAudio(params, note, totalDuration);
      if (!rawAudio) return;

      const audioBuffer = context.createBuffer(1, rawAudio.length, context.sampleRate);
      audioBuffer.getChannelData(0).set(rawAudio);

      const source = context.createBufferSource();
      source.buffer = audioBuffer;

      const gain = context.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(params.volume, time + params.attack);
      const sustainLevel = params.volume * params.sustain;
      gain.gain.linearRampToValueAtTime(sustainLevel, time + params.attack + params.decay);
      gain.gain.setValueAtTime(sustainLevel, time + gateTime);
      gain.gain.linearRampToValueAtTime(0, time + totalDuration);

      const finalNode = createDelayEffect(context, gain, params, time);
      finalNode.connect(outputDest);

      source.connect(gain);
      source.start(time);
    };

    const playDrum = (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => {
        if (!pyodideRef.current) return;
        
        try {
            let pyProxy;
            let p = params as any; 
            let bufferLengthSeconds;
            let finalVolume;
            const pyodide = pyodideRef.current;

            switch(sound) {
                case 'kick':
                    pyProxy = pyodide.globals.get('generate_kick')(p.pitch, p.decay, p.tone, p.volume);
                    bufferLengthSeconds = p.decay;
                    finalVolume = p.volume;
                    break;
                case 'snare':
                    pyProxy = pyodide.globals.get('generate_snare')(p.decay, p.tone, p.noise, p.volume);
                    bufferLengthSeconds = p.decay * 1.5;
                    finalVolume = p.volume;
                    break;
                case 'closedHat':
                case 'openHat':
                    pyProxy = pyodide.globals.get('generate_hat')((p as HatParams).pitch, (p as HatParams).decay, (p as HatParams).volume);
                    bufferLengthSeconds = (p as HatParams).decay;
                    finalVolume = (p as HatParams).volume;
                    break;
                default:
                    return;
            }

            const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
            pyProxy.destroy();

            const buffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
            buffer.getChannelData(0).set(audioSamples);

            const gainNode = context.createGain();
            gainNode.gain.setValueAtTime(finalVolume, time);
            gainNode.connect(masterGainNodeRef.current || context.destination);

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
        const channelData = buffer.getChannelData(0);
        try {
           pyodideRef.current.globals.get('load_sample')(name, Array.from(channelData));
        } catch(e) {
            console.error("Error sending sample to Python:", e);
        }
    };

    const playSampler = (params: SamplerParams, note: string, time: number) => {
        if (!pyodideRef.current) return;
        try {
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
             source.connect(masterGainNodeRef.current || context.destination);
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
        source.connect(masterGainNodeRef.current || context.destination);
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
            ambianceGainNodeRef.current.connect(masterGainNodeRef.current || context.destination);
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

    const setMasterVolume = (volume: number) => {
        if (masterGainNodeRef.current) {
            masterGainNodeRef.current.gain.setValueAtTime(volume, context.currentTime);
        }
    };

    const setMasterPan = (pan: number) => {
        if (masterPannerNodeRef.current) {
            masterPannerNodeRef.current.pan.setValueAtTime(pan, context.currentTime);
        }
    }

    const analyzeAndTuneSample = async (buffer: AudioBuffer): Promise<number | null> => {
      if (!essentiaRef.current) {
        console.error("Essentia.js not ready for analysis");
        return null;
      }

      try {
        const audioData = buffer.getChannelData(0);
        // Essentia.js expects a Float32Array
        const essentiaVector = essentiaRef.current.arrayToVector(audioData);
        const pitch = essentiaRef.current.PitchYinProbabilistic(essentiaVector);

        // Find the most likely pitch
        let avgPitch = pitch.pitch;
        let maxConfidence = 0;
        for (let i = 0; i < pitch.pitch.length; i++) {
            if (pitch.pitchConfidence[i] > maxConfidence) {
                maxConfidence = pitch.pitchConfidence[i];
                avgPitch = pitch.pitch[i];
            }
        }

        if (avgPitch > 0) {
            const targetFreq = noteToFrequency('C4');
            const playbackSpeed = targetFreq / avgPitch;
            console.log(`Sample auto-tuned: Detected ${avgPitch.toFixed(2)}Hz, setting speed to ${playbackSpeed.toFixed(3)}`);
            return playbackSpeed;
        } else {
            console.warn("Pitch analysis returned 0 Hz, cannot auto-tune.");
            return null;
        }
      } catch (e) {
          console.error("Error during sample analysis:", e);
          return null;
      }
    };

    setRenderRequestHandler(async (req: RenderRequest) => {
      const { params, note, duration } = req;
      return await generateRawAudio(params, note, duration);
    });

    // 5. Construct & Return Engine (Engine is "ready" even if plugins failed)
    audioEngineRef.current = { 
        context, playSynth, playDrum, playSampler, loadSampleToEngine, analyzeAndTuneSample, 
        renderSynthPartToBuffer, playBufferedPart, playAmbiance, stopAmbiance, 
        setAmbianceVolume, setMasterVolume, setMasterPan 
    };
    
    setIsReady(true); // <--- UI enables play button now
    return audioEngineRef.current;
  }, []);

  const toggleRemoteTrack = useCallback((trackId: string) => {
    setRemoteTracks(prev => ({ ...prev, [trackId]: !prev[trackId] }));
  }, []);

  return {
    audioEngine: audioEngineRef.current,
    isReady,
    initializeAudio,
    role,
    setRole,
    remoteTracks,
    toggleRemoteTrack
  };
};
