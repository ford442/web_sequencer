/**
 * The song's linear record and its clip launcher (#1597 P2): the arrangement
 * (#1342) and the session document — `SavedSongData.arrangement` and
 * `.session`.
 *
 * Both used to be `useState`s (in `useSongModeState` and `useSessionState`)
 * with refs synced in effects. As external stores their writes are
 * synchronous, so the project doc binding sees each one inside the editor
 * scope that made it, and undo / a peer's edit can put a value back without a
 * render in between.
 */

import type { Arrangement } from '../types/song';
import type { SessionDocument } from '../session/types';
import { createDefaultArrangement } from '../arrangement/model';
import { createDefaultSessionDocument } from '../session/defaults';
import { transportMixStore } from './transportMixStore';
import { createValueStore } from './valueStore';

export const arrangementStore = createValueStore<Arrangement>(
    () => createDefaultArrangement(transportMixStore.meterRef.current.stepCount),
);

export const sessionDocumentStore = createValueStore<SessionDocument>(() => createDefaultSessionDocument());
