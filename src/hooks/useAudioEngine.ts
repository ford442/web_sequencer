import { useState, useCallback, useRef, useEffect } from 'react';
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, SamplerParams, PartSequence } from '../types';
import { noteToFrequency, NUM_STEPS } from '../constants';
import { acquireSharedWebGpuDevice } from './useWebGpuDevice';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { useDistributedAudio, type RenderRequest, type AudioResponse } from './useDistributedAudio';

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

  // WAM Refs
  const wamModuleRef = useRef<WebAssembly.Module | null>(null);
  const isWamReadyRef = useRef(false);

  // Helper to timeout promises
  const withTimeout = (promise: Promise<any>, ms: number) => {
      return Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
      ]);
  };

  // Helper function to dynamically load a script with timeout
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

    // Force resume immediately to handle browser autoplay policies
    if (context.state === 'suspended') {
        try {
            await context.resume();
        } catch (e) {
            console.error("Audio Context Resume failed:", e);
        }
    }

    // Parallel initialization of subsystems with timeouts
    // We limit this to 3 seconds so the UI doesn't hang if a CDN is down
    await Promise.allSettled([
      // 1. Initialize GPU Engine
      (async () => {
        if (!gpuEngineRef.current) {
          try {
            const sharedDevice = await withTimeout(acquireSharedWebGpuDevice(), 3000);
            const gpuEngine = new WebGpuOscillator();
            await gpuEngine.init(sharedDevice ?? undefined);
            gpuEngineRef.current = gpuEngine;
            if (!gpuEngine.isSupported) {
              console.warn("WebGPU oscillator not supported - falling back to offline generation.");
            }
          } catch (e) {
            console.warn("WebGPU Init failed or timed out:", e);
          }
        }
      })(),

      // 2. Initialize WAM (Fetch WASM and register worklet)
      (async () => {
        try {
          const response = await withTimeout(fetch('./wam_oscillator.wasm'), 3000);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            wamModuleRef.current = await WebAssembly.compile(buffer);
            await context.audioWorklet.addModule('./wam-processor.js');
            isWamReadyRef.current = true;
            console.log("WAM Oscillator loaded.");
          } else {
            console.warn("wam_oscillator.wasm not found (did you run emcc?).");
          }
        } catch (e) {
          console.warn("Failed to load WAM or timed out:", e);
        }
      })(),

      // 3. Load Essentia.js
      (async () => {
        try {
          // 5 second timeout for external scripts
          await withTimeout(loadScript('https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia-wasm.web.js'), 5000);
          await withTimeout(loadScript('https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia.js-core.js'), 5000);

          // @ts-ignore
          const wasmModule = await EssentiaWASM();
          // @ts-ignore
          essentiaRef.current = new Essentia(wasmModule);
          console.log('Essentia.js Initialized.');
        } catch (e) {
          console.warn("Failed to load Essentia.js or timed out:", e);
        }
      })()
    ]);

    // Create Master Chain
    const masterGain = context.createGain();
    masterGainNodeRef.current = masterGain;

    const masterPanner = context.createStereoPanner();
    masterPannerNodeRef.current = masterPanner;

    masterGain.connect(masterPanner);
    masterPanner.connect(context.destination);

    // Create a white noise buffer
    const bufferSize = context.sampleRate * 2;
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noiseBufferRef.current = buffer;

    // Helper to generate audio
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
          // Fallback to OfflineAudioContext for standard Web Audio API oscillators
          const offlineContext = new OfflineAudioContext(1, context.sampleRate * totalDuration, context.sampleRate);
          const osc = offlineContext.createOscillator();
  
          let waveType = params.waveform;
          if (waveType === 'wgsl-saw' || waveType === 'wam-saw') waveType = 'sawtooth';
          if (waveType === 'wgsl-sqr' || waveType === 'wam-sqr') waveType = 'square';
          if (waveType === 'wgsl-tri' || waveType === 'wam-tri') waveType = 'triangle';
          if (waveType === 'wgsl-sin' || waveType === 'wam-sin') waveType = 'sine';
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

    // Construct Audio Engine Object
    audioEngineRef.current = { 
        context, 
        playSynth: async (params, note, time, destination, trackId, stepId) => {
            const outputDest = destination || masterGainNodeRef.current || context.destination;
            const gateTime = params.length || 0.25;
            const totalDuration = gateTime + params.release;

            if (role === 'master' && trackId && remoteTracks[trackId] && stepId !== undefined) {
                const key = `${trackId}-${stepId}`;
                pendingRenderRequests.current.set(key, { targetTime: time, params });
                sendRenderRequest({ stepId, track: trackId, note, params, duration: totalDuration, targetTime: time });
                return;
            }

            // WAM Logic
            if (params.waveform.startsWith('wam-') && isWamReadyRef.current && wamModuleRef.current) {
                 try {
                    const typeStr = params.waveform.split('-')[1];
                    let typeInt = 0;
                    if (typeStr === 'sqr') typeInt = 1;
                    if (typeStr === 'tri') typeInt = 2;
                    if (typeStr === 'sin') typeInt = 3;
                    
                    const baseFreq = noteToFrequency(note);
                    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
                    
                    const wamNode = new AudioWorkletNode(context, 'wam-oscillator', {
                        processorOptions: { wasmModule: wamModuleRef.current, sampleRate: context.sampleRate }
                    });
                    
                    const freqParam = wamNode.parameters.get('frequency');
                    const typeParam = wamNode.parameters.get('type');
                    if (freqParam) freqParam.setValueAtTime(freqWithPitch, time);
                    if (typeParam) typeParam.setValueAtTime(typeInt, time);

                    const filter = context.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(params.filterCutoff, time);
                    filter.Q.setValueAtTime(params.filterResonance, time);
                    const gain = context.createGain();
                    gain.gain.setValueAtTime(0, time);
                    gain.gain.linearRampToValueAtTime(params.volume, time + params.attack);
                    const sustainLevel = params.volume * params.sustain;
                    gain.gain.linearRampToValueAtTime(sustainLevel, time + params.attack + params.decay);
                    gain.gain.setValueAtTime(sustainLevel, time + gateTime);
                    gain.gain.linearRampToValueAtTime(0, time + totalDuration);

                    wamNode.connect(filter);
                    filter.connect(gain);
                    const finalNode = createDelayEffect(context, gain, params, time);
                    finalNode.connect(outputDest);
                    
                    // Cleanup
                    setTimeout(() => { 
                        wamNode.disconnect(); 
                        filter.disconnect(); 
                        gain.disconnect(); 
                        if(finalNode !== gain) finalNode.disconnect();
                    }, (time - context.currentTime + totalDuration) * 1000 + 500);
                    return;
                 } catch(e) { console.error("WAM playback error", e); }
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
        }, 
        playDrum, 
        playSampler, 
        loadSampleToEngine, 
        analyzeAndTuneSample, 
        renderSynthPartToBuffer, 
        playBufferedPart, 
        playAmbiance, 
        stopAmbiance, 
        setAmbianceVolume, 
        setMasterVolume, 
        setMasterPan 
    };
    
    setIsReady(true);
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
