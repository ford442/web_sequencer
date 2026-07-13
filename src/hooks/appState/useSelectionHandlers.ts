import { useCallback, useEffect, useRef } from 'react'
import type { TrackKey } from '../../constants/appDefaults'

export function useSelectionHandlers(
    selection: { trackKey: TrackKey; startStep: number; endStep: number; } | null,
    isSelecting: boolean,
    setSelection: React.Dispatch<React.SetStateAction<{ trackKey: TrackKey; startStep: number; endStep: number; } | null>>,
    setIsSelecting: React.Dispatch<React.SetStateAction<boolean>>,
) {
    const isSelectingRef = useRef(isSelecting);
    const selectionRef = useRef<typeof selection>(selection);

    useEffect(() => {
        isSelectingRef.current = isSelecting;
    }, [isSelecting]);

    useEffect(() => {
        selectionRef.current = selection;
    }, [selection]);

    const handleSelectionStart = useCallback((trackKey: TrackKey, stepIndex: number) => {
        setSelection({ trackKey, startStep: stepIndex, endStep: stepIndex });
        setIsSelecting(true);
    }, [setSelection, setIsSelecting]);

    const handleSelectionEnter = useCallback((trackKey: TrackKey, stepIndex: number) => {
        const selecting = isSelectingRef.current;
        const currentSelection = selectionRef.current;
        if (selecting && currentSelection && currentSelection.trackKey === trackKey) {
            setSelection(prev => prev ? { ...prev, endStep: stepIndex } : null);
        }
    }, [setSelection]);

    const handleSelectionEnd = useCallback(() => { setIsSelecting(false); }, [setIsSelecting]);

    return {
        handleSelectionStart,
        handleSelectionEnter,
        handleSelectionEnd,
    };
}
