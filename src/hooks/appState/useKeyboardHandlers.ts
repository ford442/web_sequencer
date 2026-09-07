import { useCallback, useEffect } from 'react'
import { midiToNote, noteToMidi } from '../../utils/musicTheory'
import type {
    AudioEngine, Pattern, SynthParams, DrumSound,
    Bass2Params, KickParams, SnareParams, HatParams, SamplerParams, SamplerVoiceParams,
} from '../../types'
import type { TrackKey } from '../../constants/appDefaults'
import type { PartSequence } from '../../types'
import { updateSamplerStep, updateTrackStep } from './patternUpdates'

export function useKeyboardHandlers(deps: {
    audioEngine: AudioEngine | null;
    selectedTrack: TrackKey;
    isRecording: boolean;
    isPlaying: boolean;
    isNoteDragging: boolean;
    isDrawing: boolean;
    activeSamplerBank: number;
    setPattern: React.Dispatch<React.SetStateAction<Pattern>>;
    setIsNoteDragging: React.Dispatch<React.SetStateAction<boolean>>;
    setIsDrawing: React.Dispatch<React.SetStateAction<boolean>>;
    setDrawMode: React.Dispatch<React.SetStateAction<'add' | 'remove' | null>>;
    setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; track: TrackKey; step: number } | null>>;
    patternRef: React.MutableRefObject<Pattern>;
    activeSamplerBankRef: React.MutableRefObject<number>;
    currentStepRef: React.MutableRefObject<number>;
    synthARef: React.MutableRefObject<SynthParams>;
    synthBRef: React.MutableRefObject<SynthParams>;
    bass2Ref: React.MutableRefObject<Bass2Params>;
    kickRef: React.MutableRefObject<KickParams>;
    snareRef: React.MutableRefObject<SnareParams>;
    closedHatRef: React.MutableRefObject<HatParams>;
    openHatRef: React.MutableRefObject<HatParams>;
    samplerRef: React.MutableRefObject<SamplerParams>;
    samplerVoiceParamsRef: React.MutableRefObject<SamplerVoiceParams>;
    activeKeyboardNotesRef: React.MutableRefObject<Map<string, number>>;
    noteDragRef: React.MutableRefObject<{ track: TrackKey; step: number; startY: number; startMidi: number; hasMoved: boolean; lastMidi: number; pendingSequence?: PartSequence | PartSequence[]; } | null>;
    updateStorageForTrack: (track: TrackKey, sequence: PartSequence | PartSequence[]) => void;
}) {
    const {
        audioEngine, selectedTrack, isRecording, isPlaying, isNoteDragging, isDrawing,
        activeSamplerBank, setPattern, setIsNoteDragging, setIsDrawing, setDrawMode, setContextMenu,
        patternRef, activeSamplerBankRef, currentStepRef,
        synthARef, synthBRef, bass2Ref, kickRef, snareRef, closedHatRef, openHatRef,
        samplerRef, samplerVoiceParamsRef, activeKeyboardNotesRef, noteDragRef,
        updateStorageForTrack,
    } = deps;

    const handleDrumPadPlay = useCallback((sound: DrumSound, velocity = 1.0) => {
        if (!audioEngine) return;

        const time = audioEngine.context.currentTime;
        const paramsBySound = {
            kick: kickRef.current,
            snare: snareRef.current,
            closedHat: closedHatRef.current,
            openHat: openHatRef.current,
        } as const;
        const params = paramsBySound[sound];
        const scaledParams = velocity === 1
            ? params
            : { ...params, volume: params.volume * velocity };

        audioEngine.playDrum(sound, scaledParams, time);
    }, [audioEngine, kickRef, snareRef, closedHatRef, openHatRef]);

    const handleKeyboardPlay = useCallback((note: string) => {
        if (!audioEngine) return;

        const time = audioEngine.context.currentTime;

        if (selectedTrack === 'partA') {
            const maybe = audioEngine.noteOnSynth?.(synthARef.current, note, time, 'partA');
            void Promise.resolve(maybe).then((id) => {
                if (id != null) activeKeyboardNotesRef.current.set(note, id);
            });
        }
        else if (selectedTrack === 'partB') {
            const maybe = audioEngine.noteOnSynth?.(synthBRef.current, note, time, 'partB');
            void Promise.resolve(maybe).then((id) => {
                if (id != null) activeKeyboardNotesRef.current.set(note, id);
            });
        }
        else if (selectedTrack === 'bass2') {
            const bass2Params: SynthParams = {
                waveform: bass2Ref.current.waveform,
                pitch: bass2Ref.current.pitch,
                filterCutoff: bass2Ref.current.cutoff,
                filterResonance: bass2Ref.current.resonance,
                filterMode: bass2Ref.current.filterMode,
                attack: 0.01,
                decay: bass2Ref.current.decay,
                sustain: 0,
                release: 0.1,
                length: 0.25,
                volume: bass2Ref.current.volume,
                delayTime: 0,
                delayFeedback: 0,
                delayMix: 0,
            };
            const maybe = audioEngine.noteOnSynth?.(bass2Params, note, time, 'bass2');
            void Promise.resolve(maybe).then((id) => {
                if (id != null) activeKeyboardNotesRef.current.set(note, id);
            });
        }
        else if (selectedTrack === 'kick') {
            audioEngine.playDrum('kick', kickRef.current, time, null, undefined, note);
        } 
        else if (selectedTrack === 'snare') {
            audioEngine.playDrum('snare', snareRef.current, time, null, undefined, note);
        } 
        else if (selectedTrack === 'closedHat') {
            audioEngine.playDrum('closedHat', closedHatRef.current, time, null, undefined, note);
        } 
        else if (selectedTrack === 'openHat') {
            audioEngine.playDrum('openHat', openHatRef.current, time, null, undefined, note);
        } 
        else if (selectedTrack === 'sampler') {
            const voiceParams = samplerVoiceParamsRef.current;
            const bankParams = {
                ...samplerRef.current[activeSamplerBankRef.current],
                rootNote: voiceParams.rootNote,
                coarseTune: voiceParams.coarseTune,
                fineTune: voiceParams.fineTune,
                formantShift: voiceParams.formantShift,
                attack: voiceParams.attack,
                decay: voiceParams.decay,
                vibratoDepth: voiceParams.vibratoDepth,
                tremoloDepth: voiceParams.tremoloDepth,
                breathIntensity: voiceParams.breathAmount,
                expressiveness: {
                    vibratoRate: voiceParams.vibratoRate,
                    vibratoDepth: voiceParams.vibratoDepth,
                    tremoloDepth: voiceParams.tremoloDepth,
                    breathAmount: voiceParams.breathAmount,
                },
                stretchProfile: voiceParams.stretchProfile,
                stretchMode: voiceParams.stretchMode,
                lockToSequencer: voiceParams.lockToSequencer,
            };
            const id = audioEngine.noteOnSampler?.(bankParams, note, time) ?? null;
            if (id != null) activeKeyboardNotesRef.current.set(note, id);
        }

        const step = currentStepRef.current;
        if (isRecording && isPlaying && step >= 0) {
            setPattern(prev => {
                let newPattern;
                if (selectedTrack === 'sampler') {
                    const bankIdx = activeSamplerBankRef.current;
                    newPattern = updateSamplerStep(prev, bankIdx, step, () => ({ note, velocity: 1, length: 1 }));
                    updateStorageForTrack('sampler', newPattern.sampler);
                } else {
                    newPattern = updateTrackStep(prev, selectedTrack, step, () => ({ note, velocity: 1, length: 1 }));
                    updateStorageForTrack(selectedTrack, newPattern[selectedTrack]);
                }
                return newPattern;
            });
        }
    }, [audioEngine, selectedTrack, isRecording, isPlaying, updateStorageForTrack, activeSamplerBankRef, currentStepRef, setPattern, synthARef, synthBRef, bass2Ref, kickRef, snareRef, closedHatRef, openHatRef, samplerRef, samplerVoiceParamsRef, activeKeyboardNotesRef]);

    const handleKeyboardStop = useCallback((note: string) => {
        if (!audioEngine) return;
        const id = activeKeyboardNotesRef.current.get(note);
        if (id === undefined) return;
        if (selectedTrack === 'partA' || selectedTrack === 'partB' || selectedTrack === 'bass2') {
            audioEngine.noteOffSynth?.(id);
        } else if (selectedTrack === 'sampler') {
            audioEngine.noteOffSampler?.(id);
        }
        activeKeyboardNotesRef.current.delete(note);
    }, [audioEngine, selectedTrack, activeKeyboardNotesRef]);

    const handleRightMouseDown = useCallback((track: TrackKey, step: number, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        let stepData = null;
        if (track === 'sampler') {
            stepData = patternRef.current.sampler[activeSamplerBankRef.current].steps[step];
        } else {
            stepData = patternRef.current[track].steps[step];
        }
        if (!stepData) return;
        setIsNoteDragging(true);
        const startMidi = noteToMidi(stepData.note);
        noteDragRef.current = { track, step, startY: e.clientY, startMidi, hasMoved: false, lastMidi: startMidi };
        document.body.style.cursor = 'ns-resize';
    }, [patternRef, activeSamplerBankRef, setIsNoteDragging, noteDragRef]);

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!isNoteDragging || !noteDragRef.current) return;
        const { track, step, startY, startMidi } = noteDragRef.current;
        const dy = startY - e.clientY;
        if (!noteDragRef.current.hasMoved && Math.abs(dy) > 5) { noteDragRef.current.hasMoved = true; }
        if (noteDragRef.current.hasMoved) {
            const semitoneChange = Math.round(dy / 10);
            const newMidi = startMidi + semitoneChange;
            const clampedMidi = Math.max(24, Math.min(108, newMidi));
            if (clampedMidi !== noteDragRef.current.lastMidi) {
                noteDragRef.current.lastMidi = clampedMidi;
                const newNote = midiToNote(clampedMidi);
                setPattern(prev => {
                    const updater = (stepData: import('../../types').Note | null) =>
                        stepData ? { ...stepData, note: newNote } : { note: newNote, velocity: 1, length: 1 };
                    let newPattern;

                    if (track === 'sampler') {
                        const bankIndex = activeSamplerBank;
                        newPattern = updateSamplerStep(prev, bankIndex, step, updater);
                        if (noteDragRef.current) noteDragRef.current.pendingSequence = newPattern.sampler;
                    } else {
                        newPattern = updateTrackStep(prev, track, step, updater);
                        if (noteDragRef.current) noteDragRef.current.pendingSequence = newPattern[track];
                    }
                    return newPattern;
                });
            }
        }
    }, [isNoteDragging, activeSamplerBank, setPattern, noteDragRef]);

    const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
        if (isDrawing) { setIsDrawing(false); setDrawMode(null); }
        if (!isNoteDragging || !noteDragRef.current) return;
        if (!noteDragRef.current.hasMoved) {
            const { track, step } = noteDragRef.current;
            setContextMenu({ x: e.clientX, y: e.clientY, track, step });
        }
        else if (noteDragRef.current.pendingSequence) {
            updateStorageForTrack(noteDragRef.current.track, noteDragRef.current.pendingSequence);
        }
        setIsNoteDragging(false);
        noteDragRef.current = null;
        document.body.style.cursor = 'default';
    }, [isNoteDragging, updateStorageForTrack, isDrawing, setIsDrawing, setDrawMode, setContextMenu, setIsNoteDragging, noteDragRef]);

    useEffect(() => {
        const handlePointerUp = (e: PointerEvent) => handleGlobalMouseUp(e as unknown as MouseEvent);
        window.addEventListener('pointerup', handlePointerUp);
        if (isNoteDragging) {
            window.addEventListener('mousemove', handleGlobalMouseMove);
            window.addEventListener('mouseup', handleGlobalMouseUp);
        }
        return () => {
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [isNoteDragging, handleGlobalMouseMove, handleGlobalMouseUp]);

    const handleDrawEnter = useCallback(() => {}, []);

    return {
        handleDrumPadPlay,
        handleKeyboardPlay,
        handleKeyboardStop,
        handleRightMouseDown,
        handleGlobalMouseMove,
        handleGlobalMouseUp,
        handleDrawEnter,
    };
}
