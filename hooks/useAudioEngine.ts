
import { useState, useCallback, useRef } from 'react';
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, PartSequence } from '../types';
import { noteToFrequency, NUM_STEPS } from '../constants';

export const useAudioEngine = () => {
  const [isReady, setIsReady] = useState(false);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);
  const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const ambianceGainNodeRef = useRef<GainNode | null>(null);
  const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const rendererWorkerRef = useRef<Worker | null>(null);

  const initializeAudio = useCallback(async () => {
    if (audioEngineRef.current) return;

    const context = new (window.AudioContext || (window as any).webkitAudioContext)();
    
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

    const playSynth = (params: SynthParams, note: string, time: number, destination: AudioNode = context.destination) => {
      const baseFreq = noteToFrequency(note);
      const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
      const noteDuration = params.attack + params.decay;

      const osc = context.createOscillator();
      osc.type = params.waveform;
      osc.frequency.setValueAtTime(freqWithPitch, time);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(params.filterCutoff, time);
      filter.Q.setValueAtTime(params.filterResonance, time);

      const gain = context.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(params.volume, time + params.attack);
      gain.gain.linearRampToValueAtTime(0, time + noteDuration);

      osc.connect(filter);
      filter.connect(gain);

      if (params.delayMix > 0 && params.delayTime > 0) {
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
      } else {
        gain.connect(destination);
      }

      osc.start(time);
      osc.stop(time + noteDuration + 0.05);
    };

    const playKick = (params: KickParams, time: number) => {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.connect(gain);
        gain.connect(context.destination);
        const endPitch = params.pitch * (1 - params.tone);
        osc.frequency.setValueAtTime(params.pitch, time);
        osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, endPitch), time + 0.1);
        gain.gain.setValueAtTime(params.volume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + params.decay);
        osc.start(time);
        osc.stop(time + params.decay);
    };

    const playSnare = (params: SnareParams, time: number) => {
        if (!noiseBufferRef.current) return;
        const noiseSource = context.createBufferSource();
        noiseSource.buffer = noiseBufferRef.current;
        const noiseFilter = context.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = params.noise;
        const noiseGain = context.createGain();
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(context.destination);
        const osc = context.createOscillator();
        osc.type = 'triangle';
        const oscGain = context.createGain();
        osc.connect(oscGain);
        oscGain.connect(context.destination);
        osc.frequency.setValueAtTime(params.tone, time);
        const targetOscGain = 0.01 * params.volume;
        oscGain.gain.setValueAtTime(0.7 * params.volume, time);
        oscGain.gain.exponentialRampToValueAtTime(Math.max(0.001, targetOscGain), time + params.decay * 0.8);
        oscGain.gain.linearRampToValueAtTime(0, time + params.decay);
        noiseGain.gain.setValueAtTime(params.volume, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + params.decay);
        osc.start(time);
        noiseSource.start(time);
        osc.stop(time + params.decay);
        noiseSource.stop(time + params.decay);
    };

    const playHat = (params: HatParams, time: number) => {
        if (!noiseBufferRef.current) return;
        const noiseSource = context.createBufferSource();
        noiseSource.buffer = noiseBufferRef.current;
        const filter = context.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = params.pitch;
        const gain = context.createGain();
        noiseSource.connect(filter);
        filter.connect(gain);
        gain.connect(context.destination);
        gain.gain.setValueAtTime(params.volume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + params.decay);
        noiseSource.start(time);
        noiseSource.stop(time + params.decay);
    };

    const playDrum = (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => {
        switch(sound) {
            case 'kick': playKick(params as KickParams, time); break;
            case 'snare': playSnare(params as SnareParams, time); break;
            case 'closedHat': case 'openHat': playHat(params as HatParams, time); break;
        }
    };

    const renderSynthPartToBuffer = (params: SynthParams, sequence: PartSequence, tempo: number): Promise<AudioBuffer> => {
        return new Promise((resolve, reject) => {
            if (rendererWorkerRef.current) {
                rendererWorkerRef.current.terminate();
            }

            // FIX: Use a direct path to the worker script instead of `new URL(...)`
            // which fails in the sandboxed environment.
            const worker = new Worker('/workers/renderer.worker.ts', { type: 'module' });
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

    audioEngineRef.current = { context, playSynth, playDrum, renderSynthPartToBuffer, playBufferedPart, playAmbiance, stopAmbiance, setAmbianceVolume };
    setIsReady(true);
  }, []);

  return { audioEngine: audioEngineRef.current, isReady, initializeAudio };
};
