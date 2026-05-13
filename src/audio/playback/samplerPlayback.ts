/**
 * Sampler Playback Functions
 *
 * Handles playback of sampled sounds with full microtonal support.
 */
import type { SamplerBankParams } from '../../types';
import { noteToMidi, applyMicrotonalTuning, type ScaleDefinition } from '../../utils/musicTheory';
import type { SingingVoice } from '../../engines/SingingVoice';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';
import type { MultisampleBank } from '../../engines/MultisampleGenerator';

// Helper for distortion (cached)
const distortionCurveCache = new Map<number, Float32Array>();
function makeDistortionCurve(amount: number): Float32Array {
    const k = Math.round((typeof amount === 'number' ? amount : 50) * 10) / 10;
    if (distortionCurveCache.has(k)) return distortionCurveCache.get(k)!;

    const n_samples = 8192;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
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
    loadedSampleBuffers: Map<string, AudioBuffer>;   // legacy
    loadedSampleBanks: Map<string, MultisampleBank>;
    vocalAlignments: Map<string, AlignmentResult>;
    nextNoteId: number;
    activeNotes: Map<number, { source: AudioBufferSourceNode; envGain: GainNode }>;
}

export function createSamplerState(): SamplerState {
    return {
        loadedSampleBuffers: new Map(),
        loadedSampleBanks: new Map(),
        vocalAlignments: new Map(),
        nextNoteId: 1,
        activeNotes: new Map()
    };
}

/** Core playback with multisample + microtonal support */
export function playSampler(
    ctx: SamplerPlaybackContext,
    state: SamplerState,
    params: SamplerBankParams,
    note: string,
    time: number,
    durationSteps: number = 1,
    stepTime: number = 0.2,
    tuning: ScaleDefinition | null = null
): void {
    const { context, masterGain, singingVoice } = ctx;

    const multisampleBank = state.loadedSampleBanks.get(params.sampleName);
    const legacyBuffer = state.loadedSampleBuffers.get(params.sampleName);
    const buffer = multisampleBank?.baseBuffer || legacyBuffer;

    if (!buffer || !masterGain) return;

    // === Singing Voice / Phoneme Stretch Mode ===
    if (params.mode === 'stretch' && singingVoice) {
        const voice = singingVoice;
        const targetDuration = durationSteps * stepTime;

        if (params.sliceMode === 'phoneme') {
            const alignment = state.vocalAlignments.get(params.sampleName);
            if (alignment) {
                const targetMidi = noteToMidi(note);
                const sliceIndex = targetMidi - 60;
                if (sliceIndex >= 0) {
                    voice.triggerSlice(buffer.getChannelData(0), sliceIndex, alignment);
                    return;
                }
            }
        }

        const timeRatio = targetDuration / buffer.duration;
        voice.setTimeRatio(timeRatio);

        let targetMidi = noteToMidi(note);
        targetMidi = applyMicrotonalTuning(targetMidi, tuning);
        voice.setPitchFromMidi(targetMidi, 60); // base = C4

        const alignment = state.vocalAlignments.get(params.sampleName);
        if (alignment) {
            voice.setAlignment(alignment);
            voice.sendPhonemeDataToWorklet(targetDuration);
        }

        voice.process(buffer.getChannelData(0));
        return;
    }

    // === Standard One-shot / Loop with Pitch ===
    const source = context.createBufferSource();
    let targetMidi = noteToMidi(note);
    targetMidi = applyMicrotonalTuning(targetMidi, tuning);

    let playbackBuffer: AudioBuffer;
    let pitchRatio: number;

    if (multisampleBank?.pitchBank.has(targetMidi)) {
        // High-quality pre-rendered multisample
        playbackBuffer = multisampleBank.pitchBank.get(targetMidi)!;
        pitchRatio = params.playbackSpeed ?? 1;
    } else {
        // Fallback pitch shift
        playbackBuffer = multisampleBank?.baseBuffer || buffer;
        const rootMidi = params.rootNote ?? multisampleBank?.rootNote ?? 60;

        const targetFreq = 440 * Math.pow(2, (targetMidi - 69) / 12);
        const rootFreq = 440 * Math.pow(2, (rootMidi - 69) / 12);
        pitchRatio = (params.playbackSpeed ?? 1) * (targetFreq / rootFreq);
    }

    source.buffer = playbackBuffer;
    source.playbackRate.value = pitchRatio;

    // Audio graph
    const gain = context.createGain();
    gain.gain.value = params.volume;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = params.filterCutoff ?? 20000;
    filter.Q.value = params.filterResonance ?? 1;

    const shaper = context.createWaveShaper();
    shaper.curve = params.drive > 0 ? makeDistortionCurve(params.drive * 100) as Float32Array<ArrayBuffer> : null;

    source.connect(filter);
    filter.connect(shaper);
    shaper.connect(gain);
    gain.connect(masterGain);

    source.start(time);
}

