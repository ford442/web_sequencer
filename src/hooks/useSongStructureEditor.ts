import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useState } from 'react';
import { useUndoRedo } from './useUndoRedo';
import { cloneStructure } from '../utils/songModeEditing';
import type { SongStructure } from '../types/songMode';

export function useSongStructureEditor(
    songStructureRef: RefObject<SongStructure>,
    setSongStructure: Dispatch<SetStateAction<SongStructure>>,
    maxHistory = 50,
) {
    const undoRedo = useUndoRedo<SongStructure>(maxHistory);
    const [revision, setRevision] = useState(0);
    const bump = useCallback(() => setRevision((r) => r + 1), []);

    const editSongStructure = useCallback(
        (updater: (prev: SongStructure) => SongStructure) => {
            undoRedo.push(cloneStructure(songStructureRef.current));
            setSongStructure(updater(songStructureRef.current));
            bump();
        },
        [setSongStructure, songStructureRef, undoRedo, bump],
    );

    const undoSongStructure = useCallback(() => {
        const prev = undoRedo.undo();
        if (prev) {
            setSongStructure(prev);
            bump();
        }
    }, [setSongStructure, undoRedo, bump]);

    const redoSongStructure = useCallback(() => {
        const next = undoRedo.redo();
        if (next) {
            setSongStructure(next);
            bump();
        }
    }, [setSongStructure, undoRedo, bump]);

    const clearSongUndo = useCallback(() => {
        undoRedo.clear();
        bump();
    }, [undoRedo, bump]);

    return {
        editSongStructure,
        undoSongStructure,
        redoSongStructure,
        canUndoSong: undoRedo.canUndo,
        canRedoSong: undoRedo.canRedo,
        clearSongUndo,
        songEditRevision: revision,
    };
}
