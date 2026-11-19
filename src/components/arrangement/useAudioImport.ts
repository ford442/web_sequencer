/**
 * Import audio files onto the arrangement (#1629 P1): drop a file on an audio
 * lane, on any lane, or pick one with IMPORT.
 *
 * Each file is decoded into the media store, then placed as one edit (one
 * undo step, labelled "import <name>"): the media is registered with the
 * song, a track is added when the drop was not on an audio lane, and an audio
 * clip as long as the file at the current tempo goes in at the drop step.
 */

import { useCallback, useState } from 'react';
import type { Arrangement, AudioTrackKey, MediaRef } from '../../types';
import { addClip } from '../../arrangement/model';
import { addAudioTrack, registerMedia } from '../../arrangement/audioTracks';
import { audioTrackStore } from '../../stores/audioTrackStore';
import { transportMixStore } from '../../stores/transportMixStore';
import { liveProject } from '../../collab/liveProject';
import { importAudioFile } from '../../audio/media/importAudioFile';
import { peakCache } from '../../audio/media/peakCache';

export interface AudioImportStatus {
    kind: 'idle' | 'busy' | 'done' | 'error';
    text: string;
}

/** Steps a piece of media covers at `tempo` (its real-time length, rounded up). */
export function mediaLengthSteps(ref: Pick<MediaRef, 'frames' | 'sampleRate'>, tempo: number): number {
    const stepSeconds = 60 / (Math.max(1, tempo) * 4);
    return Math.max(1, Math.ceil(ref.frames / ref.sampleRate / stepSeconds - 1e-9));
}

/** Files a drop or a picker offers that look like audio. */
export function audioFilesOf(list: FileList | readonly File[] | null | undefined): File[] {
    if (!list) return [];
    return Array.from(list).filter((f) =>
        f.type.startsWith('audio/') || /\.(wav|wave|rf64|aif|aiff|flac|mp3|ogg|oga|opus|m4a|aac|webm)$/i.test(f.name));
}

/**
 * Put already-imported media on the timeline: one edit. `track` null = a new
 * audio track. Returns the clip id, or an error a user can read.
 */
export function placeImportedMedia(
    onEdit: (updater: (prev: Arrangement) => Arrangement) => void,
    media: { mediaId: string; ref: MediaRef },
    track: AudioTrackKey | null,
    startStep: number,
): { clipId: string; track: AudioTrackKey } | { error: string } {
    let state = registerMedia(audioTrackStore.getSnapshot(), media.mediaId, media.ref);
    let target = track;
    if (!target || !state.tracks.some((t) => t.id === target)) {
        const added = addAudioTrack(state, target ?? undefined);
        if (!added.id) return { error: 'All 8 audio tracks are in use: drop the file on an audio lane' };
        state = added.state;
        target = added.id;
    }
    const lane = target;
    let clipId = '';
    liveProject.beginGesture();
    liveProject.edit('human', () => {
        audioTrackStore.set(state);
        onEdit((prev) => {
            const result = addClip(prev, {
                kind: 'audio',
                track: lane,
                mediaId: media.mediaId,
                startStep: Math.max(0, Math.round(startStep)),
                lengthSteps: mediaLengthSteps(media.ref, transportMixStore.getSnapshot().tempo),
                offsetFrames: 0,
                gainDb: 0,
                warp: 'off',
            });
            clipId = result.id;
            return result.arrangement;
        });
    }, `import ${media.ref.name}`);
    return { clipId, track: lane };
}

export function useAudioImport(onEdit: (updater: (prev: Arrangement) => Arrangement) => void, onPlaced?: (clipId: string) => void) {
    const [status, setStatus] = useState<AudioImportStatus>({ kind: 'idle', text: '' });

    const importFiles = useCallback(async (files: readonly File[], track: AudioTrackKey | null, startStep: number) => {
        if (files.length === 0) return;
        let lane = track;
        const errors: string[] = [];
        let placed = 0;
        for (const file of files) {
            setStatus({ kind: 'busy', text: `Importing ${file.name}…` });
            try {
                const media = await importAudioFile(file);
                peakCache.prime(media.mediaId, media.peaks);
                const result = placeImportedMedia(onEdit, media, lane, startStep);
                if ('error' in result) {
                    errors.push(result.error);
                    break;
                }
                placed++;
                onPlaced?.(result.clipId);
                // The next file of a multi-file drop gets a track of its own.
                lane = null;
            } catch (err) {
                errors.push(err instanceof Error ? err.message : String(err));
            }
        }
        setStatus(errors.length
            ? { kind: 'error', text: errors.join(' · ') }
            : { kind: 'done', text: placed === 1 ? `Imported ${files[0].name}` : `Imported ${placed} files` });
    }, [onEdit, onPlaced]);

    return { status, importFiles };
}
