import { useState, useCallback, useRef, useEffect } from 'react';
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, SamplerParams, PartSequence } from '../types';
import { noteToFrequency, NUM_STEPS } from '../constants';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import type { PyodideWorkerApi } from './usePyodideEngine';

export const useAudioEngine = (pyodideWorker: PyodideWorkerApi) => {
  const [isReady, setIsReady] = useState(false);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const rendererWorkerRef = useRef<Worker | null>(null);
  const gpuEngineRef = useRef<WebGpuOscillator | null>(null);
  const wasmEngineRef = useRef<WasmOscillator | null>(null);
  const isInitializingRef = useRef(false);

  // Native WAV buffers
  const wavSawBufferRef = useRef<AudioBuffer | null>(null);
  const wavSqrBufferRef = useRef<AudioBuffer | null>(null);

  // Master Volume & Pan
  const masterGainRef = useRef<GainNode | null>(null);
  const masterPannerRef = useRef<StereoPannerNode | null>(null);
  const ambianceGainNodeRef = useRef<GainNode | null>(null);
  const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  const pyodideRef = useRef(pyodideWorker);

  useEffect(() => {
    pyodideRef.current = pyodideWorker;
  }, [pyodideWorker]);

  const initializeAudio = useCallback(async () => {
    // Prevent concurrent or duplicate initializations
    if (audioEngineRef.current || isInitializingRef.current) return;
    isInitializingRef.current = true;

    try {
        const context = new (window.AudioContext || (window as any).webkitAudioContext)();
        // Expose context globally for scheduler
        // @ts-ignore
        window._audioContext = context;

        // --- MASTER CHAIN ---
        const masterGain = context.createGain();
        masterGain.gain.setValueAtTime(0.8, 0);
        masterGainRef.current = masterGain;

        let masterPanner: StereoPannerNode | null = null;
        if (context.createStereoPanner) {
            masterPanner = context.createStereoPanner();
            masterPanner.pan.setValueAtTime(0, 0);
            masterPannerRef.current = masterPanner;
            masterGain.connect(masterPanner);
            masterPanner.connect(context.destination);
        } else {
            masterGain.connect(context.destination);
        }

        // Initialize GPU Engine (Singleton check)
        if (!gpuEngineRef.current) {
            const gpuEngine = new WebGpuOscillator();
            await gpuEngine.init();
            gpuEngineRef.current = gpuEngine;
        }

        // Initialize Wasm Engine
        if (!wasmEngineRef.current) {
            const wasmEngine = new WasmOscillator();
            await wasmEngine.init();
            wasmEngineRef.current = wasmEngine;
        }

        // Load WAV Files
        const loadWav = async (url: string) => {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const arrayBuf = await res.arrayBuffer();
                return await context.decodeAudioData(arrayBuf);
            } catch (e) {
                console.error(`Failed to load ${url}`, e);
                return null;
            }
        };

        const [sawBuf, sqrBuf] = await Promise.all([
            loadWav('./assets/saw.wav'),
            loadWav('./assets/square.wav')
        ]);
        wavSawBufferRef.current = sawBuf;
        wavSqrBufferRef.current = sqrBuf;

        if (context.state === 'suspended') {
          await context.resume();
        }

        // --- WARM UP ---
        if (pyodideRef.current && pyodideRef.current.isReady) {
            try {
                await pyodideRef.current.generateWave({
                    freq: 440, duration: 0.1, oscType: 'sine', cutoff: 1000, resonance: 0, sampleRate: context.sampleRate
                });
            } catch(e) { console.log("Warmup failed (non-fatal)", e); }
        }

        audioEngineRef.current = {
            context,
            webGpuEngine: gpuEngineRef.current,
            wasmEngine: wasmEngineRef.current,
            playSynth,
            playDrum,
            playSampler,
            loadSampleToEngine,
            renderSynthPartToBuffer,
            playBufferedPart,
            playAmbiance,
            stopAmbiance,
            setAmbianceVolume,
            setMasterVolume,
            setGlobalPan
        };

        setIsReady(true);
    } catch (e) {
        console.error("Audio Initialization Failed:", e);
        // Allow retry if failed
        isInitializingRef.current = false;
    }
  }, [pyodideWorker]);

  // Functions defined inside useAudioEngine need access to refs
  // Define them here (same logic as before) ...

  const playSynth = async (params: SynthParams, note: string, time: number) => {
      if (!audioEngineRef.current) return;
      const context = audioEngineRef.current.context;
      const destination = masterGainRef.current!;

      const isPyodideWave = params.waveform.startsWith('pyodide-');
      const isWgslWave = params.waveform.startsWith('wgsl-');
      const isWasmWave = params.waveform.startsWith('wam-');
      const isWavWave = params.waveform.startsWith('wav-');

      const gateTime = params.length || 0.25;
      const totalDuration = gateTime + params.release;
      const safeTime = Math.max(time, context.currentTime);

      const gain = context.createGain();
      gain.gain.setValueAtTime(0, safeTime);
      gain.gain.linearRampToValueAtTime(params.volume, safeTime + params.attack);

      const sustainLevel = params.volume * params.sustain;
      gain.gain.linearRampToValueAtTime(sustainLevel, safeTime + params.attack + params.decay);
      gain.gain.setValueAtTime(sustainLevel, safeTime + gateTime);
      gain.gain.linearRampToValueAtTime(0, safeTime + gateTime + params.release);

      let outputNode: AudioNode = destination;

      if (params.delayMix > 0 && params.delayTime > 0) {
        const dryGain = context.createGain();
        const wetGain = context.createGain();
        const delay = context.createDelay(1.0);
        const feedback = context.createGain();

        dryGain.gain.setValueAtTime(1.0 - params.delayMix, safeTime);
        wetGain.gain.setValueAtTime(params.delayMix, safeTime);
        delay.delayTime.setValueAtTime(params.delayTime, safeTime);
        feedback.gain.setValueAtTime(params.delayFeedback, safeTime);

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

      if (isWavWave) {
          const buffer = params.waveform === 'wav-saw' ? wavSawBufferRef.current : wavSqrBufferRef.current;
          if (buffer) {
              const source = context.createBufferSource();
              source.buffer = buffer;
              source.loop = true;
              const baseFreq = noteToFrequency(note);
              const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
              const sampleRootFreq = params.waveform === 'wav-saw' ? 32.86 : 65.72;
              source.playbackRate.setValueAtTime(freqWithPitch / sampleRootFreq, safeTime);

              const filter = context.createBiquadFilter();
              filter.type = 'lowpass';
              filter.frequency.setValueAtTime(params.filterCutoff, safeTime);
              filter.Q.setValueAtTime(params.filterResonance, safeTime);

              source.connect(filter);
              filter.connect(outputNode);
              source.start(safeTime);
              source.stop(safeTime + totalDuration + 0.1);
          }
      } else if (isWgslWave && gpuEngineRef.current?.isSupported) {
           try {
            const baseFreq = noteToFrequency(note);
            const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
            const type = params.waveform.split('-')[1] as any;
            const rawData = await gpuEngineRef.current.generate(freqWithPitch, totalDuration + 0.1, context.sampleRate, type);
            if (rawData) {
                const buffer = context.createBuffer(1, rawData.length, context.sampleRate);
                buffer.getChannelData(0).set(rawData);
                const source = context.createBufferSource();
                source.buffer = buffer;
                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(params.filterCutoff, safeTime);
                filter.Q.setValueAtTime(params.filterResonance, safeTime);
                source.connect(filter);
                filter.connect(outputNode);
                source.start(safeTime);
            }
           } catch(e) { console.error(e); }
      } else if (isWasmWave && wasmEngineRef.current?.isReady) {
            const baseFreq = noteToFrequency(note);
            const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
            const type = params.waveform.split('-')[1] as any;
            const rawData = wasmEngineRef.current.generate(freqWithPitch, totalDuration + 0.1, context.sampleRate, type, params.filterCutoff, params.filterResonance);
            if (rawData) {
                const buffer = context.createBuffer(1, rawData.length, context.sampleRate);
                buffer.getChannelData(0).set(rawData);
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.connect(outputNode);
                source.start(safeTime);
            }
      } else if (isPyodideWave && pyodideRef.current) {
            try {
                const baseFreq = noteToFrequency(note);
                const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
                const pyOscType = params.waveform.split('-')[1];

                const bufferData = await pyodideRef.current.generateWave({
                    freq: freqWithPitch,
                    duration: totalDuration,
                    oscType: pyOscType,
                    cutoff: params.filterCutoff,
                    resonance: params.filterResonance,
                    sampleRate: context.sampleRate
                });

                if (bufferData.length > 0) {
                    const buffer = context.createBuffer(1, bufferData.length, context.sampleRate);
                    buffer.getChannelData(0).set(bufferData);

                    const source = context.createBufferSource();
                    source.buffer = buffer;
                    source.connect(outputNode);
                    source.start(safeTime);
                }
            } catch(e) { console.error("Pyodide error", e); }
      } else {
          const baseFreq = noteToFrequency(note);
          const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
          const osc = context.createOscillator();
          let waveType = params.waveform;
          if (waveType.includes('saw')) waveType = 'sawtooth';
          else if (waveType.includes('sqr')) waveType = 'square';
          else if (waveType.includes('tri')) waveType = 'triangle';
          else if (waveType.includes('sin')) waveType = 'sine';

          // @ts-ignore
          osc.type = waveType;
          osc.frequency.setValueAtTime(freqWithPitch, safeTime);
          const filter = context.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(params.filterCutoff, safeTime);
          filter.Q.setValueAtTime(params.filterResonance, safeTime);
          osc.connect(filter);
          filter.connect(outputNode);
          osc.start(safeTime);
          osc.stop(safeTime + totalDuration + 0.05);
      }
    };

    const playDrum = async (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => {
        if (!pyodideRef.current || !pyodideRef.current.isReady || !audioEngineRef.current) return;
        const context = audioEngineRef.current.context;
        
        try {
            const safeTime = Math.max(time, context.currentTime);

            // Map 'closedHat'/'openHat' to 'hat' for the worker
            let workerSoundType: 'kick' | 'snare' | 'hat' = 'kick';
            if (sound === 'snare') workerSoundType = 'snare';
            else if (sound === 'closedHat' || sound === 'openHat') workerSoundType = 'hat';
            else if (sound === 'kick') workerSoundType = 'kick';
            else return; // Should not happen

            const bufferData = await pyodideRef.current.generateDrum(workerSoundType, { ...params, sampleRate: context.sampleRate });
            
            if (bufferData.length > 0) {
                const buffer = context.createBuffer(1, bufferData.length, context.sampleRate);
                buffer.getChannelData(0).set(bufferData);

                const source = context.createBufferSource();
                source.buffer = buffer;

                const gain = context.createGain();
                gain.gain.setValueAtTime(1.0, safeTime);

                source.connect(gain);
                gain.connect(masterGainRef.current!);

                source.start(safeTime);
            }
        } catch (e) { console.error(`Drum error (${sound}):`, e); }
    };

    const loadSampleToEngine = (name: string, buffer: AudioBuffer) => {
        if (!pyodideRef.current) return;
        const channelData = buffer.getChannelData(0);
        pyodideRef.current.loadSample(name, channelData);
    };

    const playSampler = async (params: SamplerParams, note: string, time: number) => {
         if (!pyodideRef.current || !audioEngineRef.current) return;
         const context = audioEngineRef.current.context;
         try {
             const safeTime = Math.max(time, context.currentTime);
             const baseFreq = noteToFrequency('C4');
             const targetFreq = noteToFrequency(note);
             const ratio = targetFreq / baseFreq * params.playbackSpeed;

             const bufferData = await pyodideRef.current.generateSampler({
                 name: params.sampleName,
                 ratio,
                 volume: params.volume
             });

             if (bufferData.length > 0) {
                 const buffer = context.createBuffer(1, bufferData.length, context.sampleRate);
                 buffer.getChannelData(0).set(bufferData);
                 const source = context.createBufferSource();
                 source.buffer = buffer;
                 source.connect(masterGainRef.current!);
                 source.start(safeTime);
             }
         } catch(e) { console.error("Sampler error", e); }
    };

    const renderSynthPartToBuffer = (params: SynthParams, sequence: PartSequence, tempo: number): Promise<AudioBuffer> => {
        return new Promise((resolve, reject) => {
            if (!audioEngineRef.current) { reject("Engine not ready"); return; }
            const context = audioEngineRef.current.context;

            if (rendererWorkerRef.current) rendererWorkerRef.current.terminate();
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
            worker.postMessage({ params, sequence, tempo, sampleRate: context.sampleRate, numSteps: NUM_STEPS });
        });
    };

    const playBufferedPart = (buffer: AudioBuffer, time: number) => {
        if (!audioEngineRef.current) return;
        const context = audioEngineRef.current.context;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(masterGainRef.current!);
        source.start(time);
    };

    const playAmbiance = async (url: string) => {
        if (!audioEngineRef.current) return;
        const context = audioEngineRef.current.context;

        if (ambianceSourceNodeRef.current) ambianceSourceNodeRef.current.stop();
        if (!url) return;

        let buffer = loadedAmbianceBuffersRef.current.get(url);
        if (!buffer) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                buffer = await context.decodeAudioData(arrayBuffer);
                loadedAmbianceBuffersRef.current.set(url, buffer);
            } catch (e) { console.error("Failed to load ambiance track:", e); return; }
        }

        if (!ambianceGainNodeRef.current) {
            ambianceGainNodeRef.current = context.createGain();
            ambianceGainNodeRef.current.connect(masterGainRef.current!);
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
        if (ambianceGainNodeRef.current && audioEngineRef.current) {
            ambianceGainNodeRef.current.gain.setValueAtTime(volume, audioEngineRef.current.context.currentTime);
        }
    };

    const setMasterVolume = (volume: number) => {
        if (masterGainRef.current && audioEngineRef.current) {
            masterGainRef.current.gain.setValueAtTime(volume, audioEngineRef.current.context.currentTime);
        }
    };

    const setGlobalPan = (pan: number) => {
        if (masterPannerRef.current && audioEngineRef.current) {
            masterPannerRef.current.pan.setValueAtTime(pan, audioEngineRef.current.context.currentTime);
        }
    };

  return { audioEngine: audioEngineRef.current, isReady, initializeAudio };
};
