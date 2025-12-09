import {
    createModule, createPattern, createInstrument, createSample, addSampleToInstrument,
    XMWriter, noteNameToValue
} from './xm_save_lib/index';
import type { PartSequence, Pattern, SynthParams, KickParams, SnareParams, HatParams, SamplerParams } from '../types';
import { renderSynthToBuffer, renderDrumToBuffer } from './renderAudio';

type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

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

// Helper to convert float32 buffer to int16
const floatTo16BitPCM = (input: Float32Array): Int16Array => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
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

    // Synth A
    const bufA = await renderSynthToBuffer(params.synthA, 'C4', 1.0, engines);
    const sampleA = createSample({
        name: 'Lead',
        data: floatTo16BitPCM(bufA.getChannelData(0)),
        volume: 64,
        loopType: 1, // Forward loop
        loopStart: 20000, // Approximate loop point near end? Or just One Shot?
        loopLength: bufA.length - 20000,
        relativeNoteNumber: 24 // FIX: Set relative note to +12
    });
    // Fix loop for simple synth: just loop the whole thing if it's long?
    // Actually, for XM synth samples, usually you want a short loop.
    // Let's just disable loop for now to be safe, treat as one-shot.
    sampleA.header.type = 0x10; // 16-bit, no loop

    const instA = createInstrument('Lead Synth');
    addSampleToInstrument(instA, sampleA);
    mod.instruments.push(instA);

    // Synth B
    const bufB = await renderSynthToBuffer(params.synthB, 'C4', 1.0, engines);
    const sampleB = createSample({
        name: 'Bass',
        data: floatTo16BitPCM(bufB.getChannelData(0)),
        volume: 64,
        relativeNoteNumber: 24
    });
    sampleB.header.type = 0x10;
    const instB = createInstrument('Bass Synth');
    addSampleToInstrument(instB, sampleB);
    mod.instruments.push(instB);

    // Kick
    const bufKick = await renderDrumToBuffer('kick', params.kick, engines?.pyodide);
    const sampleKick = createSample({
        name: 'Kick',
        data: floatTo16BitPCM(bufKick.getChannelData(0)),
        volume: 64,
        relativeNoteNumber: 24 // FIX: Set relative note to +12
    });
    sampleKick.header.type = 0x10;
    const instKick = createInstrument('Kick');
    addSampleToInstrument(instKick, sampleKick);
    mod.instruments.push(instKick);

    // Snare
    const bufSnare = await renderDrumToBuffer('snare', params.snare, engines?.pyodide);
    const sampleSnare = createSample({
        name: 'Snare',
        data: floatTo16BitPCM(bufSnare.getChannelData(0)),
        volume: 64,
        relativeNoteNumber: 24 // FIX: Set relative note to +12
    });
    sampleSnare.header.type = 0x10;
    const instSnare = createInstrument('Snare');
    addSampleToInstrument(instSnare, sampleSnare);
    mod.instruments.push(instSnare);

    // CH
    const bufCH = await renderDrumToBuffer('closedHat', params.closedHat, engines?.pyodide);
    const sampleCH = createSample({
        name: 'Closed Hat',
        data: floatTo16BitPCM(bufCH.getChannelData(0)),
        volume: 64,
        relativeNoteNumber: 24 // FIX: Set relative note to +12
    });
    sampleCH.header.type = 0x10;
    const instCH = createInstrument('Closed Hat');
    addSampleToInstrument(instCH, sampleCH);
    mod.instruments.push(instCH);

    // OH
    const bufOH = await renderDrumToBuffer('openHat', params.openHat, engines?.pyodide);
    const sampleOH = createSample({
        name: 'Open Hat',
        data: floatTo16BitPCM(bufOH.getChannelData(0)),
        volume: 64,
        relativeNoteNumber: 24 // FIX: Set relative note to +12
    });
    sampleOH.header.type = 0x10;
    const instOH = createInstrument('Open Hat');
    addSampleToInstrument(instOH, sampleOH);
    mod.instruments.push(instOH);

    // --- SAMPLER INSTRUMENT (Index 7) ---
    const instSamp = createInstrument('Sampler');

    if (samplerBuffer) {
        // Calculate relative note number based on playback speed
        // 1.0 = 0 shift, 2.0 = +12 semitones, 0.5 = -12 semitones
        const pitchShift = Math.round(Math.log2(params.sampler.playbackSpeed) * 12);

        const sampleSamp = createSample({
            name: params.sampler.sampleName || 'Sample',
            data: floatTo16BitPCM(samplerBuffer.getChannelData(0)),
            volume: Math.min(64, Math.floor(params.sampler.volume * 64)),
            relativeNoteNumber: 24 + pitchShift, // Base note + speed as pitch offset
            loopType: 0, // One-shot (no loop) - best for TTS/Speech
        });

        // 16-bit flag
        sampleSamp.header.type = 0x10;

        addSampleToInstrument(instSamp, sampleSamp);
        console.log("Sampler buffer exported:", samplerBuffer.length, "samples");
    } else {
        console.log("No sampler buffer available for export");
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
