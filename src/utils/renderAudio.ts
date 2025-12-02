import type { SynthParams, KickParams, SnareParams, HatParams } from '../types';
import { noteToFrequency } from '../constants';

/**
 * Renders a synth sound to an AudioBuffer.
 * Useful for exporting to XM samples.
 */
export async function renderSynthToBuffer(
    params: SynthParams,
    note: string = 'C4',
    duration: number = 2.0
): Promise<AudioBuffer> {
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate);

    const time = 0;
    const baseFreq = noteToFrequency(note);
    // Apply pitch shift from params
    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);

    // Waveform
    const osc = offlineCtx.createOscillator();
    let type: OscillatorType = 'sawtooth';
    if (params.waveform.includes('sqr')) type = 'square';
    else if (params.waveform.includes('tri')) type = 'triangle';
    else if (params.waveform.includes('sin')) type = 'sine';
    osc.type = type;
    osc.frequency.setValueAtTime(freqWithPitch, time);

    // Filter
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(params.filterCutoff, time);
    filter.Q.setValueAtTime(params.filterResonance, time);

    // VCA (Envelope)
    const gain = offlineCtx.createGain();
    const attack = params.attack;
    const decay = params.decay;
    const sustain = params.sustain;
    const release = params.release;

    // Simple ADSR logic matching the engine
    // Note: XM players have their own envelopes, but if we want to capture the "synth sound"
    // including the filter character, we might want to bake some of it in.
    // However, usually for XM samples, you want the raw waveform or a simple sustain loop.
    // If we bake the envelope, the XM envelope will double-apply.
    // BUT: The user asked to "render down instruments".
    // Best approach: Render with a flat sustain so the XM envelope can do the work?
    // OR: Render the "One Shot" sound.
    // Let's render the full "pluck" sound (Attack, Decay, Sustain, Release)
    // effectively creating a "Sampled Synth".

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(1.0, time + attack); // Normalize to 1.0 for sample
    gain.gain.linearRampToValueAtTime(sustain, time + attack + decay);
    // Hold sustain
    gain.gain.setValueAtTime(sustain, duration - release);
    gain.gain.linearRampToValueAtTime(0, duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(offlineCtx.destination);

    osc.start(time);
    osc.stop(time + duration);

    return await offlineCtx.startRendering();
}

/**
 * Renders a drum sound to an AudioBuffer.
 */
export async function renderDrumToBuffer(
    sound: 'kick' | 'snare' | 'closedHat' | 'openHat',
    params: any
): Promise<AudioBuffer> {
    const sampleRate = 44100;
    // Estimate duration based on params or defaults
    const duration = sound === 'snare' ? 0.5 : (sound === 'kick' ? 0.5 : 0.3);
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate);
    const time = 0;

    const gain = offlineCtx.createGain();
    gain.connect(offlineCtx.destination);

    // Very simplified recreation of the Pyodide generation logic using Web Audio
    // because we cannot easily run Pyodide in OfflineAudioContext without a lot of hacks.
    // This is a "Best Effort" approximation for the export.

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
        // p.noise is roughly 1000..8000. Let's map it to a mix level (0..1)
        // or just use it as is if it's meant to be amplitude?
        // Looking at App.tsx: id === 'noise', val * 7000 + 1000.
        // It seems to be a frequency or amount?
        // In the engine, it might be a filter cutoff or gain.
        // Let's assume it balances Noise vs Tone.
        // Higher p.noise = More Noise Gain.
        // Normalize 1000-8000 to 0.2 - 1.0
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
        // Let's keep it independent but scaled
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
        // Use p.pitch to adjust filter cutoff? HatParams has pitch.
        // Assuming pitch affects brightness/cutoff.
        // Base 8000 + pitch offset?
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
