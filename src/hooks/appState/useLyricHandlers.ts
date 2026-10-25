import { useCallback } from 'react'
import { SupertonicService } from '../../services/Supertonic'
import { ensureBufferMatchesContext } from '../../utils/resampleAudioBuffer'
import type { AudioEngine, Note, Pattern, PartSequence, SamplerParams } from '../../types'
import type { TrackKey } from '../../constants/appDefaults'
import type { AlignmentResult, PhonemeSegment } from '../../engines/rubberband/PhonemeAligner'
import { updateSamplerRange } from './patternUpdates'
import { transportMixStore } from '../../stores/transportMixStore'
import { padSteps, trackLoopLength } from '../../utils/songMeter'
import { swingPercentToClock } from '../../utils/musicTheory'


const timeToStep = (time: number, tempo: number, swingPercent: number): number => {
    const swing = swingPercentToClock(swingPercent);
    const baseTime = 60 / tempo / 4;
    const shift = swing * baseTime * 0.5;

    const pairTime = 2 * baseTime;
    const pairs = Math.floor(time / pairTime);
    const remainder = time - pairs * pairTime;

    const mid01 = (baseTime + shift) / 2;
    const mid12 = (3 * baseTime + shift) / 2;

    if (remainder < mid01) {
        return pairs * 2;
    } else if (remainder < mid12) {
        return pairs * 2 + 1;
    } else {
        return pairs * 2 + 2;
    }
};

