import { useCallback } from 'react'
import { NUM_STEPS } from '../../constants'
import { midiToNote, noteToMidi } from '../../utils/musicTheory'
import type { Pattern, PhonemeData } from '../../types'
import type { TrackKey } from '../../constants/appDefaults'
import type { useUndoRedo } from '../useUndoRedo'
import { updateSamplerStep, updateTrackStep, updateSamplerRange, updateTrackRange } from './patternUpdates'

type UndoRedo = ReturnType<typeof useUndoRedo<Pattern>>

export function usePatternHandlers(deps: {
    patternRef: React.MutableRefObject<Pattern>;
    setPattern: React.Dispatch<React.SetStateAction<Pattern>>;
    undoRedo: UndoRedo;
    activeSamplerBankRef: React.MutableRefObject<number>;
    contextMenu: { x: number; y: number; track: TrackKey; step: number } | null;
    setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; track: TrackKey; step: number } | null>>;
    setSelection: React.Dispatch<React.SetStateAction<{ trackKey: TrackKey; startStep: number; endStep: number; } | null>>;
    trackStorageRef: React.MutableRefObject<Record<TrackKey, any[]>>;
    activeTrackSlotsRef: React.MutableRefObject<Record<TrackKey, number>>;
    setTrackStorage: React.Dispatch<React.SetStateAction<Record<TrackKey, any[]>>>;
    setActiveTrackSlots: React.Dispatch<React.SetStateAction<Record<TrackKey, number>>>;
    setSelectedTrack: React.Dispatch<React.SetStateAction<TrackKey>>;
}) {
    const {
        patternRef, setPattern, undoRedo, activeSamplerBankRef,
        contextMenu, setContextMenu, setSelection,
        trackStorageRef, activeTrackSlotsRef, setTrackStorage, setActiveTrackSlots,
        setSelectedTrack,
    } = deps;

    const updateStorageForTrackInner = useCallback((track: TrackKey, sequence: any) => {
        setTrackStorage(prev => {
            const copy = { ...prev };
            copy[track] = [...copy[track]];
            copy[track][activeTrackSlotsRef.current[track]] = sequence;
            return copy;
        });
    }, [setTrackStorage, activeTrackSlotsRef]);

    const handlePatternChange = useCallback((rowKey: keyof Pattern, i: number, _subIndex?: number | unknown, updates?: { length?: number, slide?: boolean, chord?: string[], sliceIndex?: number }) => {
        undoRedo.push(patternRef.current);
        const prev = patternRef.current;
        const copy = { ...prev };
        let changedSequence;
        if (rowKey === 'sampler') {
            const bankIndex = activeSamplerBankRef.current;
            const newSampler = [...prev.sampler];
            newSampler[bankIndex] = { ...newSampler[bankIndex], steps: [...newSampler[bankIndex].steps] };
            const steps = newSampler[bankIndex].steps;
            const existing = steps[i];
            if (updates) {
                if (existing) {
                    const newStep = { ...existing };
                    if (updates.length !== undefined) newStep.length = updates.length;
                    if (updates.slide !== undefined) newStep.slide = updates.slide;
                    if (updates.chord !== undefined) newStep.chord = updates.chord;
                    if (updates.sliceIndex !== undefined) newStep.sliceIndex = updates.sliceIndex;
                    steps[i] = newStep;
                    if (updates.length !== undefined) { for (let k = 1; k < updates.length; k++) { const nextStepIdx = i + k; if (nextStepIdx < steps.length) { steps[nextStepIdx] = null; } } }
                }
            } else { if (existing) { steps[i] = null; } else { steps[i] = { note: 'C4', velocity: 1, length: 1, slide: false }; } }
            copy.sampler = newSampler;
            changedSequence = newSampler;
        } else {
            copy[rowKey] = { ...prev[rowKey], steps: [...prev[rowKey].steps] };
            const steps = copy[rowKey].steps;
            const existing = steps[i];
            if (updates) {
                if (existing) {
                    const newStep = { ...existing };
                    if (updates.length !== undefined) newStep.length = updates.length;
                    if (updates.slide !== undefined) newStep.slide = updates.slide;
                    if (updates.chord !== undefined) newStep.chord = updates.chord;
                    steps[i] = newStep;
                    if (updates.length !== undefined) { for (let k = 1; k < updates.length; k++) { const nextStepIdx = i + k; if (nextStepIdx < steps.length) { steps[nextStepIdx] = null; } } }
                }
            } else { if (existing) { steps[i] = null; } else { const defaultNote = rowKey.startsWith('part') ? (rowKey === 'partA' ? 'C4' : 'C3') : 'C4'; steps[i] = { note: defaultNote, velocity: 1, length: 1, slide: false }; } }
            changedSequence = copy[rowKey];
        }
        setPattern(copy);
        updateStorageForTrackInner(rowKey as TrackKey, changedSequence);
    }, [updateStorageForTrackInner, undoRedo, patternRef, activeSamplerBankRef, setPattern]);

    const handleStepToggle = useCallback((rowKey: TrackKey, index: number, e: any) => {
        if (e.altKey) { e.preventDefault(); let step = null; if (rowKey === 'sampler') { step = patternRef.current.sampler[activeSamplerBankRef.current].steps[index]; } else { step = patternRef.current[rowKey].steps[index]; } if (step) { handlePatternChange(rowKey, index, undefined, { slide: !step.slide }); } return; }
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); let step = null; if (rowKey === 'sampler') { step = patternRef.current.sampler[activeSamplerBankRef.current].steps[index]; } else { step = patternRef.current[rowKey].steps[index]; } if (step) { if (step.chord && step.chord.length > 0) { handlePatternChange(rowKey, index, undefined, { chord: [] }); } else { const root = noteToMidi(step.note); const chord = [midiToNote(root + 4), midiToNote(root + 7)]; handlePatternChange(rowKey, index, undefined, { chord }); } } return; }
        const pattern = patternRef.current;
        let step = null;
        if (rowKey === 'sampler') { step = pattern.sampler[activeSamplerBankRef.current].steps[index]; }
        else { step = pattern[rowKey].steps[index]; }
        const isActive = !!step;
        if (isActive) {
            setSelection({ trackKey: rowKey, startStep: index, endStep: index });
            return;
        }
        handlePatternChange(rowKey, index, e);
    }, [handlePatternChange, patternRef, activeSamplerBankRef, setSelection]);

    const handlePitchChange = useCallback((trackKey: TrackKey, step: number, pitch: number) => {
        if (trackKey !== 'sampler') return;
        const note = midiToNote(pitch);
        setPattern(prev => {
            const bankIdx = activeSamplerBankRef.current;
            const updater = (stepData: any) => stepData ? { ...stepData, note } : { note, velocity: 1, length: 1 };
            const newPattern = updateSamplerStep(prev, bankIdx, step, updater);
            updateStorageForTrackInner('sampler', newPattern.sampler);
            return newPattern;
        });
    }, [updateStorageForTrackInner, activeSamplerBankRef, setPattern]);

    const handlePhonemeUpdate = useCallback((
        trackKey: TrackKey,
        bankIndex: number,
        step: number,
        phonemes: PhonemeData[] | undefined
    ) => {
        if (trackKey !== 'sampler') return;
        setPattern(prev => {
            const newPattern = { ...prev };
            const newSampler = [...newPattern.sampler];
            const newBank = { ...newSampler[bankIndex] };
            newBank.steps = [...newBank.steps];
            if (newBank.steps[step]) {
                newBank.steps[step] = { ...newBank.steps[step]!, phonemes };
            } else {
                newBank.steps[step] = { note: 'C4', velocity: 1, length: 1, phonemes };
            }
            newSampler[bankIndex] = newBank;
            newPattern.sampler = newSampler;
            updateStorageForTrackInner('sampler', newSampler);
            return newPattern;
        });
    }, [updateStorageForTrackInner, setPattern]);

    const handleNoteSelect = useCallback((note: string) => {
        if (!contextMenu) return;

        const trackKey = contextMenu.track as TrackKey;
        const stepIndex = contextMenu.step;

        setPattern(prev => {
            const updater = (stepData: any) => stepData ? { ...stepData, note } : { note, velocity: 1, length: 1 };

            let newPattern;
            let changedSequence;

            if (trackKey === 'sampler') {
                const bankIdx = activeSamplerBankRef.current;
                newPattern = updateSamplerStep(prev, bankIdx, stepIndex, updater);
                changedSequence = newPattern.sampler;
            } else {
                newPattern = updateTrackStep(prev, trackKey, stepIndex, updater);
                changedSequence = newPattern[trackKey];
            }

            updateStorageForTrackInner(trackKey, changedSequence);
            return newPattern;
        });

        setContextMenu(null);
    }, [contextMenu, updateStorageForTrackInner, activeSamplerBankRef, setPattern, setContextMenu]);

    const handleNoteLengthChange = useCallback((newLength: number) => {
        if (!contextMenu) return;

        const prev = patternRef.current;
        const trackKey = contextMenu.track;
        const stepIndex = contextMenu.step;

        let newPattern = prev;

        if (trackKey === 'sampler') {
            const bankIdx = activeSamplerBankRef.current;
            newPattern = updateSamplerStep(newPattern, bankIdx, stepIndex, (stepData) => stepData ? { ...stepData, length: newLength } : stepData);
            if (newLength > 1) {
                newPattern = updateSamplerRange(newPattern, bankIdx, stepIndex + 1, Math.min(stepIndex + newLength - 1, 255), () => null);
            }
            updateStorageForTrackInner(trackKey, newPattern.sampler);
        } else {
            newPattern = updateTrackStep(newPattern, trackKey, stepIndex, (stepData) => stepData ? { ...stepData, length: newLength } : stepData);
            if (newLength > 1) {
                newPattern = updateTrackRange(newPattern, trackKey, stepIndex + 1, Math.min(stepIndex + newLength - 1, 255), () => null);
            }
            updateStorageForTrackInner(trackKey, newPattern[trackKey]);
        }

        setPattern(newPattern);
        setContextMenu(null);
    }, [contextMenu, updateStorageForTrackInner, patternRef, activeSamplerBankRef, setPattern, setContextMenu]);

    const handleNotePropertyChange = useCallback((
        key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze' | 'formantShift' | 'formantPitchLink' |
             'filterCutoff' | 'filterResonance' | 'envMod' |
             'formantLfoSync' | 'formantLfoRate' | 'formantLfoDepth' |
             'freezeLfoSync' | 'freezeLfoRate' | 'freezeLfoDepth' |
             'formantEnvAttack' | 'formantEnvDecay' | 'formantEnvAmount' | 'formantEnvFollower' | 'formantSidechainDepth' | 'formantEnvSync' |
             'vibratoDepth' | 'drive' | 'characterMorph' |
             'reverbSend' | 'reverbType' | 'reverbLfoRate' | 'reverbLfoDepth' |
             'delayLfoRate' | 'delayLfoDepth' | 'delaySend' |
             'freezeEnvDepth' | 'timeStretchEnvDepth' | 'spectralPanRate' | 'spectralPanDepth' | 'slideFormant' | 'tremoloRate' | 'tremoloDepth' | 'pan' | 'glitchChance' |
             'grainEnvDepth' | 'grainPitchEnvDepth' | 'grainJitter' | 'grainPitchQuantize' | 'granularPitchShift' |
             'choir' | 'gateDepth' | 'gateRate' | 'tranceGate' | 'bitcrush' | 'downsample' | 'vocoderMix' | 'vocoderFormantShift' | 'vocoderPreservation' | 'vocoderAttack' | 'vocoderRelease' | 'pitchAmount' |
             'spectralPanRate' | 'spectralPanDepth' | 'slideFormant' | 'tremoloRate' | 'tremoloDepth' |
             'vowel' | 'portamento' | 'slideFormant' | 'pitchAttack' | 'pitchDecay' | 'pitchAmount',
        value: number | boolean | string
    ) => {
        if (!contextMenu) return;

        const trackKey = contextMenu.track;
        const stepIndex = contextMenu.step;
        const prev = patternRef.current;

        const updater = (stepData: any) => {
            if (!stepData) return stepData;
            const newStep = { ...stepData };

            if (key === 'reverse' || 
                key === 'formantEnvSync' || 
                key === 'formantLfoSync' || 
                key === 'freezeLfoSync') {
                if (typeof value === 'boolean') newStep[key] = value;
            } 
            else if (key === 'reverbType') {
                if (typeof value === 'string') newStep[key] = value;
            } 
            else {
                if (typeof value === 'number') newStep[key] = value;
            }

            return newStep;
        };

        let newPattern;
        let changedSequence;
        if (trackKey === 'sampler') {
            const bankIdx = activeSamplerBankRef.current;
            newPattern = updateSamplerStep(prev, bankIdx, stepIndex, updater);
            changedSequence = newPattern.sampler;
        } else {
            newPattern = updateTrackStep(prev, trackKey, stepIndex, updater);
            changedSequence = newPattern[trackKey];
        }

        updateStorageForTrackInner(trackKey, changedSequence);
        setPattern(newPattern);
    }, [contextMenu, updateStorageForTrackInner, patternRef, activeSamplerBankRef, setPattern]);

    const handleClearPattern = useCallback(() => {
        if (window.confirm("Clear current pattern?")) {
            const emptyPattern: Pattern = {
                partA: { steps: Array(32).fill(null) },
                partB: { steps: Array(32).fill(null) },
                bass2: { steps: Array(32).fill(null) },
                kick: { steps: Array(32).fill(null) },
                snare: { steps: Array(32).fill(null) },
                closedHat: { steps: Array(32).fill(null) },
                openHat: { steps: Array(32).fill(null) },
                sampler: Array.from({ length: 8 }, () => ({ steps: Array(32).fill(null) })),
            };
            setPattern(emptyPattern);
            setTrackStorage(prevStorage => {
                const storageCopy = { ...prevStorage };
                (Object.keys(storageCopy) as TrackKey[]).forEach(key => {
                    storageCopy[key] = [...storageCopy[key]];
                    storageCopy[key][activeTrackSlotsRef.current[key]] = emptyPattern[key];
                });
                return storageCopy;
            });
        }
    }, [setPattern, setTrackStorage, activeTrackSlotsRef]);

    const handleTrackSlotClick = useCallback((track: TrackKey, slotIndex: number) => {
        const currentTrackPattern = track === 'sampler' ? patternRef.current.sampler : patternRef.current[track];
        const storedPattern = trackStorageRef.current[track][slotIndex];
        if (storedPattern) {
            setPattern(prev => ({ ...prev, [track]: storedPattern }));
            setActiveTrackSlots(prev => ({ ...prev, [track]: slotIndex }));
        } else {
            setTrackStorage(prev => {
                const copy = { ...prev };
                copy[track] = [...prev[track]];
                copy[track][slotIndex] = currentTrackPattern;
                return copy;
            });
            setActiveTrackSlots(prev => ({ ...prev, [track]: slotIndex }));
        }
    }, [patternRef, trackStorageRef, setPattern, setTrackStorage, setActiveTrackSlots]);

    const handleSelectRow = useCallback((k: any) => setSelectedTrack(k as TrackKey), [setSelectedTrack]);

    const handleEditLength = useCallback((k: TrackKey, i: number, len: number) => {
        handlePatternChange(k, i, undefined, { length: len });
    }, [handlePatternChange]);

    return {
        updateStorageForTrack: updateStorageForTrackInner,
        handlePatternChange,
        handleStepToggle,
        handlePitchChange,
        handlePhonemeUpdate,
        handleNoteSelect,
        handleNoteLengthChange,
        handleNotePropertyChange,
        handleClearPattern,
        handleTrackSlotClick,
        handleSelectRow,
        handleEditLength,
    };
}
