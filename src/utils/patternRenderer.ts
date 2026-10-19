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
import { renderSynthToBuffer, renderDrumToBuffer, type RenderSynthEngines } from './renderAudio';
import { getTunedFrequency, midiToNote } from './musicTheory';
import { stepDurationSeconds } from './songTimeline';
import { createOfflineBuffer, createOfflineContext } from '../audio/offline/createOfflineContext';
import { renderNoteFxTimeline } from '../sequencer/noteFx/chain';
import { chainIsActive, type NoteFxChain } from '../sequencer/noteFx/types';
import type { NoteFxParamLookup } from '../sequencer/noteFx/params';
import { macroEngineForWaveform } from '../engines/MacroParams';
import { renderMacroBuffer, type OfflineMacroNote } from '../audio/offline/OfflineMacroEngine';
import { noteToMidi } from './musicTheory';

export type PatternRenderEngines = RenderSynthEngines;

/**
 * A track's note FX chain for an offline render (#1345). The render plays
 * the chain's events — the same `renderNoteFx` output the live step handler
 * schedules — instead of the steps.
 */
export interface PatternNoteFx {
    chain: NoteFxChain;
    /** The track's own loop length (each pass seeds like the live clock). */
    loopLength: number;
    /** Where loop passes start when the timeline re-anchors them (Song Mode). */
    passStarts?: readonly number[];
    /** Distinguishes sampler banks that share the sampler chain. */
    salt?: number;
    lookup?: NoteFxParamLookup;
}

export interface PatternRenderOptions {
    sequence: PartSequence;
    tempo: number;
    sampleRate: number;
    signal?: AbortSignal;
    engines?: PatternRenderEngines;
    noteFx?: PatternNoteFx;
}

/** One note to bounce: start / length in steps. */
interface Hit {
    start: number;
    length: number;
    note: string;
    velocity: number;
}

function noteFxHits(sequence: PartSequence, fx: PatternNoteFx | undefined): Hit[] | null {
    if (!fx || !chainIsActive(fx.chain)) return null;
    return renderNoteFxTimeline(sequence.steps, fx.chain, {
        loopLength: fx.loopLength,
        passStarts: fx.passStarts,
        salt: fx.salt,
        lookup: fx.lookup,
    }).map((e) => ({ start: e.start, length: e.length, note: midiToNote(e.pitch), velocity: e.velocity }));
}

/** Bounce `hits` with `renderHit` per distinct (note, length), velocity as gain. */
async function renderHits(
    totalSteps: number,
    tempo: number,
    sampleRate: number,
    hits: readonly Hit[],
    renderHit: (note: string, lengthSteps: number) => Promise<AudioBuffer | null>,
    signal?: AbortSignal,
): Promise<AudioBuffer> {
    throwIfAborted(signal);
    const stepDur = stepDurationSeconds(tempo);
    const offlineCtx = createOfflineContext({ channels: 2, durationSeconds: totalSteps * stepDur, sampleRate });
    const rendered = new Map<string, AudioBuffer | null>();
    for (const hit of hits) {
        throwIfAborted(signal);
        const key = `${hit.note}:${hit.length}`;
        if (!rendered.has(key)) rendered.set(key, await renderHit(hit.note, hit.length));
        const buffer = rendered.get(key);
        if (!buffer) continue;
        const time = hit.start * stepDur;
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        const gain = offlineCtx.createGain();
        gain.gain.setValueAtTime(hit.velocity, time);
        source.connect(gain);
        gain.connect(offlineCtx.destination);
        source.start(time);
    }
    throwIfAborted(signal);
    return offlineCtx.startRendering();
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
    const offlineCtx = createOfflineContext({ channels: 2, durationSeconds: totalDuration, sampleRate });

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
    const out = createOfflineBuffer({ channels: 2, length: buffer.length, sampleRate });
    const mono = buffer.getChannelData(0);
    out.copyToChannel(mono, 0);
    out.copyToChannel(mono, 1);
    return out;
}

/**
 * The notes of a pattern for an offline macro render: every step note and its
 * chord notes (the part is polyphonic), with slide, velocity and the step's
 * timbre — or the note FX chain's events when one is active.
 */
