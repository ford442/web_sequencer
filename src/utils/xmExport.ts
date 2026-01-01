import {
    createModule, createPattern, createInstrument, createSample, addSampleToInstrument,
    XMWriter, noteNameToValue, LoopType
} from './xm_save_lib/index';
import type { PartSequence, Pattern, SynthParams, KickParams, SnareParams, HatParams, SamplerParams } from '../types';
import { renderSynthToBuffer, renderDrumToBuffer } from './renderAudio';

type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

// --- Configuration Constants ---
/** Peak level threshold below which normalization is applied */
const NORMALIZATION_PEAK_THRESHOLD = 0.5;

// @migrate-target: assemblyscript
// @perf-bottleneck: Double iteration over buffer for peak finding and scaling
/** Minimum sample duration (in seconds) to enable looping for samplers */
const SAMPLER_LOOP_DURATION_THRESHOLD = 0.5;
/** Base render duration for synths (in seconds) for steady-state detection */
const SYNTH_RENDER_BASE_DURATION = 1.0;
/** Safety multiplier for attack+decay time when calculating synth render duration */
const SYNTH_RENDER_AD_MULTIPLIER = 2.0;

// Helper to download blob
const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

/**
 * Normalize an audio buffer to a target peak level (default -1dB).
 * This addresses Task 4: Fix low sampler volume.
 * @param input Float32Array audio buffer
 * @param targetPeakDb Target peak in dB (default -1)
 * @returns Normalized Float32Array
 */
const normalizeBuffer = (input: Float32Array, targetPeakDb: number = -1): Float32Array => {
    // Find peak amplitude
    let peak = 0;
    for (let i = 0; i < input.length; i++) {
        const abs = Math.abs(input[i]);
        if (abs > peak) peak = abs;
    }

    // If peak is already near target or buffer is silent, return as-is
    if (peak < 0.001) return input;

    // Calculate target peak (linear)
    const targetPeak = Math.pow(10, targetPeakDb / 20);

    // Only normalize if peak is below threshold
    if (peak < NORMALIZATION_PEAK_THRESHOLD) {
        const gain = targetPeak / peak;
        const output = new Float32Array(input.length);
        for (let i = 0; i < input.length; i++) {
            const val = input[i] * gain;
            if (val > 1) output[i] = 1;
            else if (val < -1) output[i] = -1;
            else output[i] = val;
        }
        return output;
    }

    return input;
};

// @migrate-target: assemblyscript
// @perf-bottleneck: Iterates buffer applying Math.tanh (expensive) per sample
/**
 * Convert float32 buffer to int16 with proper handling to preserve harmonic content.
 * Uses soft-clipping and proper dithering for better fidelity.
 * This addresses Task 1: Fix waveform & fidelity loss in XM export.
 * @param input Float32Array audio buffer
 * @returns Int16Array for XM sample
 */
const floatTo16BitPCM = (input: Float32Array): Int16Array => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        // Soft clipping using tanh to preserve harmonic content better
        let s = input[i];
        if (s > 0.95) {
            s = Math.tanh(s);
        } else if (s < -0.95) {
            s = Math.tanh(s);
        }

        if (s > 1) s = 1;
        else if (s < -1) s = -1;

        // Symmetric scaling for 16-bit (use 32767 for both positive and negative for symmetry)
        output[i] = Math.round(s * 32767);
    }
    return output;
};

// @migrate-target: assemblyscript
// @perf-bottleneck: Tight loop searching for values, called frequently by findSynthLoopPoints
/**
 * Find a zero-crossing point near the given position.
 * @param buffer Audio buffer
 * @param position Starting position to search from
 * @param direction 1 = forward, -1 = backward
 * @param maxSearch Maximum samples to search
 * @returns Position of zero crossing
 */
const findZeroCrossing = (buffer: Float32Array, position: number, direction: number = 1, maxSearch: number = 1000): number => {
    const len = buffer.length;

    if (direction === 1) {
        if (position < 1 || position >= len - 1) return position;
        const limit = Math.min(position + maxSearch, len - 1);
        for (let idx = position; idx < limit; idx++) {
            if (buffer[idx] >= 0 && buffer[idx - 1] < 0) return idx;
        }
    } else {
        if (position < 1 || position >= len - 1) return position;
        const limit = Math.max(position - maxSearch + 1, 1);
        for (let idx = position; idx >= limit; idx--) {
            if (buffer[idx] >= 0 && buffer[idx - 1] < 0) return idx;
        }
    }
    return position;
};

