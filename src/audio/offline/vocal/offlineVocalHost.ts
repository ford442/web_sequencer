/**
 * Offline vocal host: bounce a stretch-mode sampler bank through Rubber Band.
 *
 * Freeze and stem export used to play the bank's TTS buffer through a dry,
 * varispeed AudioBufferSource, so a bounce of a sung part was a different
 * instrument than the one that played (#1273 Part C). This host renders the
 * bank with the live instrument itself:
 *
 * - an OfflineAudioContext at the export rate (`resolveExportSampleRate`,
 *   #1136), so its AudioWorkletGlobalScope reports that rate to the processor;
 * - `SingingVoiceManager` voices on that context: the same RubberBandProcessor
 *   worklet, each with its own `rubberband.wasm` instance and heap, sent the
 *   same INIT_WASM message as live. Never `hyphon_native`, never the live
 *   voices' heap (docs/wasm/BUILD_NOTES.md#module-split);
 * - `createPlaySamplerVoice`, the live trigger, for every hit: phoneme timing,
 *   painter edits, formant shift, the vocal FX chain and the V2 vowel
 *   crossfade are the same code at the same step.
 *
 * The worklet starts a note when its message arrives, so the render suspends
 * at each hit's render quantum, triggers it, waits for every voice to confirm
 * (a SYNC round-trip) and resumes.
 *
 * If the module cannot load, the render throws {@link OfflineVocalUnsupportedError}
 * and the caller reports the bank unsupported. It never substitutes a dry
 * buffer — the rule the WAM2 host uses for plugins (docs/adr/0001-wam2-host.md).
 */

import type { MutableRefObject } from 'react';
import type { MultisampleBank, Note, PartSequence, SamplerBankParams } from '../../../types';
import type { AlignmentResult } from '../../../engines/rubberband/alignment/types';
import { ConcatenativeHybrid, type VowelLibrary } from '../../../engines/rubberband/ConcatenativeHybrid';
import { SingingVoiceManager } from '../../../engines/SingingVoiceManager';
import type { SingingVoice } from '../../../engines/SingingVoice';
import type { ScaleDefinition } from '../../../utils/musicTheory';
import { createPlaySamplerVoice } from '../../../hooks/audioEngine/samplerPlayback/playSamplerVoice';
import type { ActiveSamplerNote, SamplerPlaybackRefs } from '../../../hooks/audioEngine/samplerPlayback/types';
import { applyVoiceParamUpdate } from '../../../hooks/audioEngine/sampleManagement';
import { createOfflineBuffer, createOfflineContext } from '../createOfflineContext';
import { resampleAudioBuffer } from '../../../utils/resampleAudioBuffer';
import { resolveExportSampleRate, type SampleRatePref } from '../../../utils/audioContextPolicy';
import { stepDurationSeconds } from '../../../utils/songTimeline';
import { fetchPublicArrayBuffer } from '../../../utils/publicAsset';
import { isAppleWebKit } from '../../../utils/engineTelemetry';

/** The bank could not be rendered through Rubber Band offline. */
export class OfflineVocalUnsupportedError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'OfflineVocalUnsupportedError';
    }
}

/** Voices per render: one TTS + one vowel layer, with room for overlap and choir. */
const OFFLINE_VOICES = 4;
const RENDER_QUANTUM = 128;
const SYNC_TIMEOUT_MS = 5000;

export interface OfflineVocalRenderInput {
    sequence: PartSequence;
    /** The bank's sample (TTS phrase), at any rate; resampled to `sampleRate`. */
    sampleBuffer: AudioBuffer;
    params: SamplerBankParams;
    alignment?: AlignmentResult | null;
    tempo: number;
    /** Export rate; defaults to the user's sample-rate policy. */
    sampleRate?: number;
    sampleRatePref?: SampleRatePref;
    liveSampleRate?: number | null;
    tuning?: ScaleDefinition | null;
    /** The live vowel pack; resampled to the export rate when it differs. */
    vowelLibrary?: VowelLibrary | null;
    signal?: AbortSignal;
}

