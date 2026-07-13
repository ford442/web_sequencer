import { useCallback, useEffect } from 'react'
import { copySteps, pasteSteps } from '../../utils/clipboardUtils'
import type { Note, Pattern } from '../../types'
import type { TrackKey } from '../../constants/appDefaults'
import type { useUndoRedo } from '../useUndoRedo'
import { updateSamplerRange, updateTrackRange } from './patternUpdates'

type UndoRedo = ReturnType<typeof useUndoRedo<Pattern>>

export function useClipboardHandlers(deps: {
    selection: { trackKey: TrackKey; startStep: number; endStep: number; } | null;
    selectedTrack: TrackKey;
    clipboard: (Note | null)[] | null;
    setClipboard: React.Dispatch<React.SetStateAction<(Note | null)[] | null>>;
    setPattern: React.Dispatch<React.SetStateAction<Pattern>>;
    setSelection: React.Dispatch<React.SetStateAction<{ trackKey: TrackKey; startStep: number; endStep: number; } | null>>;
    patternRef: React.MutableRefObject<Pattern>;
    activeSamplerBankRef: React.MutableRefObject<number>;
    undoRedo: UndoRedo;
    updateStorageForTrack: (track: TrackKey, sequence: any) => void;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    handleSelectionEnd: () => void;
    audioEngine: { triggerTapeStop?: (duration: number) => void } | null | undefined;
}) {
    const {
        selection, selectedTrack, clipboard, setClipboard, setPattern, setSelection,
        patternRef, activeSamplerBankRef, undoRedo, updateStorageForTrack, showToast,
        handleSelectionEnd, audioEngine,
    } = deps;

    const handleCopy = useCallback(() => {
        if (!selection) return;
        const copied = copySteps(patternRef.current, selection, activeSamplerBankRef.current);
        if (copied) {
            setClipboard(copied);
            showToast("Copied to clipboard!", "success");
        }
    }, [selection, showToast, patternRef, activeSamplerBankRef, setClipboard]);

    const handlePaste = useCallback(() => {
        if (!clipboard) return;
        let targetTrack = selectedTrack;
        let targetStep = 0;
        if (selection) {
            targetTrack = selection.trackKey;
            targetStep = selection.startStep;
        } else {
             if (!window.confirm(`Paste from clipboard to start of ${targetTrack}?`)) return;
        }
        undoRedo.push(patternRef.current);
        const newPattern = pasteSteps(patternRef.current, clipboard, targetTrack, targetStep, activeSamplerBankRef.current);
        setPattern(newPattern);
        let changedSequence;
        if (targetTrack === 'sampler') {
            changedSequence = newPattern.sampler;
        } else {
            changedSequence = newPattern[targetTrack];
        }
        updateStorageForTrack(targetTrack, changedSequence);
        showToast("Pasted from clipboard!", "success");
    }, [clipboard, selection, selectedTrack, showToast, updateStorageForTrack, undoRedo, patternRef, activeSamplerBankRef, setPattern]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                e.preventDefault();
                handleCopy();
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault();
                handlePaste();
            }

            if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
                const { trackKey, startStep, endStep } = selection;
                const low = Math.min(startStep, endStep);
                const high = Math.max(startStep, endStep);

                setPattern(prev => {
                    let newPattern;
                    if (trackKey === 'sampler') {
                        const bankIdx = activeSamplerBankRef.current;
                        newPattern = updateSamplerRange(prev, bankIdx, low, high, () => null);
                        updateStorageForTrack(trackKey, newPattern.sampler);
                    } else {
                        newPattern = updateTrackRange(prev, trackKey, low, high, () => null);
                        updateStorageForTrack(trackKey, newPattern[trackKey]);
                    }
                    return newPattern;
                });

                setSelection(null);
            }

            if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                audioEngine?.triggerTapeStop?.(2.0);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('mouseup', handleSelectionEnd);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('mouseup', handleSelectionEnd);
        };
    }, [selection, handleSelectionEnd, updateStorageForTrack, handleCopy, handlePaste, activeSamplerBankRef, setPattern, setSelection, audioEngine]);

    return { handleCopy, handlePaste };
}
