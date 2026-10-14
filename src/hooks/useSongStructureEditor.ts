import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { useCallback, useState } from 'react';
import { useUndoRedo } from './useUndoRedo';
import type { SongStructure } from '../types/songMode';
import type { Arrangement } from '../types/song';

/**
 * Undo/redo for the song record. History holds whole arrangements (immutable
 * values, so no clone), which makes Song Mode grid edits and Arrangement view
 * edits share one stack and undo a trim exactly.
 */
export function useSongStructureEditor(
    songStructureRef: RefObject<SongStructure>,
    setSongStructure: Dispatch<SetStateAction<SongStructure>>,
    arrangementRef: MutableRefObject<Arrangement>,
    setArrangement: Dispatch<SetStateAction<Arrangement>>,
    maxHistory = 50,
) {
    const undoRedo = useUndoRedo<Arrangement>(maxHistory);
    const [revision, setRevision] = useState(0);
    const bump = useCallback(() => setRevision((r) => r + 1), []);

    const editSongStructure = useCallback(
        (updater: (prev: SongStructure) => SongStructure) => {
            undoRedo.push(arrangementRef.current);
            setSongStructure(updater(songStructureRef.current));
            bump();
        },
        [setSongStructure, songStructureRef, arrangementRef, undoRedo, bump],
    );

    const editArrangement = useCallback(
        (updater: (prev: Arrangement) => Arrangement) => {
            const prev = arrangementRef.current;
            const next = updater(prev);
            if (next === prev) return;
            undoRedo.push(prev);
            // Sync now: a key-repeat edit can land before the state effect runs.
            arrangementRef.current = next;
            setArrangement(next);
            bump();
        },
        [setArrangement, arrangementRef, undoRedo, bump],
    );

    const undoSongStructure = useCallback(() => {
        const prev = undoRedo.undo();
        if (prev) {
            arrangementRef.current = prev;
            setArrangement(prev);
            bump();
        }
    }, [setArrangement, arrangementRef, undoRedo, bump]);

    const redoSongStructure = useCallback(() => {
        const next = undoRedo.redo();
        if (next) {
            arrangementRef.current = next;
            setArrangement(next);
            bump();
        }
    }, [setArrangement, arrangementRef, undoRedo, bump]);

    const clearSongUndo = useCallback(() => {
        undoRedo.clear();
        bump();
    }, [undoRedo, bump]);

    return {
        editSongStructure,
        editArrangement,
        undoSongStructure,
        redoSongStructure,
        canUndoSong: undoRedo.canUndo,
        canRedoSong: undoRedo.canRedo,
        clearSongUndo,
        songEditRevision: revision,
    };
}
