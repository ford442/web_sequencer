import { useCallback } from 'react'
import { SupertonicService } from '../../services/Supertonic'
import type { Pattern } from '../../types'
import type { TrackKey } from '../../constants/appDefaults'
import { updateSamplerRange } from './patternUpdates'

export function useLyricHandlers(deps: {
    audioEngine: any;
    patternRef: React.MutableRefObject<Pattern>;
    tempoRef: React.MutableRefObject<number>;
    activeSamplerBankRef: React.MutableRefObject<number>;
    samplerRef: React.MutableRefObject<any>;
    setPattern: React.Dispatch<React.SetStateAction<Pattern>>;
    setSampler: React.Dispatch<React.SetStateAction<any>>;
    setTtsPhrases: React.Dispatch<React.SetStateAction<string[]>>;
    setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
    setIsLyricTrackVisible: React.Dispatch<React.SetStateAction<boolean>>;
    ttsPhrases: string[];
    activeSamplerBank: number;
    handleLoadSample: (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => Promise<void>;
    updateStorageForTrack: (track: TrackKey, sequence: any) => void;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    setActiveAlignment: React.Dispatch<React.SetStateAction<any>>;
}) {
    const {
        audioEngine, patternRef, tempoRef, activeSamplerBankRef, samplerRef,
        setPattern, setSampler, setTtsPhrases, setIsGenerating, setIsLyricTrackVisible,
        ttsPhrases, activeSamplerBank, handleLoadSample, updateStorageForTrack, showToast,
        setActiveAlignment,
    } = deps;

    const handleTtsPhraseChange = useCallback((newPhrases: string[]) => {
        setTtsPhrases(newPhrases);
        if (audioEngine?.prepareVocal) {
            const text = newPhrases[activeSamplerBank];
            audioEngine.prepareVocal(activeSamplerBank, text).then(() => {
                if (audioEngine.getAlignment) {
                    setActiveAlignment(audioEngine.getAlignment(activeSamplerBank));
                }
            });
        }
    }, [audioEngine, activeSamplerBank, setTtsPhrases, setActiveAlignment]);

    const handleGenerateTTS = useCallback(async (text: string) => {
        if (!audioEngine) return;
        setIsGenerating(true);
        try {
            const rawData = await SupertonicService.getInstance().generate(text);
            const buffer = audioEngine.context.createBuffer(1, rawData.length, 44100);
            buffer.getChannelData(0).set(rawData);
            const bankName = `bank_${activeSamplerBankRef.current}`;
            handleLoadSample(bankName, buffer);
            showToast(`Generated: ${text.substring(0, 15)}...`, "success");
        } catch (e) {
            console.error(e);
            showToast("TTS Generation Failed", "error");
            throw e;
        } finally {
            setIsGenerating(false);
        }
    }, [audioEngine, handleLoadSample, showToast, activeSamplerBankRef, setIsGenerating]);

    const handleTextToDrums = useCallback(async (text: string) => {
        try {
            await handleGenerateTTS(text);
            const alignment = audioEngine?.getAlignment?.(activeSamplerBankRef.current);
            if (!alignment) return;
            const newPattern = { ...patternRef.current };
            const newKick = { ...newPattern.kick, steps: [...newPattern.kick.steps] };
            const newSnare = { ...newPattern.snare, steps: [...newPattern.snare.steps] };
            const newCH = { ...newPattern.closedHat, steps: [...newPattern.closedHat.steps] };
            const newOH = { ...newPattern.openHat, steps: [...newPattern.openHat.steps] };
            newKick.steps = Array(32).fill(null);
            newSnare.steps = Array(32).fill(null);
            newCH.steps = Array(32).fill(null);
            newOH.steps = Array(32).fill(null);
            const stepTime = 60 / tempoRef.current / 4;
            for (let _i = 0; _i < alignment.phonemes.length; _i++) {
                const p = alignment.phonemes[_i] as any;
                const stepIdx = Math.round(p.start / stepTime);
                if (stepIdx >= 0 && stepIdx < 32) {
                    const ph = p.phoneme.toUpperCase().replace(/[0-9]/g, '');
                    const isVowel = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'].includes(ph);
                    const isSnare = ['B','D','G','CH','JH','K','P','T'].includes(ph);
                    const isHat = ['F','S','SH','TH','V','Z','ZH'].includes(ph);
                    const isOpenHat = ['SH','ZH','S','F'].includes(ph) && p.end - p.start > 0.15;
                    if (isVowel) newKick.steps[stepIdx] = { note: 'C4', velocity: 1, length: 1 };
                    else if (isSnare) newSnare.steps[stepIdx] = { note: 'C4', velocity: 1, length: 1 };
                    else if (isOpenHat) newOH.steps[stepIdx] = { note: 'C4', velocity: 1, length: 1 };
                    else if (isHat) newCH.steps[stepIdx] = { note: 'C4', velocity: 1, length: 1 };
                    else newCH.steps[stepIdx] = { note: 'C4', velocity: 0.5, length: 1 };
                }
            }
            newPattern.kick = newKick;
            newPattern.snare = newSnare;
            newPattern.closedHat = newCH;
            newPattern.openHat = newOH;
            setPattern(newPattern);
            updateStorageForTrack('kick', newKick);
            updateStorageForTrack('snare', newSnare);
            updateStorageForTrack('closedHat', newCH);
            updateStorageForTrack('openHat', newOH);
            showToast("Drumkit generated from text!", "success");
            setIsLyricTrackVisible(false);
        } catch(e) {
            console.error(e);
            showToast("Failed to generate drums.", "error");
        }
    }, [handleGenerateTTS, audioEngine, patternRef, tempoRef, activeSamplerBankRef, updateStorageForTrack, showToast, setPattern, setIsLyricTrackVisible]);

    const handleLyricApply = useCallback(async (text: string) => {
        try {
            // Parse pitch tags like (C4) or (C#4)
            const pitchRegex = /\(([A-G][#b]?[0-9])\)/g;
            const pitches: string[] = [];
            let match;
            while ((match = pitchRegex.exec(text)) !== null) {
                pitches.push(match[1]);
            }

            // Clean text for TTS generation
            const cleanText = text.replace(pitchRegex, '').trim();

            await handleGenerateTTS(cleanText);

            const newPhrases = [...ttsPhrases];
            newPhrases[activeSamplerBankRef.current] = cleanText;
            setTtsPhrases(newPhrases);

            const prev = patternRef.current;
            const bankIdx = activeSamplerBankRef.current;

            let noteIndex = 0;
            let newPattern;
            const alignment = audioEngine?.getAlignment?.(bankIdx);

            if (alignment && alignment.phonemes && alignment.phonemes.length > 0) {
                const stepTime = 60 / tempoRef.current / 4;
                const newSteps = Array(32).fill(null);

                for (let i = 0; i < alignment.phonemes.length; i++) {
                    const p = alignment.phonemes[i] as { start: number; end: number; phoneme: string };
                    const startStep = Math.round(p.start / stepTime);
                    if (startStep >= 0 && startStep < 32) {
                        const durationSteps = Math.max(1, Math.round((p.end - p.start) / stepTime));
                        newSteps[startStep] = {
                            note: 'C4',
                            velocity: 1,
                            length: durationSteps,
                            sliceIndex: i
                        };
                        noteIndex++;
                    }
                }

                newPattern = {
                    ...prev,
                    sampler: prev.sampler.map((bank, idx) =>
                        idx === bankIdx
                            ? { ...bank, steps: newSteps }
                            : bank
                    ),
                };
            } else {
                newPattern = updateSamplerRange(prev, bankIdx, 0, 31, (stepData) => {
                    if (stepData && stepData.velocity > 0) {
                        const newStep = { ...stepData, sliceIndex: noteIndex };
                        noteIndex++;
                        return newStep;
                    }
                    return stepData;
                });
            }

            // If no notes exist, auto-generate them based on phoneme timing
            if (noteIndex === 0) {
                const alignment = audioEngine?.getAlignment?.(activeSamplerBankRef.current);
                if (alignment && alignment.phonemes && alignment.phonemes.length > 0) {
                    const stepTime = 60 / tempoRef.current / 4;
                    const newSamplerSequence = [...newPattern.sampler];
                    const currentBankSequence = { ...newSamplerSequence[bankIdx], steps: [...newSamplerSequence[bankIdx].steps] };
                    let currentPitchIdx = 0;

                    // Group phonemes into words/syllables based on pauses (simple heuristic)

                    let lastPhonemeEnd = 0;

                    for (let i = 0; i < alignment.phonemes.length; i++) {
                        const p = alignment.phonemes[i] as any;
                        const stepIdx = Math.round(p.start / stepTime);

                        // Treat as new syllable if there's a gap or it's the first phoneme
                        if (i === 0 || p.start - lastPhonemeEnd > 0.05) {
                            if (stepIdx >= 0 && stepIdx < 32 && !currentBankSequence.steps[stepIdx]) {
                                currentBankSequence.steps[stepIdx] = {
                                    note: pitches[currentPitchIdx] || 'C4',
                                    velocity: 1,
                                    length: 1,
                                    sliceIndex: noteIndex,
                                };
                                noteIndex++;
                                currentPitchIdx++;
                            }
                        }
                        lastPhonemeEnd = p.end;
                    }

                    newSamplerSequence[bankIdx] = currentBankSequence;
                    newPattern = { ...newPattern, sampler: newSamplerSequence };
                }
            }

            setPattern(newPattern);
            updateStorageForTrack('sampler', newPattern.sampler);

            setSampler((prevParams: any) => {
                const next = [...prevParams];
                if (next[bankIdx]) {
                    next[bankIdx] = { ...next[bankIdx], sliceMode: 'phoneme' };
                }
                samplerRef.current = next;
                return next;
            });

            if (noteIndex > 0) {
                showToast(`Mapped ${noteIndex} syllables across Sampler Bank ${bankIdx + 1}!`, "success");
            } else {
                showToast("Generated TTS! (No notes found to map syllables to)", "success");
            }

            setIsLyricTrackVisible(false);
        } catch (e) {
            console.error(e);
            showToast("Failed to generate or map lyrics.", "error");
        }
    }, [handleGenerateTTS, audioEngine, tempoRef, ttsPhrases, updateStorageForTrack, showToast, patternRef, activeSamplerBankRef, setTtsPhrases, setPattern, setSampler, samplerRef, setIsLyricTrackVisible]);

    return {
        handleTtsPhraseChange,
        handleGenerateTTS,
        handleTextToDrums,
        handleLyricApply,
    };
}