export interface OfflineVocalHostDeps {
    /** `rubberband.wasm` bytes; fetched from `public/` when omitted. */
    wasmBinary?: ArrayBuffer;
}

let wasmBytes: Promise<ArrayBuffer> | null = null;

/** `public/rubberband.wasm`, fetched once per page. */
export function loadRubberBandWasm(): Promise<ArrayBuffer> {
    wasmBytes ??= fetchPublicArrayBuffer('rubberband.wasm').catch((e: unknown) => {
        wasmBytes = null;
        throw e;
    });
    return wasmBytes;
}

/** Tests only. */
export function resetRubberBandWasmForTests(): void {
    wasmBytes = null;
}

const ref = <T,>(current: T): MutableRefObject<T> => ({ current });

function notesOf(step: Note): string | string[] {
    return step.chord && step.chord.length > 0 ? [step.note, ...step.chord] : step.note;
}

/** Waits until the voice's worklet has handled every message posted so far. */
function syncVoice(voice: SingingVoice, id: number): Promise<void> {
    const node = voice.workletNode;
    if (!node) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            node.port.removeEventListener('message', onMessage);
            reject(new OfflineVocalUnsupportedError('Rubber Band worklet stopped answering during the offline render'));
        }, SYNC_TIMEOUT_MS);
        const onMessage = (event: MessageEvent) => {
            const msg = event.data as { type?: string; id?: number } | null;
            if (msg?.type !== 'SYNCED' || msg.id !== id) return;
            clearTimeout(timer);
            node.port.removeEventListener('message', onMessage);
            resolve();
        };
        node.port.addEventListener('message', onMessage);
        node.port.start();
        node.port.postMessage({ type: 'SYNC', data: { id } });
    });
}

/** The bank's voice-level params, applied the way a live edit applies them. */
function applyBankParams(manager: SingingVoiceManager, params: SamplerBankParams): void {
    for (const [key, value] of Object.entries(params)) {
        if (typeof value !== 'number' && key !== 'stretchProfile') continue;
        applyVoiceParamUpdate({
            manager,
            choirLeftGain: null,
            choirRightGain: null,
            currentTime: 0,
            key: key as keyof SamplerBankParams,
            value: value as number,
        });
    }
}

/**
 * Render `input.sequence` on a stretch-mode bank through Rubber Band at the
 * export rate. Stereo, `steps × step length` long, like the other stems.
 */
