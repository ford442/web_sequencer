import type { SynthParams, KickParams, SnareParams, HatParams } from '../types';
import { noteToFrequency } from '../constants';
import type { PyodideWorkerApi } from '../hooks/usePyodideEngine';

/**
 * Renders a synth sound to an AudioBuffer.
 * Useful for exporting to XM samples.
 */
export async function renderSynthToBuffer(
    params: SynthParams,
    note: string = 'C4',
    duration: number = 2.0,
    engines?: {
        webGpuEngine?: any,
        wasmEngine?: any,
        pyodide?: PyodideWorkerApi
    }
): Promise<AudioBuffer> {
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate);

    const time = 0;
    const baseFreq = noteToFrequency(note);
    // Apply pitch shift from params
    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);

    let sourceNode: AudioScheduledSourceNode | null = null;
    let customBuffer: AudioBuffer | null = null;
    let skipFilter = false;

    // Check for Custom Engines first
    if (params.waveform.startsWith('wgsl-') && engines?.webGpuEngine?.isSupported) {
        // WebGPU
        try {
            const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';
            const rawData = await engines.webGpuEngine.generate(
                freqWithPitch,
                duration,
                sampleRate,
                type
            );
            if (rawData) {
                customBuffer = offlineCtx.createBuffer(1, rawData.length, sampleRate);
                customBuffer.getChannelData(0).set(rawData);
            }
        } catch(e) { console.error("WebGPU Export Error", e); }
    }
    else if (params.waveform.startsWith('wam-') && engines?.wasmEngine?.isReady) {
        // WASM
        try {
            const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';
            const rawData = engines.wasmEngine.generate(
                freqWithPitch,
                duration,
                sampleRate,
                type,
                params.filterCutoff,
                params.filterResonance
            );
            if (rawData) {
                customBuffer = offlineCtx.createBuffer(1, rawData.length, sampleRate);
                customBuffer.getChannelData(0).set(rawData);
                skipFilter = true; // WASM engine applies filter
            }
        } catch(e) { console.error("WASM Export Error", e); }
    }
    else if (params.waveform.startsWith('pyodide-') && engines?.pyodide) {
        // Pyodide (Async Worker)
        try {
            const pyOscType = params.waveform.split('-')[1];
            // Use worker api
            const audioSamples = await engines.pyodide.generateWave({
                freq: freqWithPitch,
                duration,
                oscType: pyOscType,
                cutoff: params.filterCutoff,
                resonance: params.filterResonance,
                sampleRate
            });

            if (audioSamples) {
                customBuffer = offlineCtx.createBuffer(1, audioSamples.length, sampleRate);
                customBuffer.getChannelData(0).set(audioSamples);
                skipFilter = true; // Pyodide engine applies filter
            }
        } catch(e) { console.error("Pyodide Export Error", e); }
    }

    if (customBuffer) {
        const bufferSource = offlineCtx.createBufferSource();
        bufferSource.buffer = customBuffer;
        sourceNode = bufferSource;
    }
    // Handle Sample-Based Waveforms
    else if (params.waveform === 'wav-saw' || params.waveform === 'wav-sqr') {
        const bufferSource = offlineCtx.createBufferSource();
        const url = params.waveform === 'wav-saw' ? './assets/saw.wav' : './assets/square.wav';
        const rootFreq = params.waveform === 'wav-saw' ? 32.86 : 65.72;

        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

            bufferSource.buffer = audioBuffer;
            bufferSource.loop = true;

            // Calculate playback rate
            const playbackRate = freqWithPitch / rootFreq;
            bufferSource.playbackRate.setValueAtTime(playbackRate, time);

            sourceNode = bufferSource;
        } catch (e) {
            console.error(`Failed to load wav buffer for ${params.waveform}`, e);
            // Fallback
            const osc = offlineCtx.createOscillator();
            osc.type = params.waveform === 'wav-saw' ? 'sawtooth' : 'square';
            osc.frequency.setValueAtTime(freqWithPitch, time);
            sourceNode = osc;
        }
    } else {
        // Standard Waveforms Fallback
        const osc = offlineCtx.createOscillator();
        let type: OscillatorType = 'sawtooth';
        if (params.waveform.includes('sqr')) type = 'square';
        else if (params.waveform.includes('tri')) type = 'triangle';
        else if (params.waveform.includes('sin')) type = 'sine';
        osc.type = type;
        osc.frequency.setValueAtTime(freqWithPitch, time);
        sourceNode = osc;
    }

    // Connect Graph
    // Source -> (Filter?) -> VCA -> Dest

    // Filter
    let nextNode: AudioNode = sourceNode;

    if (!skipFilter) {
        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(params.filterCutoff, time);
        filter.Q.setValueAtTime(params.filterResonance, time);
        sourceNode.connect(filter);
        nextNode = filter;
    }

    // VCA (Envelope)
    const gain = offlineCtx.createGain();
    const attack = params.attack;
    const decay = params.decay;
    const sustain = params.sustain;
    const release = params.release;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(1.0, time + attack); // Normalize to 1.0 for sample
    gain.gain.linearRampToValueAtTime(sustain, time + attack + decay);
    // Hold sustain
    gain.gain.setValueAtTime(sustain, duration - release);
    gain.gain.linearRampToValueAtTime(0, duration);

    nextNode.connect(gain);
    gain.connect(offlineCtx.destination);

    sourceNode.start(time);
    // For buffer sources we don't strictly need stop if buffer matches duration, but safe practice
    if (sourceNode instanceof OscillatorNode) {
        sourceNode.stop(time + duration);
    } else if (customBuffer) {
        // Stop is implied by buffer length usually, but just in case
    }

    return await offlineCtx.startRendering();
}

