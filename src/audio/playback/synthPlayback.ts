/**
 * Synth Playback Functions
 *
 * Handles playback of synthesized sounds including:
 * - Standard oscillators (sawtooth, square, triangle, sine)
 * - WAV file-based playback (wav-saw, wav-sqr)
 * - Open303 (TB-303 clone) synthesis
 * - Prophecy formant synthesis
 */
import type { SynthParams } from '../../types';
import { tunedNoteToFrequency } from '../../constants';
import { noteToMidi } from '../../utils/musicTheory';
import { getPitchOffsetSemitones, transposeMidi, transposeFrequency } from '../../utils/pitchOffset';
import type { ScaleDefinition } from '../../utils/musicTheory';
import type { Open303Oscillator } from '../../engines/Open303Oscillator';
import type { ProphecyOscillator } from '../../engines/ProphecyOscillator';
import { PROPHECY_WAVEFORM_SUFFIX, PROPHECY_WAVEFORM_ID } from '../../engines/ProphecyParams';

// Map UI params to Open303 engine
export function apply303Params(
    engine: Open303Oscillator,
    params: SynthParams,
    waveType: string
): void {
    engine.setWaveform(waveType === 'sqr' ? 1.0 : 0.0);
    // UI Cutoff (0-20000) → Engine (0-1)
    engine.setCutoff(Math.max(0, Math.min(1, params.filterCutoff / 8000)));
    // UI Res (0-20) → Engine (0-1)
    engine.setResonance(Math.max(0, Math.min(1, params.filterResonance / 20)));
    engine.setFilterMode(Math.max(0, Math.min(1, params.filterMode ?? 0)));
    engine.setDecay(params.decay);
    engine.setVolume(params.volume);
}

// Map UI params to Prophecy engine
export function applyProphecyParams(
    engine: ProphecyOscillator,
    params: SynthParams,
    waveType: string
): void {
    engine.setWaveform(PROPHECY_WAVEFORM_ID[waveType] ?? 0);
    engine.setVolume(params.volume);
    engine.setAttack(Math.max(0, Math.min(1, params.attack / 2)));
    engine.setDecay(Math.max(0, Math.min(1, params.decay / 2)));
    engine.setSustain(Math.max(0, Math.min(1, params.sustain)));
    engine.setRelease(Math.max(0, Math.min(1, params.release / 3)));
    engine.setResonance(Math.max(0, Math.min(1, 1 - params.filterResonance / 20)));
}

export interface SynthPlaybackContext {
    context: AudioContext;
    masterGain: GainNode;
    open303Engine?: Open303Oscillator | null;
    prophecyEngine?: ProphecyOscillator | null;
    wavSawBuffer: AudioBuffer | null;
    wavSqrBuffer: AudioBuffer | null;
}

export interface SynthNoteState {
    nextNoteId: number;
    activeNotes: Map<number, { stop: () => void }>;
}

/**
 * Play a synthesized note with microtonal support
 */
