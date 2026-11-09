import { useCallback } from 'react'
import { SupertonicService } from '../../services/Supertonic'
import { ensureBufferMatchesContext } from '../../utils/resampleAudioBuffer'
import type { AudioEngine, Note, Pattern, PartSequence, SamplerParams } from '../../types'
import type { TrackKey } from '../../constants/appDefaults'
import type { AlignmentResult, PhonemeSegment } from '../../engines/rubberband/PhonemeAligner'
import { updateSamplerRange } from './patternUpdates'
import { transportMixStore } from '../../stores/transportMixStore'
import { padSteps, trackLoopLength } from '../../utils/songMeter'
import { MAX_NOTE_MIDI, MIN_NOTE_MIDI, midiToNote, noteToMidi, swingPercentToClock } from '../../utils/musicTheory'
import { analyzeLyricSentiment } from './lyricSentiment'


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

/** Transpose a note name by semitones, spelled with sharps. Unparseable or out-of-range results return `note` unchanged. */
const transposeNote = (note: string, semitones: number): string => {
    if (semitones === 0) return note;
    // Lyric notes may be typed lower-case ("eb4").
    const midi = noteToMidi(note.charAt(0).toUpperCase() + note.slice(1));
    if (midi === null) return note;
    const shifted = midi + semitones;
    return shifted >= MIN_NOTE_MIDI && shifted <= MAX_NOTE_MIDI ? midiToNote(shifted) : note;
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
    currentScale: import('../../utils/musicTheory').ScaleDefinition | null;
    setCurrentScale: React.Dispatch<React.SetStateAction<import('../../utils/musicTheory').ScaleDefinition | null>>;
}) {
    const {
        audioEngine, patternRef, tempoRef, activeSamplerBankRef, samplerRef,
        setPattern, setSampler, setTtsPhrases, setIsGenerating, setIsLyricTrackVisible,
        ttsPhrases, activeSamplerBank, handleLoadSample, updateStorageForTrack, showToast,
        setActiveAlignment, currentScale, setCurrentScale,
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
            const newBass2 = { ...newPattern.bass2, steps: [...(newPattern.bass2?.steps || [])] };
            const meter = transportMixStore.getSnapshot();
            const kickSteps = trackLoopLength(meter, 'kick');
            const snareSteps = trackLoopLength(meter, 'snare');
            const chSteps = trackLoopLength(meter, 'closedHat');
            const ohSteps = trackLoopLength(meter, 'openHat');
            newKick.steps = Array<Note | null>(kickSteps).fill(null);
            newSnare.steps = Array<Note | null>(snareSteps).fill(null);
            newCH.steps = Array<Note | null>(chSteps).fill(null);
            newOH.steps = Array<Note | null>(ohSteps).fill(null);

            // Calculate basic text sentiment to determine probability of open vs closed hats in fills
            const sentiment = analyzeLyricSentiment(text);
            const normalizedSentiment = sentiment.normalized;
            // base prob: 0.1. Sentiment adds/removes up to 0.4.
            const openHatProb = Math.max(0, Math.min(0.8, 0.2 + (normalizedSentiment * 0.4)));

            // Map sentiment to a pitch offset for the kick drum (-2 to +2 semitones)
            const kickPitchOffset = Math.round(normalizedSentiment * 2);

            // Map lyric text sentiment to default scale if not touched by user
            if (!currentScale) {
                if (normalizedSentiment > 0.1) {
                    setCurrentScale({ root: 'C', scale: 'Major', tuning: '12-TET' });
                    showToast('Mapped positive lyric sentiment to C Major scale', 'info');
                } else if (normalizedSentiment < -0.1) {
                    setCurrentScale({ root: 'C', scale: 'Minor', tuning: '12-TET' });
                    showToast('Mapped negative lyric sentiment to C Minor scale', 'info');
                }
            }

            let consecutiveConsonants = 0;
            let lastVowelBrightness = 0.5;
            let lastConsonantStep = -1;
            let currentStress = 0;

            const tomPitches = ['G3', 'E3', 'C3', 'A2', 'G2', 'E2'];

            for (let _i = 0; _i < alignment.phonemes.length; _i++) {
                const phraseProgress = Math.max(0, Math.min(1, _i / alignment.phonemes.length));
                const tomDecaySteps = Math.max(1, Math.round(4 - (alignment.phonemes.length / 10)));
                const tomPitch = tomPitches[Math.floor(phraseProgress * tomPitches.length) % tomPitches.length];

                const p: PhonemeSegment = alignment.phonemes[_i];
                const stepIdx = timeToStep(p.start, tempoRef.current, meter.swing);

                if (stepIdx >= 0 && stepIdx < newBass2.steps.length && newBass2.steps[stepIdx]) {
                    newBass2.steps[stepIdx] = {
                        ...newBass2.steps[stepIdx],
                        filterCutoff: 200 + (phraseProgress * 3000)
                    };
                }

                // Extract stress before stripping numbers
                const rawPhoneme = p.phoneme.toUpperCase();
                const stressMatch = rawPhoneme.match(/[0-2]/);
                if (stressMatch) {
                    currentStress = parseInt(stressMatch[0], 10);
                }

                let baseVel = 0.6;
                if (currentStress === 1) baseVel = 1.0;
                else if (currentStress === 2) baseVel = 0.85;

                const jitter = (Math.random() * 0.2) - 0.1; // +/- 10%
                const finalVel = Math.max(0, Math.min(1, baseVel + jitter));

                const ph = rawPhoneme.replace(/[0-9]/g, '');
                const isVowel = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'].includes(ph);
                const isSnare = ['B','D','G','CH','JH','K','P','T'].includes(ph);
                const isHat = ['F','S','SH','TH','V','Z','ZH'].includes(ph);
                const phonemeDurSec = p.end - p.start;
                const isOpenHat = ['SH','ZH','S','F'].includes(ph) && phonemeDurSec > 0.15;

                // Humanize velocity based on duration (longer = harder hit)
                // Normalize duration roughly between 0.05s (short) and 0.3s (long) to a velocity between 0.6 and 1.0
                const normDur = Math.max(0, Math.min(1, (phonemeDurSec - 0.05) / 0.25));
                const humanVelocity = 0.6 + (0.4 * normDur);

                const durationSteps = Math.max(1, Math.round((p.end - p.start) / (60 / tempoRef.current / 4)));

                const isBrightVowel = ['IY','IH','EY','EH','AE'].includes(ph);
                const isMidVowel = ['AH','ER','AW','AY','OY'].includes(ph);
                const isDarkVowel = ['AA','AO','OW','UH','UW','AW'].includes(ph);

                if (isVowel) {
                    if (isBrightVowel) lastVowelBrightness = 1;
                    else if (isMidVowel) lastVowelBrightness = 0.5;
                    else if (isDarkVowel) lastVowelBrightness = 0;
                }

                if (isVowel) {
                    consecutiveConsonants = 0;
                    lastConsonantStep = -1;
                    if (stepIdx >= 0 && stepIdx < newKick.steps.length) {
                        let kickNote = 'C4';
                        if (isBrightVowel) kickNote = 'E4';
                        else if (isDarkVowel) kickNote = 'A3';
                        newKick.steps[stepIdx] = { note: transposeNote(kickNote, kickPitchOffset), velocity: humanVelocity, length: durationSteps };
                    }
                    if (stepIdx >= 0 && stepIdx < newOH.steps.length) {
                        if (isBrightVowel || isMidVowel) {
                            newOH.steps[stepIdx] = { note: 'C4', velocity: finalVel * 0.7, length: durationSteps };
                        }
                    }
                } else {
                    consecutiveConsonants++;

                    if (consecutiveConsonants >= 2 && lastConsonantStep !== -1 && stepIdx > lastConsonantStep + 1) {
                        // Fill the gap with evolving polyrhythmic Euclidean drum sequences
                        const gapSize = stepIdx - lastConsonantStep - 1;

                        // Cross-modulate Euclidean rhythm density with the synth bass envelope
                        let bassHitsInGap = 0;
                        for (let j = 1; j <= gapSize; j++) {
                            const fillStep = lastConsonantStep + j;
                            if (fillStep >= 0 && fillStep < (newPattern.bass2?.steps?.length || 0) && newPattern.bass2?.steps?.[fillStep]) {
                                bassHitsInGap++;
                            }
                        }
                        const bassModulation = gapSize > 0 ? (bassHitsInGap / gapSize) * 0.4 : 0;

                        // Calculate number of hits based on consonant density + bass density
                        const hits = Math.max(1, Math.floor(gapSize * (0.3 + ((consecutiveConsonants * 0.15) % 0.6) + bassModulation)));

                        // Shift the phase of the polyrhythm dynamically based on the current swing percentage.
                        // 50 swing = straight (0 shift), > 50 = shift forward, < 50 = shift backward.
                        const swingShift = Math.round(((meter.swing - 50) / 25) * gapSize);

                        for (let j = 1; j <= gapSize; j++) {
                            const fillStep = lastConsonantStep + j;
                            if (fillStep >= 0 && fillStep < newCH.steps.length) {
                                // Euclidean Rhythm E(k, n): ((j - 1 + shift) * hits) % gapSize < hits
                                // We add gapSize before modulo to handle negative swingShifts cleanly.
                                const phaseShiftedIndex = j - 1 + swingShift;
                                const isEuclideanHit = ((((phaseShiftedIndex % gapSize) + gapSize) % gapSize) * hits) % gapSize < hits;

                                if (isEuclideanHit) {
                                    // Escalating velocity for the evolving sequence
                                    const vel = 0.3 + (0.7 * (j / gapSize));
                                    if (Math.random() < openHatProb && fillStep >= 0 && fillStep < newOH.steps.length) {
                                        // Polyrhythmic modulation to control open hi-hat decay time:
                                        // We map the phase shifted index and hit density into a dynamic decay length (1 to 4 steps)
                                        const polyModulation = 1 + ((phaseShiftedIndex * hits) % gapSize) / gapSize;
                                        const dynamicDecay = Math.max(1, Math.round(polyModulation * 2));
                                        newOH.steps[fillStep] = { note: 'C4', velocity: vel, length: dynamicDecay };
                                    } else {
                                        newCH.steps[fillStep] = { note: 'C4', velocity: vel, length: 1 };
                                    }
                                }

                                // Explore generating complementary drum rolls/fills inside handleTextToDrums when parsing multiple consonants in rapid succession
                                if (consecutiveConsonants >= 3 && gapSize >= 2) {
                                    if (j % 3 === 0 && fillStep >= 0 && fillStep < newKick.steps.length) {
                                        newKick.steps[fillStep] = { note: transposeNote('C4', kickPitchOffset), velocity: 0.3, length: 1 };
                                    } else if (j % 2 === 0 && fillStep >= 0 && fillStep < newSnare.steps.length) {
                                        const ghostVel = 0.4;
                                        newSnare.steps[fillStep] = { note: tomPitch, velocity: ghostVel, length: tomDecaySteps };
                                        if (Math.random() < ghostVel) {
                                            newCH.steps[fillStep] = null;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (isSnare) {
                        if (stepIdx >= 0 && stepIdx < newSnare.steps.length) {
                            let snareNote = 'C4';
                            if (lastVowelBrightness === 1) snareNote = 'E4';
                            else if (lastVowelBrightness === 0) snareNote = 'A3';
                            newSnare.steps[stepIdx] = { note: snareNote, velocity: humanVelocity, length: durationSteps };
                        }
                        // Inject a ghost snare on the preceding step for a more organic feel
                        if (stepIdx - 1 >= 0 && stepIdx - 1 < newSnare.steps.length && !newSnare.steps[stepIdx - 1]) {
                            const ghostVel = finalVel * 0.4;
                            newSnare.steps[stepIdx - 1] = { note: tomPitch, velocity: ghostVel, length: tomDecaySteps };
                            if (Math.random() < ghostVel && stepIdx - 1 < newCH.steps.length) {
                                newCH.steps[stepIdx - 1] = null;
                            }
                        }
                    } else if (isOpenHat) {
                        if (stepIdx >= 0 && stepIdx < newOH.steps.length) newOH.steps[stepIdx] = { note: 'C4', velocity: humanVelocity, length: durationSteps };
                    } else if (isHat) {
                        if (stepIdx >= 0 && stepIdx < newCH.steps.length) newCH.steps[stepIdx] = { note: 'C4', velocity: humanVelocity, length: durationSteps };
                    } else {
                        if (stepIdx >= 0 && stepIdx < newCH.steps.length) newCH.steps[stepIdx] = { note: 'C4', velocity: humanVelocity * 0.7, length: durationSteps };
                    }

                    lastConsonantStep = stepIdx;
                }
            }
            newPattern.kick = newKick;
            newPattern.snare = newSnare;
            newPattern.closedHat = newCH;
            newPattern.openHat = newOH;
            newPattern.bass2 = newBass2;
            setPattern(newPattern);
            updateStorageForTrack('kick', newKick);
            updateStorageForTrack('snare', newSnare);
            updateStorageForTrack('closedHat', newCH);
            updateStorageForTrack('openHat', newOH);
            updateStorageForTrack('bass2', newBass2);
            showToast("Drumkit generated from text!", "success");
            setIsLyricTrackVisible(false);
        } catch(e) {
            console.error(e);
            showToast("Failed to generate drums.", "error");
        }
    }, [handleGenerateTTS, audioEngine, patternRef, tempoRef, activeSamplerBankRef, updateStorageForTrack, showToast, setPattern, setIsLyricTrackVisible, currentScale, setCurrentScale]);

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
                        const phraseProgress = Math.max(0, Math.min(1, i / alignment.phonemes.length));

                        // phraseProgress 0→1 → more crush at the end (fidelity degrades as the utterance progresses)
                        const bitcrushValue = phraseProgress;

                        newSteps[startStep] = {
                            note: pitches[currentPitchIdx] || 'C4',
                            velocity: 1,
                            length: durationSteps,
                            sliceIndex: i,
                            bitcrush: bitcrushValue,
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
