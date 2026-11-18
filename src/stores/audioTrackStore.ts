/**
 * The song's audio tracks and media table (#1629, v6): `SavedSongData.audioTracks`
 * and `.media`, bound to the project doc like the arrangement (`appBindings.ts`).
 * Edits go through the pure functions in `arrangement/audioTracks.ts`.
 */

import { EMPTY_AUDIO_TRACK_STATE, type AudioTrackState } from '../arrangement/audioTracks';
import { createValueStore } from './valueStore';

export const audioTrackStore = createValueStore<AudioTrackState>(EMPTY_AUDIO_TRACK_STATE);
