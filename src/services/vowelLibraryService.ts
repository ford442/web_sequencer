/**
 * The live vowel pack (V2 concatenative hybrid).
 *
 * Loaded once per AudioContext in the background after the singing voices
 * are up, decoded at the context rate. A missing or broken pack is reported
 * in the Engine HUD (`vowel-samples`) and every bank that asked for vowel
 * samples stays on TTS. The offline vocal host takes the same library and
 * resamples it to the export rate (`VowelLibrary.withSampleRate`).
 */

import {
    ConcatenativeHybrid,
    DEFAULT_VOWEL_PACK_PATH,
    VowelLibrary,
    type VowelLibraryStatus,
} from '../engines/rubberband/ConcatenativeHybrid';
import { engineDegradationStore } from '../stores/engineDegradationStore';

interface LiveVowelPack {
    context: BaseAudioContext;
    library: VowelLibrary;
    hybrid: ConcatenativeHybrid;
    ready: Promise<VowelLibraryStatus>;
}

let live: LiveVowelPack | null = null;

/** Decode with the context so the samples land at its rate; mono = channel 0. */
export function decodeWithContext(context: BaseAudioContext) {
    return async (bytes: ArrayBuffer) => {
        const decoded = await context.decodeAudioData(bytes);
        return { data: decoded.getChannelData(0), sampleRate: decoded.sampleRate };
    };
}

function reportStatus(status: VowelLibraryStatus): void {
    if (status.state === 'disabled') {
        engineDegradationStore.report({
            id: 'vowel-samples',
            subsystem: 'vowel-samples',
            category: 'audio',
            message: 'Vowel samples off — long notes stay TTS',
            reason: status.reason,
            status: 'active',
            activeBackend: 'tts-only',
            requestedBackend: 'vowel-pack',
            retryable: false,
        });
    } else if (status.state === 'ready') {
        engineDegradationStore.resolve('vowel-samples');
    }
}

/** Start (or reuse) the load for `context`. Never rejects. */
export function loadLiveVowelLibrary(context: BaseAudioContext, basePath: string = DEFAULT_VOWEL_PACK_PATH): Promise<VowelLibraryStatus> {
    if (live?.context === context) return live.ready;
    const library = new VowelLibrary();
    const hybrid = new ConcatenativeHybrid({ sampleRate: context.sampleRate }, library);
    const ready = library.loadFromUrl(basePath, decodeWithContext(context)).then((status) => {
        reportStatus(status);
        if (status.state === 'ready') {
            console.log(`[VowelLibrary] ${status.count} vowel samples at ${context.sampleRate} Hz`);
        } else if (status.state === 'disabled') {
            console.warn(`[VowelLibrary] ${status.reason}`);
        }
        return status;
    });
    live = { context, library, hybrid, ready };
    return ready;
}

/** The live planner, or null before the pack is ready (notes stay TTS). */
export function getLiveVowelHybrid(): ConcatenativeHybrid | null {
    return live && live.library.getStatus().state === 'ready' ? live.hybrid : null;
}

/** The live pack and its load, for the offline host. */
export function getLiveVowelLibrary(): { library: VowelLibrary; ready: Promise<VowelLibraryStatus> } | null {
    return live ? { library: live.library, ready: live.ready } : null;
}

/** Tests only. */
export function resetLiveVowelLibraryForTests(): void {
    live = null;
}
