import type { SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TrackKey } from '../../constants/appDefaults'
import type { TrackParamStorage } from '../../importers/rbs/applyImportedEngineState'
import type { Arrangement, SavedSongData } from '../../types'
import { createDefaultArrangement, liftStructureEdit, projectArrangement } from '../../arrangement/model'
import { transportMixStore, useTransportMixStore } from '../../stores/transportMixStore'

export interface RbsArrangementExtras {
  loopStart?: number;
  loopEnd?: number;
  trackParamStorage?: TrackParamStorage;
  pcfFilter?: SavedSongData['pcfFilter'];
}

type SongStructureRows = ({ [key in TrackKey]: number | null })[];

/**
 * The arrangement (#1342) is the song's linear record and the only stored
 * state. `songStructure` is its Song Mode projection at the current measure
 * length; `setSongStructure` lifts grid edits back into the arrangement.
 */
export function useSongModeState() {
    const [isSongModeOpen, setIsSongModeOpen] = useState(false);
    const [isArrangementOpen, setIsArrangementOpen] = useState(false);
    const [isSongModeActive, setIsSongModeActive] = useState(false);
    const [arrangement, setArrangement] = useState<Arrangement>(
        () => createDefaultArrangement(transportMixStore.meterRef.current.stepCount),
    );
    const stepCount = useTransportMixStore((s) => s.stepCount);
    const songStructure = useMemo<SongStructureRows>(
        () => projectArrangement(arrangement, stepCount),
        [arrangement, stepCount],
    );
    const [currentSongMeasure, setCurrentSongMeasure] = useState(0);

    const arrangementRef = useRef(arrangement);
    useEffect(() => { arrangementRef.current = arrangement; }, [arrangement]);
    const songStructureRef = useRef(songStructure);
    useEffect(() => { songStructureRef.current = songStructure; }, [songStructure]);

    // Reads the live meter, not `stepCount` state, so a loader that applies a
    // new meter and then sets the structure in one tick uses the new length.
    const setSongStructure = useCallback((action: SetStateAction<SongStructureRows>) => {
        setArrangement((prev) => {
            const spm = transportMixStore.meterRef.current.stepCount;
            const before = projectArrangement(prev, spm);
            const after = typeof action === 'function' ? action(before) : action;
            return liftStructureEdit(prev, before, after, spm);
        });
    }, []);

    const isSongModeActiveRef = useRef(isSongModeActive);
    useEffect(() => { isSongModeActiveRef.current = isSongModeActive; }, [isSongModeActive]);
    const songMeasureRef = useRef(0);
    const isFirstStepRef = useRef(true);
    const rbsArrangementExtrasRef = useRef<RbsArrangementExtras | null>(null);

    return {
        isSongModeOpen, setIsSongModeOpen,
        isArrangementOpen, setIsArrangementOpen,
        isSongModeActive, setIsSongModeActive,
        arrangement, setArrangement,
        arrangementRef,
        songStructure, setSongStructure,
        currentSongMeasure, setCurrentSongMeasure,
        songStructureRef,
        isSongModeActiveRef,
        songMeasureRef,
        isFirstStepRef,
        rbsArrangementExtrasRef,
    }
}
