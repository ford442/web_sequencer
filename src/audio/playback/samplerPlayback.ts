/**
 * Sampler Playback Functions
 * 
 * Handles playback of sampled sounds:
 * - One-shot and looped playback
 * - Time-stretching with SingingVoice
 * - Phoneme slicing
 * - Interactive note on/off
 */

import type { SamplerBankParams } from '../../types';
import { noteToMidi } from '../../utils/musicTheory';
import type { SingingVoice } from '../../engines/SingingVoice';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';

// Helper for distortion
const distortionCurveCache = new Map<number, Float32Array<ArrayBuffer>>();

function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const k_raw = typeof amount === 'number' ? amount : 50;
    const k = Math.round(k_raw * 10) / 10;
    if (distortionCurveCache.has(k)) return distortionCurveCache.get(k)!;
    const n_samples = 8192, curve = new Float32Array(n_samples), deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    distortionCurveCache.set(k, curve);
    return curve;
}

export interface SamplerPlaybackContext {
    context: AudioContext;
    masterGain: GainNode;
    singingVoice?: SingingVoice | null;
}

export interface SamplerState {
    loadedSampleBuffers: Map<string, AudioBuffer>;
    vocalAlignments: Map<string, AlignmentResult>;
    nextNoteId: number;
    activeNotes: Map<number, { source: AudioBufferSourceNode; envGain: GainNode }>;
}

/**
 * Play a sampler sound
 */
export function playSampler(
    ctx: SamplerPlaybackContext,
    state: SamplerState,
    params: SamplerBankParams,
    note: string,
    time: number,
    durationSteps: number = 1,
    stepTime: number = 0.2
): void {
    const { context, masterGain, singingVoice } = ctx;
    const buffer = state.loadedSampleBuffers.get(params.sampleName);
    
    if (!buffer || !masterGain) return;

    if (params.mode === 'stretch' && singingVoice) {
        // PHONEME ELASTICITY & SINGING VOICE MODE
        const voice = singingVoice;
        const targetDuration = durationSteps * stepTime;
        const originalDuration = buffer.duration;

        // CHECK FOR SLICE TRIGGER MODE
        if (params.sliceMode === 'phoneme') {
            const alignment = state.vocalAlignments.get(params.sampleName);
            if (alignment) {
                const targetMidi = noteToMidi(note);
                // Map MIDI C3 (60) to slice 0
                const sliceIndex = targetMidi - 60;

                if (sliceIndex >= 0) {
                    voice.triggerSlice(buffer.getChannelData(0), sliceIndex, alignment);
                    return;
                }
            }
        }

        // 1. Calculate Time Ratio
        const timeRatio = targetDuration / originalDuration;
        voice.setTimeRatio(timeRatio);

        // 2. Pitch Shift
        // Assuming base note C4 (60) for the sample
        const targetMidi = noteToMidi(note);
        voice.setPitchFromMidi(targetMidi, 60);

        // 3. Phoneme Awareness
        const alignment = state.vocalAlignments.get(params.sampleName);

        if (alignment) {
            // Explicitly set the alignment for this voice operation
            voice.setAlignment(alignment);
            voice.sendPhonemeDataToWorklet(targetDuration);
        }

        // 4. Process
        voice.process(buffer.getChannelData(0));
        return;
    }

    // Standard Loop / One-shot
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = params.playbackSpeed;

    const gain = context.createGain();
    gain.gain.value = params.volume;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = params.filterCutoff;
    filter.Q.value = params.filterResonance;

    // Distortion (Simple waveshaper)
    const shaper = context.createWaveShaper();
    if (params.drive > 0) {
        shaper.curve = makeDistortionCurve(params.drive * 100);
    } else {
        shaper.curve = null; // Bypass
    }

    source.connect(filter);
    filter.connect(shaper);
    shaper.connect(gain);
    gain.connect(masterGain);

    source.start(time);
}

/**
 * Trigger a sampler note on (for interactive play)
 * Returns note ID for noteOff
 */
export function noteOnSampler(
    ctx: SamplerPlaybackContext,
    state: SamplerState,
    params: SamplerBankParams,
    _note: string,
    time?: number
): number | null {
    const { context, masterGain } = ctx;
    const now = time || context.currentTime;
    const buffer = state.loadedSampleBuffers.get(params.sampleName);
    
    if (!buffer || !masterGain) return null;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = params.playbackSpeed;

    const gain = context.createGain();
    gain.gain.value = params.volume;

    source.connect(gain);
    gain.connect(masterGain);
    source.start(now);

    const id = state.nextNoteId++;
    state.activeNotes.set(id, { source, envGain: gain });
    return id;
}

/**
 * Release a sampler note
 */
export function noteOffSampler(
    ctx: SamplerPlaybackContext,
    state: SamplerState,
    id: number
): void {
    const { context } = ctx;
    const note = state.activeNotes.get(id);
    if (note) {
        const now = context.currentTime;
        note.envGain.gain.cancelScheduledValues(now);
        note.envGain.gain.linearRampToValueAtTime(0, now + 0.1);
        note.source.stop(now + 0.1);
        state.activeNotes.delete(id);
    }
}

/**
 * Stop all active sampler notes
 */
export function stopAllSamplerNotes(state: SamplerState): void {
    state.activeNotes.forEach(n => {
        try { n.source.stop(); } catch {}
    });
    state.activeNotes.clear();
}

/**
 * Load a sample into the sampler
 */
export function loadSampleToEngine(
    state: SamplerState,
    name: string,
    buffer: AudioBuffer
): void {
    state.loadedSampleBuffers.set(name, buffer);
}

/**
 * Prepare vocal alignment for a bank
 */
export async function prepareVocal(
    state: SamplerState,
    singingVoice: SingingVoice | null,
    bankIndex: number,
    text: string
): Promise<void> {
    if (!singingVoice) return;
    const bankName = `bank_${bankIndex}`;
    const buffer = state.loadedSampleBuffers.get(bankName);
    if (!buffer) return;

    const audio = buffer.getChannelData(0);
    try {
        const alignment = await singingVoice.alignPhonemes(audio, text);
        if (alignment) {
            state.vocalAlignments.set(bankName, alignment);
        }
    } catch (e) {
        console.warn('Phoneme alignment failed:', e);
    }
}
