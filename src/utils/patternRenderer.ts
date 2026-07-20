import type {
    PartSequence,
    SynthParams,
    KickParams,
    SnareParams,
    HatParams,
    SamplerBankParams,
    Bass2Params,
} from '../types';
import { freezeSynthTrack, freezeDrumTrack } from './trackFreezer';
import { renderSynthToBuffer, renderDrumToBuffer } from './renderAudio';
import { getTunedFrequency } from './musicTheory';
import { stepDurationSeconds } from './songTimeline';

export interface PatternRenderEngines {
    webGpuEngine?: unknown;
    wasmEngine?: unknown;
    pyodide?: unknown;
}

export interface PatternRenderOptions {
    sequence: PartSequence;
    tempo: number;
    sampleRate: number;
    signal?: AbortSignal;
    engines?: PatternRenderEngines;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
    }
}

function mapWaveformForFreeze(waveform: string): string {
    if (waveform.includes('saw') || waveform === '303-saw') return 'saw';
    if (waveform.includes('sqr') || waveform === '303-sqr' || waveform === 'square') return 'square';
    if (waveform.includes('tri')) return 'tri';
    if (waveform.includes('sin')) return 'sin';
    return 'saw';
}

export function bass2ToSynthParams(bass2: Bass2Params): SynthParams {
    return {
        waveform: bass2.waveform === '303-saw' ? 'sawtooth' : 'square',
        pitch: bass2.pitch,
        filterCutoff: bass2.cutoff,
        filterResonance: bass2.resonance,
        filterMode: bass2.filterMode,
        drive: bass2.drive ?? 0,
        attack: 0.01,
        decay: bass2.decay,
        sustain: 0.5,
        release: 0.1,
        length: 0.25,
        volume: bass2.volume,
        delayTime: 0,
        delayFeedback: 0,
        delayMix: 0,
    };
}

async function renderWithOfflineSteps(
    sequence: PartSequence,
    tempo: number,
    sampleRate: number,
    renderHit: (stepIndex: number, time: number) => Promise<AudioBuffer | null>,
    signal?: AbortSignal,
): Promise<AudioBuffer> {
    throwIfAborted(signal);
    const stepDur = stepDurationSeconds(tempo);
    const totalDuration = sequence.steps.length * stepDur;
    const totalSamples = Math.ceil(totalDuration * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

    for (let step = 0; step < sequence.steps.length; step++) {
        throwIfAborted(signal);
        const note = sequence.steps[step];
        if (!note) continue;

        const time = step * stepDur;
        const hitBuffer = await renderHit(step, time);
        if (!hitBuffer) continue;

        const source = offlineCtx.createBufferSource();
        source.buffer = hitBuffer;
        const gain = offlineCtx.createGain();
        gain.gain.setValueAtTime(note.velocity ?? 1, time);
        source.connect(gain);
        gain.connect(offlineCtx.destination);
        source.start(time);
    }

    throwIfAborted(signal);
    return offlineCtx.startRendering();
}

function monoToStereo(buffer: AudioBuffer, sampleRate: number): AudioBuffer {
    if (buffer.numberOfChannels >= 2) return buffer;
    const stereo = new OfflineAudioContext(2, buffer.length, sampleRate);
    const out = stereo.createBuffer(2, buffer.length, sampleRate);
    const mono = buffer.getChannelData(0);
    out.copyToChannel(mono, 0);
    out.copyToChannel(mono, 1);
    return out;
}

export async function renderSynthPattern(
    params: SynthParams,
    options: PatternRenderOptions,
): Promise<AudioBuffer> {
    const { sequence, tempo, sampleRate, signal, engines } = options;
    throwIfAborted(signal);

    if (engines?.pyodide) {
        const freezeParams = {
            ...params,
            waveform: mapWaveformForFreeze(params.waveform),
            bpm: tempo,
        };
        const mono = await freezeSynthTrack(engines.pyodide, sequence, freezeParams as SynthParams, {
            bpm: tempo,
            sampleRate,
        });
        throwIfAborted(signal);
        return monoToStereo(mono, sampleRate);
    }

    return renderWithOfflineSteps(
        sequence,
        tempo,
        sampleRate,
        async (_step, _time) => {
            const note = sequence.steps[_step];
            if (!note) return null;
            const hit = await renderSynthToBuffer(params, note.note, stepDurationSeconds(tempo) * (note.length ?? 1), engines);
            return hit;
        },
        signal,
    );
}

export async function renderDrumPattern(
    drumType: 'kick' | 'snare' | 'closedHat' | 'openHat',
    params: KickParams | SnareParams | HatParams,
    options: PatternRenderOptions,
): Promise<AudioBuffer> {
    const { sequence, tempo, sampleRate, signal, engines } = options;
    throwIfAborted(signal);

    if (engines?.pyodide) {
        const mono = await freezeDrumTrack(engines.pyodide, sequence, params, drumType, {
            bpm: tempo,
            sampleRate,
        });
        throwIfAborted(signal);
        return monoToStereo(mono, sampleRate);
    }

    return renderWithOfflineSteps(
        sequence,
        tempo,
        sampleRate,
        async (step) => {
            if (!sequence.steps[step]) return null;
            return renderDrumToBuffer(drumType, params, engines?.pyodide);
        },
        signal,
    );
}

export async function renderSamplerBankPattern(
    sequence: PartSequence,
    sampleBuffer: AudioBuffer | null,
    bankParams: SamplerBankParams,
    tempo: number,
    sampleRate: number,
    signal?: AbortSignal,
): Promise<AudioBuffer> {
    throwIfAborted(signal);
    const stepDur = stepDurationSeconds(tempo);
    const totalDuration = sequence.steps.length * stepDur;
    const totalSamples = Math.ceil(totalDuration * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

    if (!sampleBuffer) {
        return offlineCtx.startRendering();
    }

    const rootFreq = getTunedFrequency('C4', '12-TET', 'C');
    for (let step = 0; step < sequence.steps.length; step++) {
        throwIfAborted(signal);
        const note = sequence.steps[step];
        if (!note) continue;

        const time = step * stepDur;
        const noteFreq = getTunedFrequency(note.note, '12-TET', 'C');
        const playbackRate = (noteFreq / rootFreq) * bankParams.playbackSpeed;

        const source = offlineCtx.createBufferSource();
        source.buffer = sampleBuffer;
        source.playbackRate.setValueAtTime(playbackRate, time);

        const gain = offlineCtx.createGain();
        const velocity = (note.velocity ?? 1) * bankParams.volume;
        gain.gain.setValueAtTime(velocity, time);

        source.connect(gain);
        gain.connect(offlineCtx.destination);
        source.start(time, 0, stepDur * (note.length ?? 1));
    }

    throwIfAborted(signal);
    return offlineCtx.startRendering();
}