export async function renderVocalBankOffline(
    input: OfflineVocalRenderInput,
    deps: OfflineVocalHostDeps = {},
): Promise<AudioBuffer> {
    if (isAppleWebKit()) {
        // Same policy as the live engine (engineLifecycle): the worklet aborts there.
        throw new OfflineVocalUnsupportedError('rubberband AudioWorklet aborts WebKit / Safari');
    }
    const sampleRate = input.sampleRate ?? resolveExportSampleRate(input.sampleRatePref, input.liveSampleRate ?? null);
    const stepDur = stepDurationSeconds(input.tempo);
    const ctx = createOfflineContext({ channels: 2, durationSeconds: input.sequence.steps.length * stepDur, sampleRate });

    let wasmBinary: ArrayBuffer;
    try {
        wasmBinary = deps.wasmBinary ?? await loadRubberBandWasm();
    } catch (e) {
        throw new OfflineVocalUnsupportedError(`rubberband.wasm unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Same voice config as the live manager (engineLifecycle), minus CTC
    // alignment: the bank's alignment is passed in, nothing is re-aligned.
    const manager = new SingingVoiceManager(ctx, OFFLINE_VOICES, {
        useHighQuality: false,
        preserveFormants: true,
        channels: 1,
        bufferSize: 16384,
        enablePhonemeStretching: true,
        enableFormantShifting: true,
        enableCtcAlignment: false,
        offline: true,
    });
    try {
        // Each voice gets its own copy: INIT_WASM structured-clones the bytes.
        await manager.init(wasmBinary);
    } catch (e) {
        throw new OfflineVocalUnsupportedError(`Rubber Band did not load offline: ${e instanceof Error ? e.message : String(e)}`);
    }
    applyBankParams(manager, input.params);

    const buffer = await resampleAudioBuffer(input.sampleBuffer, sampleRate, input.signal);
    const library = input.vowelLibrary
        ? await input.vowelLibrary.withSampleRate(sampleRate, async (data, from, to) => {
            const source = createOfflineBuffer({ channels: 1, length: data.length, sampleRate: from });
            source.getChannelData(0).set(data);
            return (await resampleAudioBuffer(source, to, input.signal)).getChannelData(0);
        })
        : null;
    const hybrid = library ? new ConcatenativeHybrid({ sampleRate }, library) : null;

    // The bank's strip ends where the live sampler's does (masterSaturation);
    // here that is a pass-through into the stem. Sends have no target: stems are dry.
    const out = ctx.createWaveShaper();
    out.connect(ctx.destination);
    const choirLeft = ctx.createGain();
    const choirRight = ctx.createGain();
    choirLeft.gain.value = 0;
    choirRight.gain.value = 0;
    choirLeft.connect(out);
    choirRight.connect(out);

    const refs: SamplerPlaybackRefs = {
        multisampleBanksRef: ref(new Map<string, MultisampleBank>()),
        loadedSampleBuffersRef: ref(new Map([[input.params.sampleName, buffer]])),
        masterSaturationRef: ref(out),
        singingVoiceManagerRef: ref(manager),
        vocalAlignmentsRef: ref(new Map(input.alignment ? [[input.params.sampleName, input.alignment]] : [])),
        choirLeftGainRef: ref(choirLeft),
        choirRightGainRef: ref(choirRight),
        reverbNodesRef: ref({}),
        reverbTypeRef: ref('plate'),
        delayNodeRef: ref(null),
        harmonizerRef: ref(null),
        nextSamplerNoteId: ref(0),
        activeSamplerNotes: ref(new Map<number, ActiveSamplerNote>()),
    };
    const play = createPlaySamplerVoice(ctx, input.tempo, refs, () => hybrid);

    // Hits grouped by the render quantum they start in.
    const byFrame = new Map<number, { step: Note; time: number }[]>();
    input.sequence.steps.forEach((step, index) => {
        if (!step) return;
        const time = index * stepDur;
        const frame = Math.floor((time * sampleRate) / RENDER_QUANTUM) * RENDER_QUANTUM;
        const group = byFrame.get(frame) ?? [];
        group.push({ step, time });
        byFrame.set(frame, group);
    });

    let syncId = 0;
    const trigger = async (hits: { step: Note; time: number }[]) => {
        for (const { step, time } of hits) {
            play(input.params, notesOf(step), time, step.length ?? 1, stepDur, step, 0, input.tuning ?? null);
        }
        const id = ++syncId;
        await Promise.all(manager.getAllVoices().map((voice) => syncVoice(voice, id)));
    };

    let failure: unknown = null;
    for (const [frame, hits] of [...byFrame.entries()].sort((a, b) => a[0] - b[0])) {
        if (frame === 0) {
            await trigger(hits);
            continue;
        }
        void ctx.suspend(frame / sampleRate).then(async () => {
            try {
                if (!failure && !input.signal?.aborted) await trigger(hits);
            } catch (e) {
                failure = e;
            } finally {
                void ctx.resume();
            }
        });
    }

    const rendered = await ctx.startRendering();
    if (input.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    if (failure) {
        if (failure instanceof OfflineVocalUnsupportedError) throw failure;
        const detail = failure instanceof Error ? failure.message : JSON.stringify(failure);
        throw new OfflineVocalUnsupportedError(`offline vocal render failed: ${detail}`);
    }
    return rendered;
}