const NOTE_MAP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP: Record<string, string> = {
    'DB': 'C#', 'EB': 'D#', 'GB': 'F#', 'AB': 'G#', 'BB': 'A#'
};
const NOTE_REGEX = /^([A-G][#b]?)([0-9])$/i;

const transposeNote = (note: string, semitones: number): string => {
    if (semitones === 0) return note;

    const match = note.match(NOTE_REGEX);
    if (!match) return note;

    const [, noteNameMatch, octaveStr] = match;
    let noteName = noteNameMatch.toUpperCase();
    let octave = parseInt(octaveStr, 10);

    if (FLAT_TO_SHARP[noteName]) noteName = FLAT_TO_SHARP[noteName];

    let index = NOTE_MAP.indexOf(noteName);
    if (index === -1) return note;

    index += semitones;

    while (index >= 12) {
        index -= 12;
        octave++;
    }
    while (index < 0) {
        index += 12;
        octave--;
    }

    return `${NOTE_MAP[index]}${octave}`;
};

export function useLyricHandlers(deps: {
    audioEngine: AudioEngine | null;
    patternRef: React.MutableRefObject<Pattern>;
    tempoRef: React.MutableRefObject<number>;
    activeSamplerBankRef: React.MutableRefObject<number>;
    samplerRef: React.MutableRefObject<SamplerParams>;
    setPattern: React.Dispatch<React.SetStateAction<Pattern>>;
    setSampler: React.Dispatch<React.SetStateAction<SamplerParams>>;
    setTtsPhrases: React.Dispatch<React.SetStateAction<string[]>>;
    setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
    setIsLyricTrackVisible: React.Dispatch<React.SetStateAction<boolean>>;
    ttsPhrases: string[];
    activeSamplerBank: number;
    handleLoadSample: (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => Promise<void>;
    updateStorageForTrack: (track: TrackKey, sequence: PartSequence | PartSequence[]) => void;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    setActiveAlignment: React.Dispatch<React.SetStateAction<AlignmentResult | null>>;
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
            void audioEngine.prepareVocal(activeSamplerBank, text).then(() => {
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
            const tts = SupertonicService.getInstance();
            const rawData = await tts.generate(text);
            const nativeRate = tts.getOutputSampleRate();
            const nativeBuffer = audioEngine.context.createBuffer(1, rawData.length, nativeRate);
            nativeBuffer.getChannelData(0).set(rawData);
            const buffer = await ensureBufferMatchesContext(nativeBuffer, audioEngine.context);
            const bankName = `bank_${activeSamplerBankRef.current}`;
            await handleLoadSample(bankName, buffer);
            const bankIdx = activeSamplerBankRef.current;
            const priors = tts.getLastTokenDurations() ?? undefined;
            if (audioEngine.prepareVocal) {
                await audioEngine.prepareVocal(bankIdx, text, priors);
                if (audioEngine.getAlignment) {
                    setActiveAlignment(audioEngine.getAlignment(bankIdx));
                }
            }
            showToast(`Generated: ${text.substring(0, 15)}...`, "success");
        } catch (e) {
            console.error(e);
            showToast("TTS Generation Failed", "error");
            throw e;
        } finally {
            setIsGenerating(false);
        }
    }, [audioEngine, handleLoadSample, showToast, activeSamplerBankRef, setIsGenerating, setActiveAlignment]);

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
            const meter = transportMixStore.getSnapshot();
            const kickSteps = trackLoopLength(meter, 'kick');
            const snareSteps = trackLoopLength(meter, 'snare');
            const chSteps = trackLoopLength(meter, 'closedHat');
            const ohSteps = trackLoopLength(meter, 'openHat');
            newKick.steps = Array<Note | null>(kickSteps).fill(null);
            newSnare.steps = Array<Note | null>(snareSteps).fill(null);
            newCH.steps = Array<Note | null>(chSteps).fill(null);
            newOH.steps = Array<Note | null>(ohSteps).fill(null);

            let consecutiveConsonants = 0;
            let lastConsonantStep = -1;

            const tomPitches = ['G3', 'E3', 'C3', 'A2', 'G2', 'E2'];

            for (let _i = 0; _i < alignment.phonemes.length; _i++) {
                const phraseProgress = Math.max(0, Math.min(1, _i / alignment.phonemes.length));
                const tomPitch = tomPitches[Math.floor(phraseProgress * tomPitches.length) % tomPitches.length];

                const p: PhonemeSegment = alignment.phonemes[_i];
                const stepIdx = timeToStep(p.start, tempoRef.current, meter.swing);
                const ph = p.phoneme.toUpperCase().replace(/[0-9]/g, '');
                const isVowel = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'].includes(ph);
                const isSnare = ['B','D','G','CH','JH','K','P','T'].includes(ph);
                const isHat = ['F','S','SH','TH','V','Z','ZH'].includes(ph);
                const isOpenHat = ['SH','ZH','S','F'].includes(ph) && p.end - p.start > 0.15;

                if (isVowel) {
                    consecutiveConsonants = 0;
                    lastConsonantStep = -1;
                    if (stepIdx >= 0 && stepIdx < newKick.steps.length) {
                        const isDarkVowel = ['AA','AO','OW','UH','UW','AW'].includes(ph);
                        newKick.steps[stepIdx] = { note: 'C4', velocity: 1, length: isDarkVowel ? 2 : 1 };
                    }
                } else {
                    consecutiveConsonants++;

                    if (consecutiveConsonants >= 2 && lastConsonantStep !== -1 && stepIdx > lastConsonantStep + 1) {
                        // Fill the gap with closed hi-hat rolls
                        const gapSize = stepIdx - lastConsonantStep - 1;
                        for (let j = 1; j <= gapSize; j++) {
                            const fillStep = lastConsonantStep + j;
                            if (fillStep >= 0 && fillStep < newCH.steps.length) {
                                // Escalating velocity for the roll
                                const vel = 0.3 + (0.7 * (j / gapSize));
                                newCH.steps[fillStep] = { note: 'C4', velocity: vel, length: 1 };

                                // Explore generating complementary drum rolls/fills inside handleTextToDrums when parsing multiple consonants in rapid succession
                                if (consecutiveConsonants >= 3 && gapSize >= 2) {
                                    if (j % 3 === 0 && fillStep >= 0 && fillStep < newKick.steps.length) {
                                        newKick.steps[fillStep] = { note: 'C4', velocity: 0.3, length: 1 };
                                    } else if (j % 2 === 0 && fillStep >= 0 && fillStep < newSnare.steps.length) {
                                        const ghostVel = 0.4;
                                        newSnare.steps[fillStep] = { note: tomPitch, velocity: ghostVel, length: 1 };
                                        if (Math.random() < ghostVel) {
                                            newCH.steps[fillStep] = null;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (isSnare) {
                        const dur = Math.max(1, Math.round((p.end - p.start) / (60 / tempoRef.current / 4)));
                        if (stepIdx >= 0 && stepIdx < newSnare.steps.length) newSnare.steps[stepIdx] = { note: 'C4', velocity: 1, length: dur };
                        // Inject a ghost snare on the preceding step for a more organic feel
                        if (stepIdx - 1 >= 0 && stepIdx - 1 < newSnare.steps.length && !newSnare.steps[stepIdx - 1]) {
                            const ghostVel = 0.4;
                            newSnare.steps[stepIdx - 1] = { note: tomPitch, velocity: ghostVel, length: 1 };
                            if (Math.random() < ghostVel && stepIdx - 1 < newCH.steps.length) {
                                newCH.steps[stepIdx - 1] = null;
                            }
                        }
                    } else if (isOpenHat) {
                        if (stepIdx >= 0 && stepIdx < newOH.steps.length) {
                            const ohLength = Math.max(1, Math.min(4, Math.round((p.end - p.start) / 0.15)));
                            newOH.steps[stepIdx] = { note: 'C4', velocity: 1, length: ohLength };
                        }
                    } else if (isHat) {
                        const dur = Math.max(1, Math.round((p.end - p.start) / (60 / tempoRef.current / 4)));
                        if (stepIdx >= 0 && stepIdx < newCH.steps.length) newCH.steps[stepIdx] = { note: 'C4', velocity: 1, length: dur };
                    } else {
                        const dur = Math.max(1, Math.round((p.end - p.start) / (60 / tempoRef.current / 4)));
                        if (stepIdx >= 0 && stepIdx < newCH.steps.length) newCH.steps[stepIdx] = { note: 'C4', velocity: 0.5, length: dur };
                    }

                    lastConsonantStep = stepIdx;
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
            const pitchRegex = /\(([^)]+)\)/gi;
            const pitches: string[] = [];
            const reverses: boolean[] = [];
            let match;
            let lastNote = 'C4';

            while ((match = pitchRegex.exec(text)) !== null) {
                const parts = match[1].split(',').map(s => s.trim().toLowerCase());
                let note = undefined;
                let transpose = 0;
                let reverse = false;

                for (const part of parts) {
                    if (part === 'rev' || part === 'reverse') {
                        reverse = true;
                    } else if (/^[+-]\d+$/.test(part)) {
                        transpose = parseInt(part, 10);
                    } else if (/^[a-g][#b]?\d$/.test(part)) {
                        note = part.toUpperCase();
                    }
                }

                if (note) {
                    lastNote = note;
                }
                const finalNote = transposeNote(lastNote, transpose);
                lastNote = finalNote;

                pitches.push(finalNote);
                reverses.push(reverse);
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
            let newPattern: Pattern;
            const alignment = audioEngine?.getAlignment?.(bankIdx);

            const meter = transportMixStore.getSnapshot();
            const trackLength = trackLoopLength(meter, 'sampler');

            if (alignment && alignment.phonemes && alignment.phonemes.length > 0) {
                const newSteps = new Array<Note | null>(trackLength).fill(null);

                let currentPitchIdx = 0;
                let lastPhonemeEnd = 0;

                for (let i = 0; i < alignment.phonemes.length; i++) {
                    const p: PhonemeSegment = alignment.phonemes[i];
                    const startStep = timeToStep(p.start, tempoRef.current, transportMixStore.getSnapshot().swing);

                    // Treat as new syllable if there's a gap or it's the first phoneme
                    if (i === 0 || p.start - lastPhonemeEnd > 0.05) {
                        if (i > 0) {
                             currentPitchIdx++;
                        }
                    }

                    if (startStep >= 0 && startStep < trackLength) {
                        const durationSteps = Math.max(1, Math.round((p.end - p.start) / (60 / tempoRef.current / 4)));
                        newSteps[startStep] = {
                            note: pitches[currentPitchIdx] || 'C4',
                            velocity: 1,
                            length: durationSteps,
                            sliceIndex: i,
                            ...(reverses[currentPitchIdx] ? { reverse: true } : {})
                        };
                        noteIndex++;
                    }

                    lastPhonemeEnd = p.end;
                }

                const newSampler = [...prev.sampler];
                newSampler[bankIdx] = { ...newSampler[bankIdx], steps: newSteps };
                newPattern = {
                    ...prev,
                    sampler: newSampler,
                };
            } else {
                newPattern = updateSamplerRange(prev, bankIdx, 0, trackLength - 1, (stepData) => {
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
                                        const newSamplerSequence = [...newPattern.sampler];
                    const currentBankSequence = { ...newSamplerSequence[bankIdx], steps: padSteps([...newSamplerSequence[bankIdx].steps], trackLength) };
                    let currentPitchIdx = 0;

                    // Group phonemes into words/syllables based on pauses (simple heuristic)

                    let lastPhonemeEnd = 0;

                    for (let i = 0; i < alignment.phonemes.length; i++) {
                        const p: PhonemeSegment = alignment.phonemes[i];
                        const stepIdx = timeToStep(p.start, tempoRef.current, transportMixStore.getSnapshot().swing);

                        // Treat as new syllable if there's a gap or it's the first phoneme
                        if (i === 0 || p.start - lastPhonemeEnd > 0.05) {
                            if (stepIdx >= 0 && stepIdx < trackLength && !currentBankSequence.steps[stepIdx]) {
                                currentBankSequence.steps[stepIdx] = {
                                    note: pitches[currentPitchIdx] || 'C4',
                                    velocity: 1,
                                    length: 1,
                                    sliceIndex: noteIndex,
                                    ...(reverses[currentPitchIdx] ? { reverse: true } : {})
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

            setSampler((prevParams) => {
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