function macroNotes(sequence: PartSequence, stepDur: number, fxHits: Hit[] | null): OfflineMacroNote[] {
    const notes: OfflineMacroNote[] = [];
    if (fxHits) {
        for (const hit of fxHits) {
            notes.push({ midi: noteToMidi(hit.note), velocity: hit.velocity, startSeconds: hit.start * stepDur, durationSeconds: hit.length * stepDur });
        }
        return notes;
    }
    sequence.steps.forEach((step, i) => {
        if (!step) return;
        const durationSeconds = (step.length ?? 1) * stepDur;
        const timbre = step.timbre !== undefined ? step.timbre - 0.5 : undefined;
        for (const name of [step.note, ...(step.chord ?? [])]) {
            if (!name) continue;
            notes.push({ midi: noteToMidi(name), velocity: step.velocity ?? 0.8, startSeconds: i * stepDur, durationSeconds, slide: !!step.slide, timbre });
        }
    });
    return notes;
}

export async function renderSynthPattern(
    params: SynthParams,
    options: PatternRenderOptions,
): Promise<AudioBuffer> {
    const { sequence, tempo, sampleRate, signal, engines } = options;
    throwIfAborted(signal);

    // Note FX: the chain's events, not the steps (the Pyodide freezer only
    // reads steps, so a chain always takes the Web Audio path).
    const fxHits = noteFxHits(sequence, options.noteFx);

    // Macro models render through the same wasm the live part runs. When it
    // cannot run here the model's documented fallback waveform renders below
    // (reported once by renderMacroBuffer).
    const macroEngine = macroEngineForWaveform(params.waveform);
    if (macroEngine) {
        const stepDur = stepDurationSeconds(tempo);
        const rendered = await renderMacroBuffer({
            params,
            engine: macroEngine,
            notes: macroNotes(sequence, stepDur, fxHits),
            durationSeconds: sequence.steps.length * stepDur,
            sampleRate,
        });
        throwIfAborted(signal);
        if (rendered) return rendered;
        params = { ...params, waveform: macroEngine.fallback };
    }
    if (fxHits) {
        return renderHits(
            sequence.steps.length,
            tempo,
            sampleRate,
            fxHits,
            (note, lengthSteps) => renderSynthToBuffer(params, note, stepDurationSeconds(tempo) * lengthSteps, engines, sampleRate),
            signal,
        );
    }

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
            // Render the hit at the target rate: a buffer recorded at another
            // rate would be resampled on playback into the offline context.
            const hit = await renderSynthToBuffer(
                params,
                note.note,
                stepDurationSeconds(tempo) * (note.length ?? 1),
                engines,
                sampleRate,
            );
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
            return renderDrumToBuffer(drumType, params, engines?.pyodide, sampleRate);
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
    noteFx?: PatternNoteFx,
): Promise<AudioBuffer> {
    throwIfAborted(signal);
    const stepDur = stepDurationSeconds(tempo);
    const totalDuration = sequence.steps.length * stepDur;
    const offlineCtx = createOfflineContext({ channels: 2, durationSeconds: totalDuration, sampleRate });

    if (!sampleBuffer) {
        return offlineCtx.startRendering();
    }

    const hits: Hit[] = noteFxHits(sequence, noteFx) ?? sequence.steps.flatMap((note, step) =>
        note ? [{ start: step, length: note.length ?? 1, note: note.note, velocity: note.velocity ?? 1 }] : [],
    );
    const rootFreq = getTunedFrequency('C4', '12-TET', 'C');
    for (const hit of hits) {
        throwIfAborted(signal);
        const time = hit.start * stepDur;
        const noteFreq = getTunedFrequency(hit.note, '12-TET', 'C');
        const playbackRate = (noteFreq / rootFreq) * bankParams.playbackSpeed;

        const source = offlineCtx.createBufferSource();
        source.buffer = sampleBuffer;
        source.playbackRate.setValueAtTime(playbackRate, time);

        const gain = offlineCtx.createGain();
        const velocity = hit.velocity * bankParams.volume;
        gain.gain.setValueAtTime(velocity, time);

        source.connect(gain);
        gain.connect(offlineCtx.destination);
        source.start(time, 0, stepDur * hit.length);
    }

    throwIfAborted(signal);
    return offlineCtx.startRendering();
}
