import type { SongCellCoord, SongModeTrackKey } from '../types/songMode';
import { SONG_MODE_TRACKS } from './songModeEditing';

export type SongGridDirection = 'left' | 'right' | 'up' | 'down';

export function keyToSongGridDirection(key: string): SongGridDirection | null {
    switch (key) {
        case 'ArrowLeft':
            return 'left';
        case 'ArrowRight':
            return 'right';
        case 'ArrowUp':
            return 'up';
        case 'ArrowDown':
            return 'down';
        default:
            return null;
    }
}

export function getAdjacentSongCell(
    measure: number,
    track: SongModeTrackKey,
    direction: SongGridDirection,
    measureCount: number,
): SongCellCoord {
    const trackIndex = SONG_MODE_TRACKS.findIndex((r) => r.key === track);
    if (direction === 'left') {
        return { measure: Math.max(0, measure - 1), track };
    }
    if (direction === 'right') {
        return { measure: Math.min(measureCount - 1, measure + 1), track };
    }
    if (direction === 'up' && trackIndex > 0) {
        return { measure, track: SONG_MODE_TRACKS[trackIndex - 1].key };
    }
    if (direction === 'down' && trackIndex >= 0 && trackIndex < SONG_MODE_TRACKS.length - 1) {
        return { measure, track: SONG_MODE_TRACKS[trackIndex + 1].key };
    }
    return { measure, track };
}

export function songCellDomKey(track: SongModeTrackKey, measure: number): string {
    return `${track}-${measure}`;
}
