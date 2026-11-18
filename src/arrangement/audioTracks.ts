/**
 * Audio tracks and the media table (#1629, song v6): pure functions over
 * `AudioTrackState`, the value `audioTrackStore` holds and the project doc
 * binds as `audioTracks` + `media`.
 *
 * A song has at most `MAX_AUDIO_TRACKS` audio tracks, keyed `audio-1` …
 * `audio-8`; each is a fixed `audioTrackVoice` socket in the patch, so adding
 * a track never rebuilds the graph. A v5 song has none (the v6 migration adds
 * nothing). Mute and solo are runtime state (`trackMuteSoloStore`), like the
 * pattern tracks'.
 */
import { AUDIO_TRACK_KEYS, MAX_AUDIO_TRACKS, MEDIA_ID_PATTERN } from '@/constants';
import type { Arrangement, AudioTrack, AudioTrackKey, MediaRef } from '@/types/song';
import { isAudioClip, isAudioTrackKey } from './model';

export interface AudioTrackState {
    /** In lane order. */
    readonly tracks: readonly AudioTrack[];
    /** By media id. */
    readonly media: Readonly<Record<string, MediaRef>>;
}

export const EMPTY_AUDIO_TRACK_STATE: AudioTrackState = Object.freeze({ tracks: Object.freeze([]), media: Object.freeze({}) });

/** Fader range in dB. */
export const AUDIO_TRACK_GAIN_DB_RANGE = [-60, 6] as const;

export function defaultAudioTrack(id: AudioTrackKey): AudioTrack {
    return { id, name: `Audio ${id.slice('audio-'.length)}`, gainDb: 0, pan: 0 };
}

const keyOrder = (id: AudioTrackKey) => (AUDIO_TRACK_KEYS as readonly string[]).indexOf(id);

/** The first audio track key the state does not use, or null when all are taken. */
export function freeAudioTrackKey(state: AudioTrackState): AudioTrackKey | null {
    const used = new Set<string>(state.tracks.map((t) => t.id));
    return AUDIO_TRACK_KEYS.find((key) => !used.has(key)) ?? null;
}

/** Add a track (the first free key, or `id`). Unchanged when it exists or none is free. */
export function addAudioTrack(state: AudioTrackState, id?: AudioTrackKey): { state: AudioTrackState; id: AudioTrackKey | null } {
    const key = id ?? freeAudioTrackKey(state);
    if (!key || state.tracks.length >= MAX_AUDIO_TRACKS) return { state, id: null };
    if (state.tracks.some((t) => t.id === key)) return { state, id: key };
    const tracks = [...state.tracks, defaultAudioTrack(key)].sort((a, b) => keyOrder(a.id) - keyOrder(b.id));
    return { state: { ...state, tracks }, id: key };
}

/** Change one track's strip (name, fader, pan). */
export function updateAudioTrack(
    state: AudioTrackState,
    id: AudioTrackKey,
    patch: Partial<Omit<AudioTrack, 'id'>>,
): AudioTrackState {
    const index = state.tracks.findIndex((t) => t.id === id);
    if (index < 0) return state;
    const next = normalizeAudioTrack({ ...state.tracks[index], ...patch });
    if (!next) return state;
    const tracks = state.tracks.slice();
    tracks[index] = next;
    return { ...state, tracks };
}

/** Remove a track. Its clips stay in the arrangement until the caller removes them. */
export function removeAudioTrack(state: AudioTrackState, id: AudioTrackKey): AudioTrackState {
    const tracks = state.tracks.filter((t) => t.id !== id);
    return tracks.length === state.tracks.length ? state : { ...state, tracks };
}

/** Record what the song knows about a piece of media (an import, a recorded take). */
export function registerMedia(state: AudioTrackState, id: string, ref: MediaRef): AudioTrackState {
    const current = state.media[id];
    if (current && current.name === ref.name && current.sampleRate === ref.sampleRate
        && current.channels === ref.channels && current.frames === ref.frames) {
        return state;
    }
    return { ...state, media: { ...state.media, [id]: { ...ref } } };
}

/** Media ids the arrangement's audio clips reference, in clip order. */
export function referencedMedia(arrangement: Arrangement): string[] {
    const ids = new Set<string>();
    for (const clip of arrangement.clips) if (isAudioClip(clip)) ids.add(clip.mediaId);
    return [...ids];
}

/**
 * Every track an audio clip sits on exists (a hand-edited or partly merged
 * song may lack one). Returns the state itself when nothing was missing.
 */
export function withTracksForClips(state: AudioTrackState, arrangement: Arrangement): AudioTrackState {
    let next = state;
    for (const clip of arrangement.clips) {
        if (isAudioClip(clip) && !next.tracks.some((t) => t.id === clip.track)) {
            next = addAudioTrack(next, clip.track).state;
        }
    }
    return next;
}

// ---------------------------------------------------------------------------
// Load-time validation
// ---------------------------------------------------------------------------

function finite(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function normalizeAudioTrack(raw: unknown): AudioTrack | null {
    if (!raw || typeof raw !== 'object') return null;
    const t = raw as Record<string, unknown>;
    if (!isAudioTrackKey(t.id)) return null;
    const [minDb, maxDb] = AUDIO_TRACK_GAIN_DB_RANGE;
    return {
        id: t.id,
        name: typeof t.name === 'string' && t.name.trim() ? t.name.slice(0, 64) : defaultAudioTrack(t.id).name,
        gainDb: finite(t.gainDb, 0, minDb, maxDb),
        pan: finite(t.pan, 0, -1, 1),
    };
}

/** A persisted `audioTracks` list: unknown keys and duplicates dropped, lane order restored. */
export function normalizeAudioTracks(raw: unknown): AudioTrack[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: AudioTrack[] = [];
    for (const item of raw as unknown[]) {
        const track = normalizeAudioTrack(item);
        if (!track || seen.has(track.id)) continue;
        seen.add(track.id);
        out.push(track);
    }
    return out.sort((a, b) => keyOrder(a.id) - keyOrder(b.id));
}

/** A persisted `media` table: entries with a bad id or impossible format dropped. */
export function normalizeMediaTable(raw: unknown): Record<string, MediaRef> {
    const out: Record<string, MediaRef> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!MEDIA_ID_PATTERN.test(id) || !value || typeof value !== 'object') continue;
        const m = value as Record<string, unknown>;
        const sampleRate = m.sampleRate;
        const channels = m.channels;
        const frames = m.frames;
        if (typeof sampleRate !== 'number' || !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 768_000) continue;
        if (typeof channels !== 'number' || !Number.isInteger(channels) || channels < 1 || channels > 32) continue;
        if (typeof frames !== 'number' || !Number.isInteger(frames) || frames < 0) continue;
        out[id] = { name: typeof m.name === 'string' ? m.name.slice(0, 256) : '', sampleRate, channels, frames };
    }
    return out;
}

/** The audio-track state of a loaded song; every clip's track exists. */
export function audioTrackStateOf(
    song: { audioTracks?: unknown; media?: unknown },
    arrangement: Arrangement | null,
): AudioTrackState {
    const state: AudioTrackState = { tracks: normalizeAudioTracks(song.audioTracks), media: normalizeMediaTable(song.media) };
    const filled = arrangement ? withTracksForClips(state, arrangement) : state;
    return filled.tracks.length === 0 && Object.keys(filled.media).length === 0 ? EMPTY_AUDIO_TRACK_STATE : filled;
}
