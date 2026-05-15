// @mode: typescript
// @note-for-ai: This worker runs in a separate thread for background audio rendering.
// It duplicates types because workers have isolated scope.
// Consider: If this becomes a bottleneck, the playSynthForRender function
// could be migrated to use a shared WASM module loaded in the worker.
// Currently, OfflineAudioContext provides sufficient performance.

// A self-contained worker for rendering audio in the background.
// It duplicates some types and functions because it runs in a separate scope.

type Waveform = 'sawtooth' | 'square' | 'triangle' | 'sine';

interface SynthParams {
    waveform: Waveform;
    pitch: number;
    filterCutoff: number;
    filterResonance: number;
    attack: number;
    decay: number;
    sustain: number;  // 0-1 level
    release: number;  // seconds
    length: number;   // gate time in seconds
    volume: number;
    delayTime: number;
    delayFeedback: number;
    delayMix: number;
}

interface Note {
    note: string;
    velocity: number;
}

interface PartSequence {
    steps: (Note | null)[];
}

const noteFrequencies: { [key: string]: number } = {
    'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78, 'E2': 82.41, 'F2': 87.31, 'F#2': 92.50, 'G2': 98.00, 'G#2': 103.83, 'A2': 110.00, 'A#2': 116.54, 'B2': 123.47,
    'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
    'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
    'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77,
};


const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteToMidi = (note: string): number => {
    if (!note) return 0;
    const match = note.match(/([A-G]#?)(\d+)/);
    if (!match) return 0;
    return (parseInt(match[2], 10) + 1) * 12 + NOTES.indexOf(match[1]);
};
const getTunedFrequency = (note: string, tuning: string = '12-TET', rootNote: string = 'C'): number => {
    if (!note) return 0;
    const midi = noteToMidi(note);
    if (tuning === '12-TET') return 440 * Math.pow(2, (midi - 69) / 12);
    if (tuning === '24-TET') return 440 * Math.pow(2, (midi - 69) / 24);
    const rootMidi = noteToMidi(rootNote.replace(/\d+$/, '') + '4');
    const rootFreq = 440 * Math.pow(2, (rootMidi - 69) / 12);
    const distance = midi - rootMidi;
    if (tuning === 'Bohlen-Pierce') return rootFreq * Math.pow(3, distance / 13);
    const octave = Math.floor(distance / 12);
    const semitone = ((distance % 12) + 12) % 12;
    if (tuning === 'Just Intonation') return rootFreq * [1/1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 9/5, 15/8][semitone] * Math.pow(2, octave);
    if (tuning === 'Pythagorean') return rootFreq * [1/1, 256/243, 9/8, 32/27, 81/64, 4/3, 729/512, 3/2, 128/81, 27/16, 16/9, 243/128][semitone] * Math.pow(2, octave);
    return 440 * Math.pow(2, (midi - 69) / 12);
};
const playSynthForRender = (context: OfflineAudioContext, params: SynthParams, note: string, time: number, tuningSystem?: string, rootNote?: string) => {
    const destination = context.destination;
    const baseFreq = getTunedFrequency(note, tuningSystem, rootNote);
    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);

    // ADSR timing - use length as gate time, fallback to attack+decay if not set
    const gateTime = params.length || (params.attack + params.decay + 0.1);
    const totalDuration = gateTime + params.release;

    const osc = context.createOscillator();
    osc.type = params.waveform;
    osc.frequency.setValueAtTime(freqWithPitch, time);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(params.filterCutoff, time);
    filter.Q.setValueAtTime(params.filterResonance, time);

    // --- PROPER ADSR ENVELOPE ---
    const gain = context.createGain();
    const sustainLevel = params.volume * (params.sustain ?? 0.5);

    // Attack: 0 → volume
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(params.volume, time + params.attack);

    // Decay: volume → sustain level
    gain.gain.linearRampToValueAtTime(sustainLevel, time + params.attack + params.decay);

    // Sustain: hold at sustain level until gate ends
    gain.gain.setValueAtTime(sustainLevel, time + gateTime);

    // Release: sustain → 0
    gain.gain.linearRampToValueAtTime(0, time + gateTime + params.release);

    osc.connect(filter);
    filter.connect(gain);

    if (params.delayMix > 0 && params.delayTime > 0) {
        const dryGain = context.createGain();
        const wetGain = context.createGain();
        const delay = context.createDelay(1.0);
        const feedback = context.createGain();

        dryGain.gain.setValueAtTime(1.0 - params.delayMix, time);
        wetGain.gain.setValueAtTime(params.delayMix, time);
        delay.delayTime.setValueAtTime(params.delayTime, time);
        feedback.gain.setValueAtTime(params.delayFeedback, time);

        gain.connect(dryGain);
        dryGain.connect(destination);

        gain.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wetGain);
        wetGain.connect(destination);
    } else {
        gain.connect(destination);
    }

    osc.start(time);
    osc.stop(time + totalDuration + 0.05);
};

self.onmessage = async (event: MessageEvent<{ params: SynthParams, sequence: PartSequence, tempo: number, sampleRate: number, numSteps: number, currentScale?: any }>) => {
    const { params, sequence, tempo, sampleRate, numSteps, currentScale } = event.data;

    const stepDuration = 60 / tempo / 4;
    const totalDuration = numSteps * stepDuration;
    const offlineContext = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDuration), sampleRate);

    sequence.steps.forEach((note, step) => {
        if (note) {
            const time = step * stepDuration;
            playSynthForRender(offlineContext, params, note.note, time, currentScale?.tuningSystem || '12-TET', currentScale?.root || 'C');
        }
    });

    const renderedBuffer = await offlineContext.startRendering();
    // Post the buffer back to the main thread. The buffers inside are transferable objects.
    self.postMessage(renderedBuffer, {
        transfer: [renderedBuffer.getChannelData(0).buffer, renderedBuffer.getChannelData(1).buffer]
    });
};
