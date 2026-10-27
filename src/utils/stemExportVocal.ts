/**
 * Sampler bank stems: the dry renderer for loop / wavetable banks, the offline
 * Rubber Band host for stretch banks (#1273 Part C, V2).
 */

import type { PartSequence, SamplerBankParams } from '../types';
import type { AlignmentResult } from '../engines/rubberband/alignment/types';
import type { VowelLibrary } from '../engines/rubberband/ConcatenativeHybrid';
import type { ScaleDefinition } from './musicTheory';
import {
    OfflineVocalUnsupportedError,
    renderVocalBankOffline,
    type OfflineVocalRenderInput,
} from '../audio/offline/vocal/offlineVocalHost';
import { usesOfflineVocalHost } from '../audio/offline/vocalOfflineSupport';
import { renderSamplerBankPattern, type PatternNoteFx } from './patternRenderer';
import { getLiveVowelLibrary } from '../services/vowelLibraryService';

/** What a stem export knows about the sampler's vocal banks. */
export interface StemVocalInput {
    /** Per bank: the phoneme alignment the live voices use (`getAlignment`). */
    alignments?: readonly (AlignmentResult | null | undefined)[];
    /** The vowel pack; defaults to the live one once it has loaded. */
    vowelLibrary?: VowelLibrary | null;
    tuning?: ScaleDefinition | null;
    /** The offline host; injectable for tests. */
    render?: (input: OfflineVocalRenderInput) => Promise<AudioBuffer>;
}

export type SamplerBankStem =
    | { kind: 'rendered'; buffer: AudioBuffer }
    | { kind: 'unsupported'; reason: string };

async function liveVowelLibrary(): Promise<VowelLibrary | null> {
    const live = getLiveVowelLibrary();
    if (!live) return null;
    const status = await live.ready;
    return status.state === 'ready' ? live.library : null;
}

export async function renderSamplerBankStem(args: {
    bankIndex: number;
    sequence: PartSequence;
    sampleBuffer: AudioBuffer | null;
    params: SamplerBankParams;
    tempo: number;
    sampleRate: number;
    signal?: AbortSignal;
    noteFx?: PatternNoteFx;
    vocal?: StemVocalInput;
}): Promise<SamplerBankStem> {
    const { bankIndex, sequence, sampleBuffer, params, tempo, sampleRate, signal, noteFx, vocal } = args;
    const plays = sequence.steps.some((step) => !!step);
    if (!usesOfflineVocalHost(params) || !sampleBuffer || !plays) {
        return {
            kind: 'rendered',
            buffer: await renderSamplerBankPattern(sequence, sampleBuffer, params, tempo, sampleRate, signal, noteFx),
        };
    }
    const render = vocal?.render ?? renderVocalBankOffline;
    try {
        const buffer = await render({
            sequence,
            sampleBuffer,
            params,
            alignment: vocal?.alignments?.[bankIndex] ?? null,
            tempo,
            sampleRate,
            tuning: vocal?.tuning ?? null,
            vowelLibrary: vocal?.vowelLibrary !== undefined ? vocal.vowelLibrary : await liveVowelLibrary(),
            signal,
        });
        return { kind: 'rendered', buffer };
    } catch (e) {
        if (e instanceof OfflineVocalUnsupportedError) return { kind: 'unsupported', reason: e.message };
        throw e;
    }
}
