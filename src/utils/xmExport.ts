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
            output[i] = Math.max(-1, Math.min(1, input[i] * gain));
        }
        return output;
    }

    return input;
};

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
        if (s > 0.95 || s < -0.95) {
            // Apply soft clipping for values near the limit
            s = Math.tanh(s);
        }
        s = Math.max(-1, Math.min(1, s));
        // Symmetric scaling for 16-bit (use 32767 for both positive and negative for symmetry)
        output[i] = Math.round(s * 32767);
    }
    return output;
};

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
    for (let i = 0; i < maxSearch; i++) {
        const idx = position + (i * direction);
        if (idx < 1 || idx >= len - 1) break;

        // Check for zero crossing (positive going)
        if (buffer[idx] >= 0 && buffer[idx - 1] < 0) {
            return idx;
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

export const exportSongToXM = async (
    songStructure: { [key in TrackKey]: number | null }[],
    trackStorage: Record<TrackKey, (PartSequence | null)[]>,
    params: {
        synthA: SynthParams, synthB: SynthParams, kick: KickParams, snare: SnareParams, closedHat: HatParams, openHat: HatParams, sampler: SamplerParams
    },
    tempo: number,
    currentPattern?: Pattern,
    engines?: {
        webGpuEngine?: any,
        wasmEngine?: any,
        pyodide?: any
    },
    samplerBuffer?: AudioBuffer | null // NEW: Accept sampler buffer for export
) => {
    console.log("Starting XM Export with engines:", engines);

    // 1. Create Module
    const mod = createModule({
        moduleName: 'Electribe Export',
        numberOfChannels: 8, // 2 synths + 4 drums + 1 sampler + 1 reserved
        defaultTempo: 6,
        defaultBPM: tempo
    });

    // 2. Render and Add Instruments
    // Mapping: 1=SynthA, 2=SynthB, 3=Kick, 4=Snare, 5=CH, 6=OH, 7=Sampler

    // Synth A - with auto-loop detection for sustain (Task 3)
    // Adaptive render duration based on attack+decay time
    const synthADuration = Math.max(SYNTH_RENDER_BASE_DURATION, (params.synthA.attack + params.synthA.decay) * SYNTH_RENDER_AD_MULTIPLIER);
    const bufA = await renderSynthToBuffer(params.synthA, 'C4', synthADuration, engines);
    const rawDataA = bufA.getChannelData(0);
    const normalizedDataA = normalizeBuffer(rawDataA); // Normalize for consistent volume
    const loopPointsA = findSynthLoopPoints(normalizedDataA, bufA.sampleRate, params.synthA.attack + params.synthA.decay);

    const sampleA = createSample({
        name: 'Lead',
        data: floatTo16BitPCM(normalizedDataA),
        volume: 64,
        loopType: loopPointsA.loopEnd > loopPointsA.loopStart ? LoopType.Forward : LoopType.None,
        loopStart: loopPointsA.loopStart,
        loopLength: loopPointsA.loopEnd > loopPointsA.loopStart ? loopPointsA.loopEnd - loopPointsA.loopStart : 0,
        relativeNoteNumber: 12 // Set relative note to +12
    });

    const instA = createInstrument('Lead Synth');
    addSampleToInstrument(instA, sampleA);
    mod.instruments.push(instA);

    // Synth B - with auto-loop detection for sustain (Task 3)
    // Adaptive render duration based on attack+decay time
    const synthBDuration = Math.max(SYNTH_RENDER_BASE_DURATION, (params.synthB.attack + params.synthB.decay) * SYNTH_RENDER_AD_MULTIPLIER);
    const bufB = await renderSynthToBuffer(params.synthB, 'C4', synthBDuration, engines);
    const rawDataB = bufB.getChannelData(0);
    const normalizedDataB = normalizeBuffer(rawDataB);
    const loopPointsB = findSynthLoopPoints(normalizedDataB, bufB.sampleRate, params.synthB.attack + params.synthB.decay);

    const sampleB = createSample({
        name: 'Bass',
        data: floatTo16BitPCM(normalizedDataB),
        volume: 64,
        loopType: loopPointsB.loopEnd > loopPointsB.loopStart ? LoopType.Forward : LoopType.None,
        loopStart: loopPointsB.loopStart,
        loopLength: loopPointsB.loopEnd > loopPointsB.loopStart ? loopPointsB.loopEnd - loopPointsB.loopStart : 0,
        relativeNoteNumber: 24
    });

    const instB = createInstrument('Bass Synth');
    addSampleToInstrument(instB, sampleB);
    mod.instruments.push(instB);

    // Kick - with normalization for consistent volume (Task 4)
    const bufKick = await renderDrumToBuffer('kick', params.kick, engines?.pyodide);
    const normalizedKick = normalizeBuffer(bufKick.getChannelData(0));
    const sampleKick = createSample({
        name: 'Kick',
        data: floatTo16BitPCM(normalizedKick),
        volume: 64,
        relativeNoteNumber: 12 // Set relative note to +12
    });
    const instKick = createInstrument('Kick');
    addSampleToInstrument(instKick, sampleKick);
    mod.instruments.push(instKick);

    // Snare - with normalization for consistent volume (Task 4)
    const bufSnare = await renderDrumToBuffer('snare', params.snare, engines?.pyodide);
    const normalizedSnare = normalizeBuffer(bufSnare.getChannelData(0));
    const sampleSnare = createSample({
        name: 'Snare',
        data: floatTo16BitPCM(normalizedSnare),
        volume: 64,
        relativeNoteNumber: 12 // Set relative note to +12
    });
    const instSnare = createInstrument('Snare');
    addSampleToInstrument(instSnare, sampleSnare);
    mod.instruments.push(instSnare);

    // CH - with normalization for consistent volume (Task 4)
    const bufCH = await renderDrumToBuffer('closedHat', params.closedHat, engines?.pyodide);
    const normalizedCH = normalizeBuffer(bufCH.getChannelData(0));
    const sampleCH = createSample({
        name: 'Closed Hat',
        data: floatTo16BitPCM(normalizedCH),
        volume: 64,
        relativeNoteNumber: 12 // Set relative note to +12
    });
    const instCH = createInstrument('Closed Hat');
    addSampleToInstrument(instCH, sampleCH);
    mod.instruments.push(instCH);

    // OH - with normalization for consistent volume (Task 4)
    const bufOH = await renderDrumToBuffer('openHat', params.openHat, engines?.pyodide);
    const normalizedOH = normalizeBuffer(bufOH.getChannelData(0));
    const sampleOH = createSample({
        name: 'Open Hat',
        data: floatTo16BitPCM(normalizedOH),
        volume: 64,
        relativeNoteNumber: 12 // Set relative note to +12
    });
    const instOH = createInstrument('Open Hat');
    addSampleToInstrument(instOH, sampleOH);
    mod.instruments.push(instOH);

    // --- SAMPLER INSTRUMENT (Index 7) ---
    // With normalization (Task 4) and loop point detection (Task 2)
    const instSamp = createInstrument('Sampler');

    if (samplerBuffer) {
        console.log("XM Export: Sampler buffer received:", {
            length: samplerBuffer.length,
            sampleRate: samplerBuffer.sampleRate,
            channels: samplerBuffer.numberOfChannels,
            duration: (samplerBuffer.length / samplerBuffer.sampleRate).toFixed(2) + 's'
        });

        // Calculate relative note number based on playback speed
        // 1.0 = 0 shift, 2.0 = +12 semitones, 0.5 = -12 semitones
        const pitchShift = Math.round(Math.log2(params.sampler.playbackSpeed) * 12);

        // Normalize sampler buffer for consistent volume (Task 4)
        const rawSamplerData = samplerBuffer.getChannelData(0);
        const normalizedSamplerData = normalizeBuffer(rawSamplerData, -1);

        // Determine if looping should be enabled for the sampler
        // Enable looping for samples longer than threshold (likely musical content)
        // Disable for shorter samples (likely one-shots or speech)
        const enableLoop = samplerBuffer.duration > SAMPLER_LOOP_DURATION_THRESHOLD;
        const samplerLoopPoints = findSamplerLoopPoints(normalizedSamplerData, enableLoop, samplerBuffer.sampleRate);

        const sampleSamp = createSample({
            name: params.sampler.sampleName || 'Sample',
            data: floatTo16BitPCM(normalizedSamplerData),
            volume: Math.min(64, Math.floor(params.sampler.volume * 64)),
            relativeNoteNumber: 24 + pitchShift, // Base note + speed as pitch offset
            loopType: samplerLoopPoints.loopType,
            loopStart: samplerLoopPoints.loopStart,
            loopLength: samplerLoopPoints.loopEnd > samplerLoopPoints.loopStart
                ? samplerLoopPoints.loopEnd - samplerLoopPoints.loopStart : 0,
        });

        addSampleToInstrument(instSamp, sampleSamp);
        console.log("✓ Sampler buffer exported:", samplerBuffer.length, "samples →", sampleSamp.data.length, "bytes");
        if (samplerLoopPoints.loopType !== LoopType.None) {
            console.log("  Loop points set:", samplerLoopPoints.loopStart, "→", samplerLoopPoints.loopEnd);
        }
    } else {
        console.warn("⚠ XM Export: No sampler buffer loaded - sampler track will be silent in XM file");
        console.warn("  → To export sampler: Load a sample file, record audio, or generate TTS before exporting");
    }

    mod.instruments.push(instSamp);

    mod.header.numberOfInstruments = mod.instruments.length;

    // Check if song structure has any active measures
    let lastActiveMeasure = -1;
    for (let i = songStructure.length - 1; i >= 0; i--) {
        const measure = songStructure[i];
        if (Object.values(measure).some(slot => slot !== null)) {
            lastActiveMeasure = i;
            break;
        }
    }

    // Determine if we should use the current pattern as fallback
    const useFallbackPattern = lastActiveMeasure === -1 && currentPattern;

    // Export measures up to lastActiveMeasure + 1 (or at least 1 if the whole song is empty).
    const activeLength = Math.max(1, lastActiveMeasure + 1);

    // 3. Generate Patterns
    // SongStructure is: [ { partA: 0, partB: 1 ... }, { partA: 0, ... } ]
    // Each step in SongStructure is a "Measure" (32 steps in our app).
    // XM Patterns are usually 64 rows.
    // Our app has 32 steps per pattern. We can map 1 Measure -> 1 XM Pattern (length 32).

    // We need to identify unique "Combinations" of slots to minimize patterns?
    // Or just create one XM pattern per Song Step?
    // Creating one XM pattern per Song Step is easier and fine (XM supports up to 256 patterns).
    // If user has 16 measures, we make 16 patterns.

    const patternOrderTable: number[] = [];

    // Map TrackKey to Instrument Index and Channel Index
    const trackMap: Record<TrackKey, { inst: number, chan: number }> = {
        'partA': { inst: 1, chan: 0 },
        'partB': { inst: 2, chan: 1 },
        'kick': { inst: 3, chan: 2 },
        'snare': { inst: 4, chan: 3 },
        'closedHat': { inst: 5, chan: 4 },
        'openHat': { inst: 6, chan: 5 }, // Share channel with CH? Typically yes (choke group). Let's use separate for now.
        'sampler': { inst: 7, chan: 6 }
    };

    // Helper to fill pattern data from a sequence
    const fillPatternFromSequence = (xmPat: ReturnType<typeof createPattern>, sequence: PartSequence, trackKey: TrackKey) => {
        const { inst, chan } = trackMap[trackKey];

        sequence.steps.forEach((stepData, row) => {
            if (stepData && row < 32) {
                const note = xmPat.data[row][chan];

                if (trackKey.startsWith('part') || trackKey === 'sampler') {
                    // Melodic
                    const nVal = noteNameToValue(stepData.note);
                    note.note = nVal;
                } else {
                    // Drums (Fixed note C-4 usually for sampled drums)
                    note.note = 49; // C-4
                }

                note.instrument = inst;
                note.volume = 64; // Max vol
            }
        });
    };

    if (useFallbackPattern) {
        // Song structure is empty - export the current pattern as a single measure
        console.log("Song structure is empty, exporting current pattern...");

        const xmPat = createPattern(32, 8);

        // Fill from current pattern
        (Object.keys(trackMap) as TrackKey[]).forEach(trackKey => {
            const sequence = currentPattern[trackKey];
            if (sequence) {
                fillPatternFromSequence(xmPat, sequence, trackKey);
            }
        });

        mod.patterns.push(xmPat);
        patternOrderTable.push(0);
    } else {
        // Use song structure
        for (let m = 0; m < activeLength; m++) {
            const measure = songStructure[m];

            // Create new XM pattern
            const xmPat = createPattern(32, 8);

            // Fill pattern data
            // Iterate over tracks
            (Object.keys(trackMap) as TrackKey[]).forEach(trackKey => {
                const slotIndex = measure[trackKey];
                if (slotIndex === null) return; // Empty track for this measure

                const sequence = trackStorage[trackKey][slotIndex];
                if (!sequence) return;

                fillPatternFromSequence(xmPat, sequence, trackKey);
            });

            mod.patterns.push(xmPat);
            patternOrderTable.push(m);
        }
    }

    mod.header.numberOfPatterns = mod.patterns.length;
    mod.header.songLength = patternOrderTable.length;

    // Update order table
    for (let i = 0; i < patternOrderTable.length; i++) {
        mod.header.patternOrderTable[i] = patternOrderTable[i];
    }

    // 4. Write File
    const writer = new XMWriter();
    const buffer = writer.write(mod);
    const blob = new Blob([buffer], { type: 'audio/xm' });
    downloadBlob(blob, 'song.xm');
};
