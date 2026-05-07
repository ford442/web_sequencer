/**
 * Synth Playback Functions
 * 
 * Handles playback of synthesized sounds including:
 * - Standard oscillators (sawtooth, square, triangle, sine)
 * - WAV file-based playback (wav-saw, wav-sqr)
 * - Open303 (TB-303 clone) synthesis
 */

import type { SynthParams } from '../../types';
import { tunedNoteToFrequency } from '../../constants';
import type { ScaleDefinition } from '../../utils/musicTheory';
import { noteToMidi } from '../../utils/musicTheory';
import type { Open303Oscillator } from '../../engines/Open303Oscillator';

// Map UI params to Engine params
export function apply303Params(
    engine: Open303Oscillator, 
    params: SynthParams, 
    waveType: string
): void {
    engine.setWaveform(waveType === 'sqr' ? 1.0 : 0.0);
    // UI Cutoff (0-20000) -> Engine (0-1)
    engine.setCutoff(Math.max(0, Math.min(1, params.filterCutoff / 8000)));
    // UI Res (0-20) -> Engine (0-1)
    engine.setResonance(Math.max(0, Math.min(1, params.filterResonance / 20)));
    engine.setFilterMode(Math.max(0, Math.min(1, params.filterMode ?? 0)));
    engine.setDecay(params.decay);
    engine.setVolume(params.volume);
}

export interface SynthPlaybackContext {
    context: AudioContext;
    masterGain: GainNode;
    open303Engine?: Open303Oscillator | null;
    wavSawBuffer: AudioBuffer | null;
    wavSqrBuffer: AudioBuffer | null;
}

export interface SynthNoteState {
    nextNoteId: number;
    activeNotes: Map<number, { stop: () => void }>;
}

/**
 * Play a synthesized note
 */
export function playSynth(
    ctx: SynthPlaybackContext,
    params: SynthParams,
    note: string,
    time: number,
    durationSteps: number = 1,
    stepTime: number = 0.2
): void {
    const { context, masterGain, open303Engine, wavSawBuffer, wavSqrBuffer } = ctx;
    
    if (!masterGain) return;

    // Open303 Routing
    if (params.waveform === '303-saw' || params.waveform === '303-sqr') {
        if (open303Engine) {
            apply303Params(open303Engine, params, params.waveform === '303-sqr' ? 'sqr' : 'saw');
            const midi = noteToMidi(note);

            const now = context.currentTime;
            const startDelay = Math.max(0, time - now);
            const duration = durationSteps * stepTime;

            setTimeout(() => {
                open303Engine.noteOn(midi, 100);
            }, startDelay * 1000);

            setTimeout(() => {
                open303Engine.noteOff(midi);
            }, (startDelay + duration) * 1000);

            return;
        }
    }

    const freq = tunedNoteToFrequency(note, tuning);
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(params.filterCutoff, time);
    filter.Q.value = params.filterResonance;

    // Handle WAV buffer playback
    let customBuffer: AudioBuffer | null = null;
    if (params.waveform === 'wav-saw') customBuffer = wavSawBuffer;
    else if (params.waveform === 'wav-sqr') customBuffer = wavSqrBuffer;

    if (customBuffer) {
        // WAV playback logic
        const source = context.createBufferSource();
        source.buffer = customBuffer;
        source.playbackRate.value = freq / 440; // Adjust pitch based on frequency
        
        // Envelope for WAV playback
        const attackEnd = time + params.attack;
        const decayEnd = attackEnd + params.decay;
        const releaseStart = time + (durationSteps * stepTime);
        const releaseEnd = releaseStart + params.release;
        
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(params.volume, attackEnd);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, params.volume * params.sustain), decayEnd);
        gain.gain.setValueAtTime(Math.max(0.001, params.volume * params.sustain), releaseStart);
        gain.gain.exponentialRampToValueAtTime(0.001, releaseEnd);
        
        source.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        
        source.start(time);
        source.stop(releaseEnd + 0.1);
        
        // Cleanup
        setTimeout(() => {
            source.disconnect();
            filter.disconnect();
            gain.disconnect();
        }, (releaseEnd - time + 1.0) * 1000);
        return;
    }

    // Standard Oscillator
    const osc = context.createOscillator();
    if (params.waveform === 'sawtooth' || params.waveform === 'square' || params.waveform === 'triangle' || params.waveform === 'sine') {
        osc.type = params.waveform;
    } else {
        osc.type = 'sawtooth'; // Fallback
    }

    // Envelope
    const now = time;
    const attackEnd = now + params.attack;
    const decayEnd = attackEnd + params.decay;
    const releaseStart = now + (durationSteps * stepTime); // Simple gate
    const releaseEnd = releaseStart + params.release;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(params.volume, attackEnd);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, params.volume * params.sustain), decayEnd);
    gain.gain.setValueAtTime(Math.max(0.001, params.volume * params.sustain), releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.001, releaseEnd);

    // Delay
    const delay = context.createDelay();
    delay.delayTime.value = params.delayTime;
    const delayGain = context.createGain();
    delayGain.gain.value = params.delayFeedback;

    const wetGain = context.createGain();
    wetGain.gain.value = params.delayMix;
    const dryGain = context.createGain();
    dryGain.gain.value = 1 - params.delayMix;

    // Graph
    osc.connect(filter);
    filter.connect(gain);

    // Split to Dry/Wet
    gain.connect(dryGain);
    gain.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(delay); // Feedback
    delay.connect(wetGain);

    dryGain.connect(masterGain);
    wetGain.connect(masterGain);

    osc.frequency.setValueAtTime(freq, now);
    osc.start(now);
    osc.stop(releaseEnd + 0.1);

    // Cleanup
    setTimeout(() => {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
        delay.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
    }, (releaseEnd - now + 1.0) * 1000);
}

/**
 * Trigger a synth note on (for interactive play)
 * Returns note ID for noteOff
 */
export function noteOnSynth(
    ctx: SynthPlaybackContext,
    state: SynthNoteState,
    params: SynthParams,
    note: string,
    _time?: number
): number | null {
    // Interactive Synth trigger
    if (params.waveform === '303-saw' || params.waveform === '303-sqr') {
        if (ctx.open303Engine) {
            apply303Params(ctx.open303Engine, params, params.waveform === '303-sqr' ? 'sqr' : 'saw');
            const midi = noteToMidi(note);
            ctx.open303Engine.noteOn(midi, 100);
            const id = state.nextNoteId++;
            state.activeNotes.set(id, { stop: () => ctx.open303Engine?.noteOff(midi) });
            return id;
        }
    }
    return null; // For now only 303 interactive
}

/**
 * Release a synth note
 */
export function noteOffSynth(
    state: SynthNoteState,
    id: number
): void {
    const entry = state.activeNotes.get(id);
    if (entry) {
        entry.stop();
        state.activeNotes.delete(id);
    }
}

/**
 * Stop all active synth notes
 */
export function stopAllSynthNotes(state: SynthNoteState): void {
    state.activeNotes.forEach(n => n.stop());
    state.activeNotes.clear();
}
