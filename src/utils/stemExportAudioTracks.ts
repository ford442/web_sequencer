/**
 * Audio tracks in the stem export (#1629): one dry stem per audio track that
 * has clips (`stems/audio-N.wav`), in the master sum like every other stem.
 *
 * Rendered with the voice DSP and frame arithmetic the live player uses
 * (`audio/audioTracks/renderOffline.ts`), straight like the other stems.
 * Media the store does not hold renders silent and is listed in the report.
 */

import type { Arrangement, AudioTrackKey } from '../types';
import type { AudioTrackState } from '../arrangement/audioTracks';
import { renderAudioTracksOffline, type OfflineMedia } from '../audio/audioTracks/renderOffline';
import { mediaStore } from '../audio/media/MediaStore';

export interface AudioTrackStemsInput {
    arrangement: Arrangement;
    audio: AudioTrackState;
    tempo: number;
    sampleRate: number;
    frames: number;
    isAudible: (track: AudioTrackKey) => boolean;
    loadMedia?: (id: string) => Promise<OfflineMedia | null>;
}

export interface AudioTrackStem {
    id: AudioTrackKey;
    channels: Float32Array[];
    audible: boolean;
}

async function loadFromStore(id: string): Promise<OfflineMedia | null> {
    const info = await mediaStore.info(id);
    if (!info) return null;
    const channels = await mediaStore.readFrames(id, 0, info.frames);
    return channels ? { sampleRate: info.sampleRate, frames: info.frames, channels } : null;
}

/** One stem per audio track with clips, in lane order. A silenced track is a silent stem. */
export async function renderAudioTrackStems(input: AudioTrackStemsInput): Promise<{ stems: AudioTrackStem[]; missingMedia: string[] }> {
    const rendered = await renderAudioTracksOffline({
        arrangement: input.arrangement,
        tracks: input.audio.tracks,
        clock: { tempo: input.tempo, swing: 0 },
        sampleRate: input.sampleRate,
        frames: input.frames,
        loadMedia: input.loadMedia ?? loadFromStore,
    });
    const byId = new Map(rendered.tracks.map((t) => [t.track, t]));
    const stems: AudioTrackStem[] = [];
    for (const track of input.audio.tracks) {
        const out = byId.get(track.id);
        if (!out) continue;
        const audible = input.isAudible(track.id);
        stems.push({
            id: track.id,
            channels: audible ? [out.left, out.right] : [new Float32Array(input.frames), new Float32Array(input.frames)],
            audible,
        });
    }
    return { stems, missingMedia: rendered.missingMedia };
}
