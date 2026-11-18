/**
 * The entry chunk's handle on audio clip playback (#1629): the step handler,
 * the transport and the engine call this, and the player itself
 * (`audioClipHost.ts`: worklet node, pager, media store) is a lazy chunk that
 * loads the first time the song has an audio clip. A song without audio never
 * fetches it.
 */

import type { Arrangement } from '@/types/song';
import type { CompiledAudioGraph } from '@/audio/graph/types';
import { arrangementStore } from '@/stores/songRecordStore';

type Host = (typeof import('./audioClipHost'))['audioClipHost'];

let host: Host | null = null;
let loading = false;
let target: { context: AudioContext; graph: CompiledAudioGraph } | null = null;
let offArrangement: (() => void) | null = null;

const audioCache = new WeakMap<Arrangement, boolean>();
function hasAudio(arrangement: Arrangement): boolean {
    let has = audioCache.get(arrangement);
    if (has === undefined) {
        has = arrangement.clips.some((clip) => clip.kind === 'audio');
        audioCache.set(arrangement, has);
    }
    return has;
}

function load(): void {
    if (host || loading || !target) return;
    loading = true;
    import('./audioClipHost').then(({ audioClipHost }) => {
        host = audioClipHost;
        if (target) host.attach(target.context, target.graph);
    }, (err: unknown) => {
        console.warn('[audio clips] player failed to load:', err);
    }).finally(() => {
        loading = false;
    });
}

export const audioClips = {
    /** The engine is up: plug in now if the song has audio, else when it first gets some. */
    attach(context: AudioContext, graph: CompiledAudioGraph): void {
        target = { context, graph };
        host?.attach(context, graph);
        offArrangement?.();
        offArrangement = arrangementStore.subscribe(() => {
            if (hasAudio(arrangementStore.getSnapshot())) load();
        });
        if (hasAudio(arrangementStore.getSnapshot())) load();
    },

    detach(): void {
        offArrangement?.();
        offArrangement = null;
        target = null;
        host?.detach();
    },

    /** The linear player reached song step `pos`, sounding at context time `time`. */
    onSongStep(arrangement: Arrangement, pos: number, time: number, absStep: number, tempo: number): void {
        if (host) host.onSongStep(arrangement, pos, time, absStep, tempo);
        else if (hasAudio(arrangement)) load();
    },

    /** The transport plays a pattern or the session: audio clips stop at `time`. */
    offSong(time: number): void {
        host?.offSong(time);
    },

    /** Transport stop. */
    stopAll(): void {
        host?.stopAll();
    },
};
