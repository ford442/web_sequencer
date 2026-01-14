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

// @perf-optimized: extracted for reuse to avoid redundant iterations
/**
 * Find the peak amplitude in a buffer.
 * @param input Float32Array audio buffer
 * @returns peak amplitude (0 to 1+)
 */
const getPeak = (input: Float32Array): number => {
    let peak = 0;
    const len = input.length;
    // Unrolling loop slightly for potential speedup in some engines, or just keep simple.
    // Simple is fine for JIT.
    for (let i = 0; i < len; i++) {
        const abs = Math.abs(input[i]);
        if (abs > peak) peak = abs;
    }
    return peak;
};

/**
 * Normalize an audio buffer to a target peak level (default -1dB).
 * This addresses Task 4: Fix low sampler volume.
 * @param input Float32Array audio buffer
 * @param targetPeakDb Target peak in dB (default -1)
 * @param canMutate Whether the input buffer can be modified in-place (default false)
 * @returns Normalized Float32Array
 */

/*
const normalizeBuffer = (input: Float32Array, targetPeakDb: number = -1, canMutate: boolean = false): Float32Array => {
    // Find peak amplitude
    const peak = getPeak(input);

    // If peak is already near target or buffer is silent, return as-is
    if (peak < 0.001) return input;

    // Calculate target peak (linear)
    const targetPeak = Math.pow(10, targetPeakDb / 20);

    // Only normalize if peak is below threshold
    if (peak < NORMALIZATION_PEAK_THRESHOLD) {
        const gain = targetPeak / peak;
        const output = canMutate ? input : new Float32Array(input.length);
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
*/

// @migrate-target: assemblyscript
// @perf-optimized: Replaced broken/slow tanh soft-clip with fast hard-clip and optimized float->int conversion
/**
 * Convert float32 buffer to int16.
 * Uses hard-clipping for performance and linear consistency.
 * Previous implementation used Math.tanh > 0.95 which introduced a severe discontinuity (0.95 -> 0.74).
 * @param input Float32Array audio buffer
 * @returns Int16Array for XM sample
 */
export const floatTo16BitPCM = (input: Float32Array): Int16Array => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        let s = input[i];

        // Fast Hard Clip
        // Since input is likely normalized, this only catches rare peaks.
        if (s > 1.0) s = 1.0;
        else if (s < -1.0) s = -1.0;

        // Optimized conversion (truncation via bitwise OR is faster than Math.round)
        // 0.5 added for rounding behavior (s * 32767 + 0.5) | 0
        // But for pure speed and 16-bit, truncation is acceptable.
        // We use direct multiplication and casting which is very fast in JS engines.
        output[i] = (s * 32767) | 0;
    }
    return output;
};

// @perf-optimized: Combines normalization and int16 conversion to avoid intermediate buffer allocation
/**
 * Normalize and convert float32 buffer to int16 in a single pass (after peak finding).
 * Reduces memory allocation by skipping the intermediate Float32Array.
 * @param input Float32Array audio buffer
 * @param targetPeakDb Target peak in dB (default -1)
 * @param knownPeak Optional pre-calculated peak to skip iteration
 * @returns Int16Array for XM sample
 */
