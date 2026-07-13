import type { TrackKey } from '../constants/appDefaults';

/** Tracks shown in song arrangement grid (matches persisted songStructure rows). */
export type SongModeTrackKey = TrackKey;

export type SongMeasure = Record<SongModeTrackKey, number | null>;

export type SongStructure = SongMeasure[];

export interface SongCellCoord {
    measure: number;
    track: SongModeTrackKey;
}

export interface SongSegmentClipboard {
    /** Relative cell offsets from anchor */
    cells: Array<{ dMeasure: number; track: SongModeTrackKey; value: number | null }>;
    width: number;
    height: number;
}