/**
 * Find optimal loop points for a synth sample by detecting the steady-state region.
 * This addresses Task 3: Implement sustain for rendered synths (auto-looping).
 * @param buffer Audio buffer
 * @param sampleRate Sample rate
 * @param attackDecayTime Estimated attack+decay time in seconds
 * @returns Object with loopStart and loopEnd in samples
 */
const findSynthLoopPoints = (buffer: Float32Array, sampleRate: number = 44100, attackDecayTime: number = 0.3): { loopStart: number, loopEnd: number } => {
    const len = buffer.length;

    // Skip attack/decay phase - start searching after attackDecayTime
    const steadyStateStart = Math.min(Math.floor(attackDecayTime * sampleRate), Math.floor(len * 0.3));

    // End before release phase (last 10% of buffer)
    const steadyStateEnd = Math.floor(len * 0.9);

    // Ensure we have enough samples for a loop
    const minLoopLength = Math.floor(sampleRate * 0.05); // Minimum 50ms loop

    if (steadyStateEnd - steadyStateStart < minLoopLength * 2) {
        // Buffer too short for proper looping, return no loop
        return { loopStart: 0, loopEnd: 0 };
    }

    // Find loop start - first zero crossing in steady state
    const loopStart = findZeroCrossing(buffer, steadyStateStart, 1, Math.floor(sampleRate * 0.1));

    // Find loop end - zero crossing near end of steady state, at least minLoopLength away from start
    const loopEndSearchStart = Math.max(steadyStateEnd, loopStart + minLoopLength);
    const loopEnd = findZeroCrossing(buffer, loopEndSearchStart, -1, Math.floor(sampleRate * 0.2));

    // Validate loop points
    if (loopEnd <= loopStart + minLoopLength) {
        return { loopStart: 0, loopEnd: 0 };
    }

    return { loopStart, loopEnd };
};

/**
 * Find loop points for a sampler based on user settings.
 * This addresses Task 2: Implement note sustain for samplers.
 * @param buffer Audio buffer
 * @param loopEnabled Whether looping is enabled
 * @param sampleRate Sample rate
 * @returns Object with loopStart, loopEnd, and loopType
 */
const findSamplerLoopPoints = (buffer: Float32Array, loopEnabled: boolean, sampleRate: number = 44100): { loopStart: number, loopEnd: number, loopType: number } => {
    if (!loopEnabled) {
        return { loopStart: 0, loopEnd: 0, loopType: LoopType.None };
    }

    const len = buffer.length;

    // For samplers, we want to loop a portion near the end to sustain the sound
    // Skip transient at beginning (first 10ms)
    const transientSkip = Math.floor(sampleRate * 0.01);

    // Find stable region for looping (middle to end)
    const loopRegionStart = Math.max(transientSkip, Math.floor(len * 0.2));
    const loopRegionEnd = Math.floor(len * 0.95);

    // Find zero crossings for clean loop
    const loopStart = findZeroCrossing(buffer, loopRegionStart, 1, Math.floor(sampleRate * 0.1));
    const loopEnd = findZeroCrossing(buffer, loopRegionEnd, -1, Math.floor(sampleRate * 0.1));

    // Minimum loop length (20ms)
    const minLoop = Math.floor(sampleRate * 0.02);

    if (loopEnd <= loopStart + minLoop) {
        return { loopStart: 0, loopEnd: 0, loopType: LoopType.None };
    }

    return { loopStart, loopEnd, loopType: LoopType.Forward };
};

/**
 * Calculate XM relative note and finetune for a given sample rate
 * so that the sample plays at its original pitch when C-4 is triggered.
 * * XM standard C-4 frequency is 8363 Hz.
 * Formula: RelNote = 12 * log2(SampleRate / 8363)
 */