const normalizeAndConvertTo16Bit = (input: Float32Array, targetPeakDb: number = -1, knownPeak?: number): Int16Array => {
    // 1. Find Peak (if not provided)
    const peak = (knownPeak !== undefined) ? knownPeak : getPeak(input);

    const output = new Int16Array(input.length);
    let gain = 1.0;

    // Calculate gain if normalization is needed
    if (peak >= 0.001 && peak < NORMALIZATION_PEAK_THRESHOLD) {
        const targetPeak = Math.pow(10, targetPeakDb / 20);
        gain = targetPeak / peak;
    }

    // 2. Convert with Gain
    for (let i = 0; i < input.length; i++) {
        let s = input[i] * gain;

        // Fast Hard Clip
        if (s > 1.0) s = 1.0;
        else if (s < -1.0) s = -1.0;

        // Optimized conversion
        output[i] = (s * 32767) | 0;
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
 * Improved robustness to ensure loops are found even for complex or short waveforms.
 * @param buffer Audio buffer (can be un-normalized if peakAmplitude is provided)
 * @param sampleRate Sample rate
 * @param attackDecayTime Estimated attack+decay time in seconds
 * @param peakAmplitude Peak amplitude of the buffer (default 1.0) to scale thresholds
 * @returns Object with loopStart and loopEnd in samples
 */
const findSynthLoopPoints = (buffer: Float32Array, sampleRate: number = 44100, attackDecayTime: number = 0.3, peakAmplitude: number = 1.0): { loopStart: number, loopEnd: number } => {
    const len = buffer.length;

    // Adjust threshold based on peak amplitude if it would have been normalized
    // Target normalized peak is approx 0.89 (-1dB)
    // If peak is small (e.g. 0.1), effective threshold should be smaller relative to signal
    // Formula: 0.2 * (peak / 0.89) if peak < 0.5, else 0.2
    let threshold = 0.2;
    if (peakAmplitude < NORMALIZATION_PEAK_THRESHOLD && peakAmplitude > 0.001) {
         threshold = 0.2 * (peakAmplitude / 0.891);
    }

    // 1. Define Search Region (Steady State)
    // Be less aggressive with skipping if buffer is short.
    // Ensure we at least have 200ms or 50% of buffer.
    let steadyStateStart = Math.min(Math.floor(attackDecayTime * sampleRate), Math.floor(len * 0.4));
    let steadyStateEnd = Math.floor(len * 0.95); // Use up to 95%

    // Minimum loop: 20ms is enough for a cycle (50Hz)
    const minLoopLength = Math.floor(sampleRate * 0.02);

    // Fallback for short buffers: Use 25% to 75% of buffer
    if (steadyStateEnd - steadyStateStart < minLoopLength * 2) {
        steadyStateStart = Math.floor(len * 0.25);
        steadyStateEnd = Math.floor(len * 0.75);
    }

    if (steadyStateEnd - steadyStateStart < minLoopLength) {
         return { loopStart: 0, loopEnd: 0 };
    }

    // 2. Find Loop Start (Zero Crossing)
    // Scan a reasonable window (e.g. 200ms) around steadyStateStart
    const searchWindow = Math.floor(sampleRate * 0.2);

    // Helper to find crossing with specific direction
    const findCross = (start: number, end: number, step: number): number => {
        if (step > 0) {
            for (let i = start; i < end; i += step) {
                if (i < 1 || i >= len - 1) continue;
                if (buffer[i] >= 0 && buffer[i - 1] < 0) return i;
            }
        } else {
            for (let i = start; i > end; i += step) {
                if (i < 1 || i >= len - 1) continue;
                if (buffer[i] >= 0 && buffer[i - 1] < 0) return i;
            }
        }
        return -1;
    };

    let loopStart = findCross(steadyStateStart, Math.min(steadyStateStart + searchWindow, len-1), 1);

    if (loopStart === -1) {
        // Fallback: Just pick the start of the region
        loopStart = steadyStateStart;
    }

    // 3. Find Loop End (Matching Start)
    // We want a point where value is close to buffer[loopStart] and slope is similar.
    // Ideally, another zero crossing if loopStart was one.

    // Search backwards from steadyStateEnd
    let loopEnd = -1;

    // Search for zero crossing near end
    const endSearchLimit = Math.max(loopStart + minLoopLength, steadyStateEnd - searchWindow);
    loopEnd = findCross(steadyStateEnd, endSearchLimit, -1);

    if (loopEnd === -1) {
        // If no zero crossing at end, search for value match
        const targetVal = buffer[loopStart];
        const targetSlope = buffer[loopStart] - buffer[loopStart-1] || 1; // avoid 0

        let bestErr = Infinity;
        let bestIdx = -1;

        // Scan last 30% of valid region
        const scanStart = Math.max(loopStart + minLoopLength, Math.floor(len * 0.6));
        for(let i = steadyStateEnd; i > scanStart; i--) {
            const val = buffer[i];
            const slope = buffer[i] - buffer[i-1];
            // Check slope direction matches (roughly)
            if (Math.sign(slope) === Math.sign(targetSlope)) {
                const err = Math.abs(val - targetVal);
                if (err < bestErr) {
                    bestErr = err;
                    bestIdx = i;
                }
            }
        }

        // Only accept if error is reasonably small
        if (bestIdx !== -1 && bestErr < threshold) {
            loopEnd = bestIdx;
        }
    }

    // Validation
    if (loopEnd !== -1 && loopEnd > loopStart + minLoopLength) {
        return { loopStart, loopEnd };
    }

    // Ultimate Fallback: just loop steady state region if we have space
    // This might click, but it's better than silence for a synth pad
    if (steadyStateEnd > steadyStateStart + minLoopLength) {
        return { loopStart: steadyStateStart, loopEnd: steadyStateEnd };
    }

    return { loopStart: 0, loopEnd: 0 };
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

    // OPTIMIZED: Combined normalization and loop finding
    // 1. Find Peak (once)
    const peakA = getPeak(rawDataA);
    // 2. Find Loop Points (using scaled threshold on raw data)
    const loopPointsA = findSynthLoopPoints(rawDataA, bufA.sampleRate, params.synthA.attack + params.synthA.decay, peakA);
    // 3. Normalize & Convert (passing known peak to skip re-scan)
    const dataA = normalizeAndConvertTo16Bit(rawDataA, -1, peakA);

    // UPDATED: Calculate pitch for Synths too (handles 44.1k/48k correctly)
    const pitchA = calculateXMPitchParams(bufA.sampleRate);

    const sampleA = createSample({
        name: 'Lead',
        data: dataA,
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

    // OPTIMIZED: Combined normalization and loop finding
    const peakB = getPeak(rawDataB);
    const loopPointsB = findSynthLoopPoints(rawDataB, bufB.sampleRate, params.synthB.attack + params.synthB.decay, peakB);
    const dataB = normalizeAndConvertTo16Bit(rawDataB, -1, peakB);
    
    // UPDATED: Calculate pitch for Synths
    const pitchB = calculateXMPitchParams(bufB.sampleRate);

    const sampleB = createSample({
        name: 'Bass',
        data: dataB,
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
    const pitchKick = calculateXMPitchParams(bufKick.sampleRate);
    // OPTIMIZED: Combined normalization and conversion (No loop points needed)
    const dataKick = normalizeAndConvertTo16Bit(bufKick.getChannelData(0));
    
    const sampleKick = createSample({
        name: 'Kick',
        data: dataKick,
        volume: 64,
        relativeNoteNumber: pitchKick.relativeNote,
        fineTune: pitchKick.fineTune
    });
    const instKick = createInstrument('Kick');
    addSampleToInstrument(instKick, sampleKick);
    mod.instruments.push(instKick);

    // Snare
    const bufSnare = await renderDrumToBuffer('snare', params.snare, engines?.pyodide);
    const pitchSnare = calculateXMPitchParams(bufSnare.sampleRate);
    // OPTIMIZED: Combined normalization and conversion
    const dataSnare = normalizeAndConvertTo16Bit(bufSnare.getChannelData(0));

    const sampleSnare = createSample({
        name: 'Snare',
        data: dataSnare,
        volume: 64,
        relativeNoteNumber: pitchSnare.relativeNote,
        fineTune: pitchSnare.fineTune
    });
    const instSnare = createInstrument('Snare');
    addSampleToInstrument(instSnare, sampleSnare);
    mod.instruments.push(instSnare);

    // CH
    const bufCH = await renderDrumToBuffer('closedHat', params.closedHat, engines?.pyodide);
    const pitchCH = calculateXMPitchParams(bufCH.sampleRate);
    // OPTIMIZED: Combined normalization and conversion
    const dataCH = normalizeAndConvertTo16Bit(bufCH.getChannelData(0));

    const sampleCH = createSample({
        name: 'Closed Hat',
        data: dataCH,
        volume: 64,
        relativeNoteNumber: pitchCH.relativeNote,
        fineTune: pitchCH.fineTune
    });
    const instCH = createInstrument('Closed Hat');
    addSampleToInstrument(instCH, sampleCH);
    mod.instruments.push(instCH);

    // OH
    const bufOH = await renderDrumToBuffer('openHat', params.openHat, engines?.pyodide);
    const pitchOH = calculateXMPitchParams(bufOH.sampleRate);
    // OPTIMIZED: Combined normalization and conversion
    const dataOH = normalizeAndConvertTo16Bit(bufOH.getChannelData(0));

    const sampleOH = createSample({
        name: 'Open Hat',
        data: dataOH,
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

             // Loop points on RAW data (Scale Invariant)
             const enableLoop = buffer.duration > SAMPLER_LOOP_DURATION_THRESHOLD;
             const loopPoints = findSamplerLoopPoints(rawData, enableLoop, buffer.sampleRate);

             // OPTIMIZED: Combined normalization and conversion
             // Keeps rawData pristine (Sampler buffers are shared)
             const data16 = normalizeAndConvertTo16Bit(rawData, -1);

             // UPDATED: Calculate pitch correction for the sample rate
             const { relativeNote, fineTune } = calculateXMPitchParams(buffer.sampleRate);

             const sample = createSample({
                name: params.sampler[i].sampleName || `Sample ${i}`,
                data: data16,
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