/** Interactive keyboard note on */
export function noteOnSampler(
    ctx: SamplerPlaybackContext,
    state: SamplerState,
    params: SamplerBankParams,
    note: string,
    time?: number,
    tuning: ScaleDefinition | null = null
): number | null {
    const { context, masterGain } = ctx;
    const now = time ?? context.currentTime;

    const multisampleBank = state.loadedSampleBanks.get(params.sampleName);
    const legacyBuffer = state.loadedSampleBuffers.get(params.sampleName);
    const buffer = multisampleBank?.baseBuffer || legacyBuffer;

    if (!buffer || !masterGain) return null;

    let targetMidi = noteToMidi(note);
    targetMidi = applyMicrotonalTuning(targetMidi, tuning);

    const source = context.createBufferSource();

    let playbackBuffer: AudioBuffer;
    let pitchRatio: number;

    if (multisampleBank?.pitchBank.has(targetMidi)) {
        playbackBuffer = multisampleBank.pitchBank.get(targetMidi)!;
        pitchRatio = params.playbackSpeed ?? 1;
    } else {
        playbackBuffer = multisampleBank?.baseBuffer || buffer;
        const rootMidi = params.rootNote ?? multisampleBank?.rootNote ?? 60;

        const targetFreq = 440 * Math.pow(2, (targetMidi - 69) / 12);
        const rootFreq = 440 * Math.pow(2, (rootMidi - 69) / 12);
        pitchRatio = (params.playbackSpeed ?? 1) * (targetFreq / rootFreq);
    }

    source.buffer = playbackBuffer;
    source.playbackRate.value = pitchRatio;

    const gain = context.createGain();
    gain.gain.value = params.volume;

    source.connect(gain);
    gain.connect(masterGain);
    source.start(now);

    const id = state.nextNoteId++;
    state.activeNotes.set(id, { source, envGain: gain });
    return id;
}

export function noteOffSampler(ctx: SamplerPlaybackContext, state: SamplerState, id: number): void {
    const note = state.activeNotes.get(id);
    if (!note) return;

    const now = ctx.context.currentTime;
    note.envGain.gain.cancelScheduledValues(now);
    note.envGain.gain.linearRampToValueAtTime(0, now + 0.1);
    note.source.stop(now + 0.1);
    state.activeNotes.delete(id);
}

export function stopAllSamplerNotes(state: SamplerState): void {
    state.activeNotes.forEach(n => {
        try { n.source.stop(); } catch {}
    });
    state.activeNotes.clear();
}

// Load helpers (unchanged except type safety)
export function loadSampleToEngine(state: SamplerState, name: string, buffer: AudioBuffer): void {
    state.loadedSampleBuffers.set(name, buffer);

    const bank: MultisampleBank = {
        baseBuffer: buffer,
        pitchBank: new Map([[60, buffer]]),
        isProcessing: false,
        processingProgress: 1,
        rootNote: 60
    };
    state.loadedSampleBanks.set(name, bank);
}

export function updateMultisampleBank(state: SamplerState, name: string, bank: MultisampleBank): void {
    state.loadedSampleBanks.set(name, bank);
}

export function getMultisampleBank(state: SamplerState, name: string): MultisampleBank | null {
    return state.loadedSampleBanks.get(name) ?? null;
}

export function isMultisampleReady(state: SamplerState, name: string): boolean {
    const bank = state.loadedSampleBanks.get(name);
    return bank ? !bank.isProcessing : false;
}

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

    try {
        const alignment = await singingVoice.alignPhonemes(buffer.getChannelData(0), text);
        if (alignment) state.vocalAlignments.set(bankName, alignment);
    } catch (e) {
        console.warn('Phoneme alignment failed:', e);
    }
}