/**
 * Renders a drum sound to an AudioBuffer.
 */
export async function renderDrumToBuffer(
    sound: 'kick' | 'snare' | 'closedHat' | 'openHat',
    params: any,
    pyodide?: PyodideWorkerApi
): Promise<AudioBuffer> {
    const sampleRate = 44100;
    // Estimate duration based on params or defaults
    let duration = sound === 'snare' ? 0.5 : (sound === 'kick' ? 0.5 : 0.3);

    // If we have decay param, use it to ensure buffer is long enough
    if (params.decay) {
        duration = Math.max(duration, params.decay * (sound === 'snare' ? 1.5 : 1.2));
    }

    // Try Pyodide Generation first
    if (pyodide) {
        try {
            let bufferData;
            if (sound === 'kick') {
                const p = params as KickParams;
                bufferData = await pyodide.generateDrum('kick', { ...p, sampleRate });
            } else if (sound === 'snare') {
                const p = params as SnareParams;
                bufferData = await pyodide.generateDrum('snare', { ...p, sampleRate });
            } else {
                // Hats
                const p = params as HatParams;
                bufferData = await pyodide.generateDrum('hat', { ...p, sampleRate });
            }

            if (bufferData && bufferData.length > 0) {
                 const ctx = new OfflineAudioContext(1, bufferData.length, sampleRate);
                 const buffer = ctx.createBuffer(1, bufferData.length, sampleRate);
                 buffer.getChannelData(0).set(bufferData);
                 return buffer;
            }
        } catch (e) {
            console.error(`Pyodide drum export error (${sound}):`, e);
            // Fallthrough to approximation
        }
    }

    // Fallback Approximation (Existing Code)
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate);
    const time = 0;

    const gain = offlineCtx.createGain();
    gain.connect(offlineCtx.destination);

    if (sound === 'kick') {
        const p = params as KickParams;
        const osc = offlineCtx.createOscillator();
        // Use params.pitch if available (KickParams has pitch)
        osc.frequency.setValueAtTime(p.pitch, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + p.decay);

        const env = offlineCtx.createGain();
        env.gain.setValueAtTime(p.volume, time);
        env.gain.exponentialRampToValueAtTime(0.01, time + p.decay);

        osc.connect(env);
        env.connect(gain);
        osc.start(time);
        osc.stop(time + p.decay);
    }
    else if (sound === 'snare') {
        const p = params as SnareParams;
        // Noise
        const bufferSize = sampleRate * duration;
        const buffer = offlineCtx.createBuffer(1, bufferSize, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noiseSrc = offlineCtx.createBufferSource();
        noiseSrc.buffer = buffer;

        const noiseEnv = offlineCtx.createGain();
        // Mix noise based on p.noise
        const noiseMix = Math.min(1, Math.max(0, (p.noise - 1000) / 7000));

        noiseEnv.gain.setValueAtTime(p.volume * noiseMix, time);
        noiseEnv.gain.exponentialRampToValueAtTime(0.01, time + p.decay);

        // Tone
        const osc = offlineCtx.createOscillator();
        osc.type = 'triangle';
        // Use p.tone for frequency
        osc.frequency.setValueAtTime(p.tone, time);

        const toneEnv = offlineCtx.createGain();
        // Tone volume inverse to noise? Or independent?
        toneEnv.gain.setValueAtTime(p.volume * (1 - noiseMix * 0.5), time);
        toneEnv.gain.exponentialRampToValueAtTime(0.01, time + p.decay * 0.5);

        noiseSrc.connect(noiseEnv);
        noiseEnv.connect(gain);

        osc.connect(toneEnv);
        toneEnv.connect(gain);

        noiseSrc.start(time);
        osc.start(time);
    }
    else {
        // Hats
        const p = params as HatParams;
         // Noise
        const bufferSize = sampleRate * duration;
        const buffer = offlineCtx.createBuffer(1, bufferSize, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noiseSrc = offlineCtx.createBufferSource();
        noiseSrc.buffer = buffer;

        // Highpass
        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = Math.max(1000, 8000 + (p.pitch || 0));

        const env = offlineCtx.createGain();
        env.gain.setValueAtTime(p.volume, time);
        env.gain.exponentialRampToValueAtTime(0.01, time + p.decay);

        noiseSrc.connect(filter);
        filter.connect(env);
        env.connect(gain);

        noiseSrc.start(time);
    }

    return await offlineCtx.startRendering();
}
