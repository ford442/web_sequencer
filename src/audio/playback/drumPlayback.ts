/**
 * Drum Playback Functions
 * 
 * Handles playback of drum sounds:
 * - Kick drum (oscillator with pitch envelope)
 * - Snare (tone + noise)
 * - Hi-hats (filtered noise)
 */

import type { KickParams, SnareParams, HatParams, DrumSound } from '../../types';

export interface DrumPlaybackContext {
    context: AudioContext;
    masterGain: GainNode;
    noiseBuffer: AudioBuffer | null;
}

/**
 * Play a drum sound
 */
export function playDrum(
    ctx: DrumPlaybackContext,
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    time: number
): void {
    const { context, masterGain, noiseBuffer } = ctx;
    
    if (!masterGain) return;
    const now = time;

    if (sound === 'kick') {
        const p = params as KickParams;
        const osc = context.createOscillator();
        const gain = context.createGain();

        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(0.01, now + p.decay);

        gain.gain.setValueAtTime(p.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(now);
        osc.stop(now + p.decay);
    } else if (sound === 'snare') {
        const p = params as SnareParams;
        // Tone
        const osc = context.createOscillator();
        const oscGain = context.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(250, now);
        oscGain.gain.setValueAtTime(p.tone * p.volume, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + p.decay); // Using decay for tone too

        // Noise
        if (noiseBuffer) {
            const noise = context.createBufferSource();
            noise.buffer = noiseBuffer;
            const noiseFilter = context.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 1000;
            const noiseGain = context.createGain();
            noiseGain.gain.setValueAtTime(p.noise * p.volume, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);

            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(masterGain);
            noise.start(now);
            noise.stop(now + p.decay);
        }

        osc.connect(oscGain);
        oscGain.connect(masterGain);
        osc.start(now);
        osc.stop(now + p.decay);

    } else {
        // Hats (closedHat or openHat)
        const p = params as HatParams;
        if (noiseBuffer) {
            const src = context.createBufferSource();
            src.buffer = noiseBuffer;
            const filter = context.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 5000; // Metallic
            const gain = context.createGain();
            gain.gain.setValueAtTime(p.volume, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);

            src.connect(filter);
            filter.connect(gain);
            gain.connect(masterGain);
            src.start(now);
            src.stop(now + p.decay);
        }
    }
}