const calculateXMPitchParams = (sampleRate: number) => {
    const C4_FREQ = 8363;
    const totalSemitones = 12 * Math.log2(sampleRate / C4_FREQ);
    
    // Relative Note (Semitone offset)
    const relativeNote = Math.round(totalSemitones);
    
    // Fine Tune (1/128th of a semitone)
    // Range: -128 to +127
    const fineTune = Math.round((totalSemitones - relativeNote) * 128);
    
    return {
        relativeNote: Math.max(-128, Math.min(127, relativeNote)),
        fineTune: Math.max(-128, Math.min(127, fineTune))
    };
};

export const exportSongToXM = async (
    songStructure: { [key in TrackKey]: number | null }[],
    trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>,
    params: {
        synthA: SynthParams, synthB: SynthParams, kick: KickParams, snare: SnareParams, closedHat: HatParams, openHat: HatParams, sampler: SamplerParams
    },
    tempo: number,
    currentPattern?: Pattern,
    engines?: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        webGpuEngine?: any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wasmEngine?: any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pyodide?: any
    },
    sampleBuffers?: (AudioBuffer | null)[]
) => {
    console.log("Starting XM Export with engines:", engines);

    // 1. Create Module
    const mod = createModule({
        moduleName: 'Hyphon Export',
        numberOfChannels: 14,
        defaultTempo: 6,
        defaultBPM: tempo
    });

    // 2. Render and Add Instruments
    // Mapping:
    // 1=SynthA, 2=SynthB, 3=Kick, 4=Snare, 5=CH, 6=OH
    // 7-14 = Sampler Banks 0-7

    // Synth A
    const synthADuration = Math.max(SYNTH_RENDER_BASE_DURATION, (params.synthA.attack + params.synthA.decay) * SYNTH_RENDER_AD_MULTIPLIER);
    const bufA = await renderSynthToBuffer(params.synthA, 'C4', synthADuration, engines);
    const rawDataA = bufA.getChannelData(0);
    const normalizedDataA = normalizeBuffer(rawDataA);
    const loopPointsA = findSynthLoopPoints(normalizedDataA, bufA.sampleRate, params.synthA.attack + params.synthA.decay);

    // UPDATED: Calculate pitch for Synths too (handles 44.1k/48k correctly)
    const pitchA = calculateXMPitchParams(bufA.sampleRate);

    const sampleA = createSample({
        name: 'Lead',
        data: floatTo16BitPCM(normalizedDataA),
        volume: 64,
        loopType: loopPointsA.loopEnd > loopPointsA.loopStart ? LoopType.Forward : LoopType.None,
        loopStart: loopPointsA.loopStart,
        loopLength: loopPointsA.loopEnd > loopPointsA.loopStart ? loopPointsA.loopEnd - loopPointsA.loopStart : 0,
        relativeNoteNumber: pitchA.relativeNote,
        fineTune: pitchA.fineTune
    });
    const instA = createInstrument('Lead Synth');
    addSampleToInstrument(instA, sampleA);
    mod.instruments.push(instA);

    // Synth B
    const synthBDuration = Math.max(SYNTH_RENDER_BASE_DURATION, (params.synthB.attack + params.synthB.decay) * SYNTH_RENDER_AD_MULTIPLIER);
    const bufB = await renderSynthToBuffer(params.synthB, 'C4', synthBDuration, engines);
    const rawDataB = bufB.getChannelData(0);
    const normalizedDataB = normalizeBuffer(rawDataB);
    const loopPointsB = findSynthLoopPoints(normalizedDataB, bufB.sampleRate, params.synthB.attack + params.synthB.decay);
    
    // UPDATED: Calculate pitch for Synths
    const pitchB = calculateXMPitchParams(bufB.sampleRate);

    const sampleB = createSample({
        name: 'Bass',
        data: floatTo16BitPCM(normalizedDataB),
        volume: 64,
        loopType: loopPointsB.loopEnd > loopPointsB.loopStart ? LoopType.Forward : LoopType.None,
        loopStart: loopPointsB.loopStart,
        loopLength: loopPointsB.loopEnd > loopPointsB.loopStart ? loopPointsB.loopEnd - loopPointsB.loopStart : 0,
        relativeNoteNumber: pitchB.relativeNote,
        fineTune: pitchB.fineTune
    });
    const instB = createInstrument('Bass Synth');
    addSampleToInstrument(instB, sampleB);
    mod.instruments.push(instB);

    // Kick
    const bufKick = await renderDrumToBuffer('kick', params.kick, engines?.pyodide);
    const normalizedKick = normalizeBuffer(bufKick.getChannelData(0));
    const pitchKick = calculateXMPitchParams(bufKick.sampleRate);
    
    const sampleKick = createSample({
        name: 'Kick',
        data: floatTo16BitPCM(normalizedKick),
        volume: 64,
        relativeNoteNumber: pitchKick.relativeNote,
        fineTune: pitchKick.fineTune
    });
    const instKick = createInstrument('Kick');
    addSampleToInstrument(instKick, sampleKick);
    mod.instruments.push(instKick);

    // Snare
    const bufSnare = await renderDrumToBuffer('snare', params.snare, engines?.pyodide);
    const normalizedSnare = normalizeBuffer(bufSnare.getChannelData(0));
    const pitchSnare = calculateXMPitchParams(bufSnare.sampleRate);

    const sampleSnare = createSample({
        name: 'Snare',
        data: floatTo16BitPCM(normalizedSnare),
        volume: 64,
        relativeNoteNumber: pitchSnare.relativeNote,
        fineTune: pitchSnare.fineTune
    });
    const instSnare = createInstrument('Snare');
    addSampleToInstrument(instSnare, sampleSnare);
    mod.instruments.push(instSnare);

    // CH
    const bufCH = await renderDrumToBuffer('closedHat', params.closedHat, engines?.pyodide);
    const normalizedCH = normalizeBuffer(bufCH.getChannelData(0));
    const pitchCH = calculateXMPitchParams(bufCH.sampleRate);

    const sampleCH = createSample({
        name: 'Closed Hat',
        data: floatTo16BitPCM(normalizedCH),
        volume: 64,
        relativeNoteNumber: pitchCH.relativeNote,
        fineTune: pitchCH.fineTune
    });
    const instCH = createInstrument('Closed Hat');
    addSampleToInstrument(instCH, sampleCH);
    mod.instruments.push(instCH);

    // OH
    const bufOH = await renderDrumToBuffer('openHat', params.openHat, engines?.pyodide);
    const normalizedOH = normalizeBuffer(bufOH.getChannelData(0));
    const pitchOH = calculateXMPitchParams(bufOH.sampleRate);

    const sampleOH = createSample({
        name: 'Open Hat',
        data: floatTo16BitPCM(normalizedOH),
        volume: 64,
        relativeNoteNumber: pitchOH.relativeNote,
        fineTune: pitchOH.fineTune
    });
    const instOH = createInstrument('Open Hat');
    addSampleToInstrument(instOH, sampleOH);
    mod.instruments.push(instOH);

    // --- SAMPLER BANKS (Indices 7-14) ---
    for (let i = 0; i < 8; i++) {
        const instName = `Sampler Bank ${i+1}`;
        const inst = createInstrument(instName);

        // Check if we have a buffer for this bank
        if (sampleBuffers && sampleBuffers[i]) {
             const buffer = sampleBuffers[i]!;
             const pitchShift = Math.round(Math.log2(params.sampler[i].playbackSpeed) * 12);
             const rawData = buffer.getChannelData(0);
             const normalizedData = normalizeBuffer(rawData, -1);
             const enableLoop = buffer.duration > SAMPLER_LOOP_DURATION_THRESHOLD;
             const loopPoints = findSamplerLoopPoints(normalizedData, enableLoop, buffer.sampleRate);

             // UPDATED: Calculate pitch correction for the sample rate
             const { relativeNote, fineTune } = calculateXMPitchParams(buffer.sampleRate);

             const sample = createSample({
                name: params.sampler[i].sampleName || `Sample ${i}`,
                data: floatTo16BitPCM(normalizedData),
                volume: Math.min(64, Math.floor(params.sampler[i].volume * 64)),
                // Add pitchShift (from playback speed) to the base relativeNote (from sample rate)
                relativeNoteNumber: relativeNote + pitchShift,
                fineTune: fineTune,
                loopType: loopPoints.loopType,
                loopStart: loopPoints.loopStart,
                loopLength: loopPoints.loopEnd > loopPoints.loopStart ? loopPoints.loopEnd - loopPoints.loopStart : 0,
             });
             addSampleToInstrument(inst, sample);
        }
        mod.instruments.push(inst);
    }

    mod.header.numberOfInstruments = mod.instruments.length;

    let lastActiveMeasure = -1;
    for (let i = songStructure.length - 1; i >= 0; i--) {
        const measure = songStructure[i];
        if (Object.values(measure).some(slot => slot !== null)) {
            lastActiveMeasure = i;
            break;
        }
    }

    const useFallbackPattern = lastActiveMeasure === -1 && currentPattern;
    const activeLength = Math.max(1, lastActiveMeasure + 1);
    const patternOrderTable: number[] = [];

    const baseTrackMap: Record<TrackKey, { inst: number, chan: number }> = {
        'partA': { inst: 1, chan: 0 },
        'partB': { inst: 2, chan: 1 },
        'kick': { inst: 3, chan: 2 },
        'snare': { inst: 4, chan: 3 },
        'closedHat': { inst: 5, chan: 4 },
        'openHat': { inst: 6, chan: 5 },
        'sampler': { inst: 7, chan: 6 }
    };

    const fillPatternFromSequence = (xmPat: ReturnType<typeof createPattern>, sequence: PartSequence, trackKey: TrackKey, bankIdx: number = 0) => {
        let inst, chan;

        if (trackKey === 'sampler') {
            inst = 7 + bankIdx;   // Instruments 7-14
            chan = 6 + bankIdx;   // Channels 6-13
        } else {
            inst = baseTrackMap[trackKey].inst;
            chan = baseTrackMap[trackKey].chan;
        }

        sequence.steps.forEach((stepData, row) => {
            if (stepData && row < 32) {
                // Ensure we don't write outside channel bounds
                // Note: xmPat from createPattern doesn't expose numberOfChannels in type def,
                // but we know it matches what we requested (14).
                // Assuming 14 channels based on createPattern(32, 14) call.
                if (chan < 14) {
                    const note = xmPat.data[row][chan];

                    if (trackKey.startsWith('part') || trackKey === 'sampler') {
                        const nVal = noteNameToValue(stepData.note);
                        note.note = nVal;
                    } else {
                        note.note = 49; // C-4
                    }

                    note.instrument = inst;
                    note.volume = 64;
                }
            }
        });
    };

    if (useFallbackPattern) {
        const xmPat = createPattern(32, 14); // 14 Channels

        (Object.keys(baseTrackMap) as TrackKey[]).forEach(trackKey => {
            if (trackKey === 'sampler') {
                // Iterate all 8 banks
                currentPattern.sampler.forEach((seq, idx) => {
                    fillPatternFromSequence(xmPat, seq, 'sampler', idx);
                });
            } else {
                const sequence = currentPattern[trackKey] as PartSequence;
                if (sequence) {
                    fillPatternFromSequence(xmPat, sequence, trackKey);
                }
            }
        });

        mod.patterns.push(xmPat);
        patternOrderTable.push(0);
    } else {
        for (let m = 0; m < activeLength; m++) {
            const measure = songStructure[m];
            const xmPat = createPattern(32, 14);

            (Object.keys(baseTrackMap) as TrackKey[]).forEach(trackKey => {
                const slotIndex = measure[trackKey];
                if (slotIndex === null) return;

                const storedData = trackStorage[trackKey][slotIndex];
                if (!storedData) return;

                if (trackKey === 'sampler') {
                    // storedData is PartSequence[]
                    const sequences = storedData as PartSequence[];
                    sequences.forEach((seq, idx) => {
                        fillPatternFromSequence(xmPat, seq, 'sampler', idx);
                    });
                } else {
                    // storedData is PartSequence
                    fillPatternFromSequence(xmPat, storedData as PartSequence, trackKey);
                }
            });

            mod.patterns.push(xmPat);
            patternOrderTable.push(m);
        }
    }

    mod.header.numberOfPatterns = mod.patterns.length;
    mod.header.songLength = patternOrderTable.length;
    for (let i = 0; i < patternOrderTable.length; i++) {
        mod.header.patternOrderTable[i] = patternOrderTable[i];
    }

    const writer = new XMWriter();
    const buffer = writer.write(mod);
    const blob = new Blob([buffer], { type: 'audio/xm' });
    downloadBlob(blob, 'song.xm');
};