export function playSynth(
    ctx: SynthPlaybackContext,
    params: SynthParams,
    note: string,
    time: number,
    durationSteps: number = 1,
    stepTime: number = 0.2,
    tuning: ScaleDefinition | null = null
): void {
    const { context, masterGain, open303Engine, prophecyEngine, wavSawBuffer, wavSqrBuffer } = ctx;

    if (!masterGain) return;

    // === Open303 Routing ===
    if (params.waveform === '303-saw' || params.waveform === '303-sqr') {
        if (open303Engine) {
            apply303Params(open303Engine, params, params.waveform === '303-sqr' ? 'sqr' : 'saw');

            const midi = transposeMidi(noteToMidi(note), getPitchOffsetSemitones(params));
            const now = context.currentTime;
            const startDelay = Math.max(0, time - now);
            const duration = durationSteps * stepTime;

            open303Engine.noteOn(midi, 100, now + startDelay);
            open303Engine.noteOff(midi, now + startDelay + duration);
            return;
        }
    }

    // === Prophecy Routing ===
    const prophecyWaveType = PROPHECY_WAVEFORM_SUFFIX[params.waveform];
    if (prophecyWaveType !== undefined) {
        if (prophecyEngine) {
            applyProphecyParams(prophecyEngine, params, prophecyWaveType);

            const midi = transposeMidi(noteToMidi(note), getPitchOffsetSemitones(params));
            const now = context.currentTime;
            const startDelay = Math.max(0, time - now);
            const duration = durationSteps * stepTime;

            prophecyEngine.noteOn(midi, 100, now + startDelay);
            prophecyEngine.noteOff(midi, now + startDelay + duration);
            return;
        }
    }

    // === Frequency with Microtonal Tuning ===
    const freq = transposeFrequency(tunedNoteToFrequency(note, tuning), getPitchOffsetSemitones(params));

    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(params.filterCutoff, time);
    filter.Q.value = params.filterResonance;

    // Handle WAV buffer playback (wav-saw / wav-sqr)
    let customBuffer: AudioBuffer | null = null;
    if (params.waveform === 'wav-saw') customBuffer = wavSawBuffer;
    else if (params.waveform === 'wav-sqr') customBuffer = wavSqrBuffer;

    if (customBuffer) {
        const source = context.createBufferSource();
        source.buffer = customBuffer;
        source.playbackRate.value = freq / 440; // Base = A4

        // ADSR Envelope
        const attackEnd = time + params.attack;
        const decayEnd = attackEnd + params.decay;
        const releaseStart = time + (durationSteps * stepTime);
        const releaseEnd = releaseStart + params.release;

        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(params.volume, attackEnd);
        gain.gain.exponentialRampToValueAtTime(
            Math.max(0.001, params.volume * params.sustain),
            decayEnd
        );
        gain.gain.setValueAtTime(
            Math.max(0.001, params.volume * params.sustain),
            releaseStart
        );
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
        }, (releaseEnd - time + 1) * 1000);
        return;
    }

    // === Standard Oscillator ===
    const osc = context.createOscillator();
    if (['sawtooth', 'square', 'triangle', 'sine'].includes(params.waveform)) {
        osc.type = params.waveform as OscillatorType;
    } else {
        osc.type = 'sawtooth';
    }

    // ADSR Envelope
    const now = time;
    const attackEnd = now + params.attack;
    const decayEnd = attackEnd + params.decay;
    const releaseStart = now + (durationSteps * stepTime);
    const releaseEnd = releaseStart + params.release;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(params.volume, attackEnd);
    gain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, params.volume * params.sustain),
        decayEnd
    );
    gain.gain.setValueAtTime(
        Math.max(0.001, params.volume * params.sustain),
        releaseStart
    );
    gain.gain.exponentialRampToValueAtTime(0.001, releaseEnd);

    // Delay effect
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
    gain.connect(dryGain);
    gain.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(delay); // feedback
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
        delayGain.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
    }, (releaseEnd - now + 1) * 1000);
}

/**
 * Trigger interactive synth note (mainly for 303 and Prophecy)
 */
export function noteOnSynth(
    ctx: SynthPlaybackContext,
    state: SynthNoteState,
    params: SynthParams,
    note: string,
    tuning: ScaleDefinition | null = null // Added for future extensibility
): number | null {
    if (params.waveform === '303-saw' || params.waveform === '303-sqr') {
        if (ctx.open303Engine) {
            apply303Params(ctx.open303Engine, params, params.waveform === '303-sqr' ? 'sqr' : 'saw');

            const midi = transposeMidi(noteToMidi(note), getPitchOffsetSemitones(params));
            ctx.open303Engine.noteOn(midi, 100);

            const id = state.nextNoteId++;
            state.activeNotes.set(id, {
                stop: () => ctx.open303Engine?.noteOff(midi)
            });
            return id;
        }
    }

    const prophecyWaveType = PROPHECY_WAVEFORM_SUFFIX[params.waveform];
    if (prophecyWaveType !== undefined) {
        if (ctx.prophecyEngine) {
            applyProphecyParams(ctx.prophecyEngine, params, prophecyWaveType);

            const midi = transposeMidi(noteToMidi(note), getPitchOffsetSemitones(params));
            ctx.prophecyEngine.noteOn(midi, 100);

            const id = state.nextNoteId++;
            state.activeNotes.set(id, {
                stop: () => ctx.prophecyEngine?.noteOff(midi)
            });
            return id;
        }
    }

    return null; // Standard oscillators not yet supported in live noteOn
}

/**
 * Release a synth note
 */
export function noteOffSynth(state: SynthNoteState, id: number): void {
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
    for (const n of state.activeNotes.values()) n.stop();
    state.activeNotes.clear();
}