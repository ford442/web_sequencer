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
import { renderSynthToBuffer, renderDrumToBuffer, type RenderSynthEngines, type SynthFilterCurve } from './renderAudio';
import type { PatternAutomation } from '../audio/offline/offlineLaneAutomation';
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
    /** The track's song automation lanes on this sequence's steps (#1384). */
    automation?: PatternAutomation;
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
    renderHit: (note: string, lengthSteps: number, start: number) => Promise<AudioBuffer | null>,
    signal?: AbortSignal,
    /** Extra cache key for hits whose sound depends on where they start (automation). */
    hitKey?: (hit: Hit) => string,
): Promise<AudioBuffer> {
    throwIfAborted(signal);
    const stepDur = stepDurationSeconds(tempo);
    const offlineCtx = createOfflineContext({ channels: 2, durationSeconds: totalSteps * stepDur, sampleRate });
    const rendered = new Map<string, AudioBuffer | null>();
    for (const hit of hits) {
        throwIfAborted(signal);
        const key = `${hit.note}:${hit.length}${hitKey ? `:${hitKey(hit)}` : ''}`;
        if (!rendered.has(key)) rendered.set(key, await renderHit(hit.note, hit.length, hit.start));
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

function hasAutomation(automation: PatternAutomation | undefined): automation is PatternAutomation {
    const any = (values: ReadonlyArray<number | null> | undefined) => !!values?.some((v) => v !== null);
    return !!automation && (any(automation.filterCutoff) || any(automation.filterResonance) || any(automation.decay));
}

/**
 * One note's params under the track's automation (#1384): the values on the
 * note's first step replace the knob's (decay shapes the envelope, so it is
 * read there only), and on a 303 voice every later step the note holds
 * through moves the filter again — a step with no value keeps
 * the last one, as a param the scheduler set does.
 */
function automatedHit(
    params: SynthParams,
    automation: PatternAutomation | undefined,
    start: number,
    lengthSteps: number,
    stepDur: number,
): { params: SynthParams; curve?: SynthFilterCurve } {
    if (!automation) return { params };
    const first = Math.floor(start);
    const at = (values: ReadonlyArray<number | null> | undefined, step: number) => values?.[step] ?? null;
    const cutoff = at(automation.filterCutoff, first);
    const resonance = at(automation.filterResonance, first);
    const decay = at(automation.decay, first);
    const hitParams = cutoff === null && resonance === null && decay === null
        ? params
        : {
            ...params,
            filterCutoff: cutoff ?? params.filterCutoff,
            filterResonance: resonance ?? params.filterResonance,
            decay: decay ?? params.decay,
        };
    if (!automation.perStep) return { params: hitParams };

    const curve: Array<{ time: number; filterCutoff?: number; filterResonance?: number }> = [];
    for (let step = first + 1; step < start + lengthSteps; step++) {
        const c = at(automation.filterCutoff, step);
        const r = at(automation.filterResonance, step);
        if (c === null && r === null) continue;
        curve.push({
            time: (step - start) * stepDur,
            ...(c !== null ? { filterCutoff: c } : {}),
            ...(r !== null ? { filterResonance: r } : {}),
        });
    }
    return curve.length > 0 ? { params: hitParams, curve } : { params: hitParams };
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
            const midi = noteToMidi(hit.note);
            if (midi === null) continue;
            notes.push({ midi, velocity: hit.velocity, startSeconds: hit.start * stepDur, durationSeconds: hit.length * stepDur });
        }
        return notes;
    }
    sequence.steps.forEach((step, i) => {
        if (!step) return;
        const durationSeconds = (step.length ?? 1) * stepDur;
        const timbre = step.timbre !== undefined ? step.timbre - 0.5 : undefined;
        for (const name of [step.note, ...(step.chord ?? [])]) {
            const midi = noteToMidi(name);
            if (midi === null) continue; // not a note name: never sounds
            notes.push({ midi, velocity: step.velocity ?? 0.8, startSeconds: i * stepDur, durationSeconds, slide: !!step.slide, timbre });
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
    const automation = hasAutomation(options.automation) ? options.automation : undefined;
    const stepSeconds = stepDurationSeconds(tempo);
    const renderAutomatedHit = (note: string, start: number, lengthSteps: number) => {
        const hit = automatedHit(params, automation, start, lengthSteps, stepSeconds);
        return renderSynthToBuffer(hit.params, note, stepSeconds * lengthSteps, engines, sampleRate, hit.curve);
    };

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
            (note, lengthSteps, start) => renderAutomatedHit(note, start, lengthSteps),
            signal,
            automation ? (hit) => String(hit.start) : undefined,
        );
    }

    // The Pyodide freezer takes one set of params for the whole track, so an
    // automated track renders per hit below.
    if (engines?.pyodide && !automation) {
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
            return renderAutomatedHit(note.note, _step, note.length ?? 1);
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
    const rootFreq = getTunedFrequency('C4', '12-TET', 'C') as number;
    for (const hit of hits) {
        throwIfAborted(signal);
        const time = hit.start * stepDur;
        const noteFreq = getTunedFrequency(hit.note, '12-TET', 'C');
        if (noteFreq === null) continue; // not a note name: never sounds
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
