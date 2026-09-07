import { useEffect, useRef, useState } from 'react'
import type { TrackKey } from '../../constants/appDefaults'
import type { TrackParamStorage } from '../../importers/rbs/applyImportedEngineState'
import type { SavedSongData } from '../../types'

export interface RbsArrangementExtras {
  loopStart?: number;
  loopEnd?: number;
  trackParamStorage?: TrackParamStorage;
  pcfFilter?: SavedSongData['pcfFilter'];
}

export function useSongModeState() {
    const [isSongModeOpen, setIsSongModeOpen] = useState(false);
    const [isSongModeActive, setIsSongModeActive] = useState(false);
    const [songStructure, setSongStructure] = useState<({ [key in TrackKey]: number | null })[]>(
        Array(16).fill(null).map(() => ({
            partA: null, partB: null, bass2: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null
        }))
    );
    const [currentSongMeasure, setCurrentSongMeasure] = useState(0);

    const songStructureRef = useRef(songStructure);
    useEffect(() => { songStructureRef.current = songStructure; }, [songStructure]);
    const isSongModeActiveRef = useRef(isSongModeActive);
    useEffect(() => { isSongModeActiveRef.current = isSongModeActive; }, [isSongModeActive]);
    const songMeasureRef = useRef(0);
    const isFirstStepRef = useRef(true);
    const rbsArrangementExtrasRef = useRef<RbsArrangementExtras | null>(null);

    return {
        isSongModeOpen, setIsSongModeOpen,
        isSongModeActive, setIsSongModeActive,
        songStructure, setSongStructure,
        currentSongMeasure, setCurrentSongMeasure,
        songStructureRef,
        isSongModeActiveRef,
        songMeasureRef,
        isFirstStepRef,
        rbsArrangementExtrasRef,
    }
}
