import type { MutableRefObject } from 'react';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';
import { MultisampleGenerator } from '../../engines/MultisampleGenerator';
import { SingingVoiceManager } from '../../engines/SingingVoiceManager';
import type { MultisampleBank, SamplerBankParams } from '../../types';

interface SampleManagementRefs {
    loadedSampleBuffersRef: MutableRefObject<Map<string, AudioBuffer>>;
    multisampleBanksRef: MutableRefObject<Map<string, MultisampleBank>>;
    multisampleGeneratorRef: MutableRefObject<MultisampleGenerator | null>;
    vocalAlignmentsRef: MutableRefObject<Map<string, AlignmentResult>>;
    singingVoiceManagerRef: MutableRefObject<SingingVoiceManager | null>;
}

export function createSampleLibraryControls(refs: SampleManagementRefs) {
    const loadSampleToEngine = async (
        name: string,
        buffer: AudioBuffer,
        onProgress?: (progress: number) => void,
    ): Promise<void> => {
        const sampleBank: MultisampleBank = {
            baseBuffer: buffer,
            pitchBank: new Map([[60, buffer]]),
            isProcessing: true,
            processingProgress: 0,
            rootNote: 60,
        };

        refs.loadedSampleBuffersRef.current.set(name, buffer);
        refs.multisampleBanksRef.current.set(name, sampleBank);

        if (refs.multisampleGeneratorRef.current && onProgress) {
            onProgress(0.05);

            try {
                const pitchBank = await refs.multisampleGeneratorRef.current.generateMultisamples(
                    buffer,
                    {
                        rootNote: 60,
                        range: [-12, 12],
                        preserveFormants: true,
                        quality: 'Standard',
                    },
                    (progress) => {
                        sampleBank.processingProgress = progress;
                        onProgress(0.05 + progress * 0.95);
                    },
                );

                sampleBank.pitchBank = pitchBank;
                sampleBank.isProcessing = false;
                sampleBank.processingProgress = 1.0;

                onProgress(1.0);
                console.log(`Multisample generation complete for ${name}: ${pitchBank.size} pitches`);
            } catch (error) {
                console.error('Multisample generation failed:', error);
                sampleBank.isProcessing = false;
                sampleBank.error = error instanceof Error ? error.message : 'Unknown error';
                onProgress(-1); // Preserve existing UI convention: -1 marks sample-generation failure.
            }
        } else if (onProgress) {
            onProgress(1.0);
        }
    };

    const getMultisampleBank = (bankIndex: number): MultisampleBank | null => {
        const bankName = `bank_${bankIndex}`;
        return refs.multisampleBanksRef.current.get(bankName) || null;
    };

    const isMultisampleReady = (bankIndex: number): boolean => {
        const bank = getMultisampleBank(bankIndex);
        return bank ? !bank.isProcessing : false;
    };

    const prepareVocal = async (bankIndex: number, text: string) => {
        if (!refs.singingVoiceManagerRef.current) {
            return;
        }

        const bankName = `bank_${bankIndex}`;
        const buffer = refs.loadedSampleBuffersRef.current.get(bankName);
        if (!buffer) {
            return;
        }

        const alignmentVoice = refs.singingVoiceManagerRef.current.getVoice(0);
        if (!alignmentVoice) {
            return;
        }

        const audio = buffer.getChannelData(0);
        try {
            const alignment = await alignmentVoice.alignPhonemes(audio, text);
            if (alignment) {
                refs.vocalAlignmentsRef.current.set(bankName, alignment);
                console.log(`Aligned phonemes for ${bankName}: ${alignment.phonemes.length}`);
            }
        } catch (error) {
            console.warn('Phoneme alignment failed:', error);
        }
    };

    const getAlignment = (bankIndex: number) => {
        const bankName = `bank_${bankIndex}`;
        return refs.vocalAlignmentsRef.current.get(bankName) || null;
    };

    const setAlignment = (bankIndex: number, alignment: AlignmentResult | null) => {
        const bankName = `bank_${bankIndex}`;
        if (alignment) {
            refs.vocalAlignmentsRef.current.set(bankName, alignment);
        } else {
            refs.vocalAlignmentsRef.current.delete(bankName);
        }
    };

    return {
        loadSampleToEngine,
        getMultisampleBank,
        isMultisampleReady,
        prepareVocal,
        getAlignment,
        setAlignment,
    };
}

interface VoiceParamUpdateOptions {
    manager: SingingVoiceManager | null;
    choirLeftGain: GainNode | null;
    choirRightGain: GainNode | null;
    currentTime: number;
    key: keyof SamplerBankParams;
    value: number;
    rampTime?: number;
}

export function applyVoiceParamUpdate({
    manager,
    choirLeftGain,
    choirRightGain,
    currentTime,
    key,
    value,
    rampTime
}: VoiceParamUpdateOptions): void {
    if (manager) {
        manager.getAllVoices().forEach((voice) => {
            switch (key) {
                case 'timeRatio':
                    voice.setTimeRatio(value);
                    break;
                case 'pitchScale':
                    voice.setPitch(value);
                    break;
                case 'formantShift':
                    voice.setFormantShift(value, undefined, rampTime);
                    break;
                case 'vibratoDepth':
                    voice.setVibratoDepth(value);
                    break;
                case 'breathIntensity':
                    voice.setBreathIntensity(value);
                    break;
                case 'freeze':
                    voice.setFreeze(value);
                    break;
                case 'freezeLfoRate':
                    voice.setFreezeLfoRate(value);
                    break;
                case 'freezeLfoDepth':
                    voice.setFreezeLfoDepth(value);
                    break;
                case 'attack':
                    voice.setAttack(value);
                    break;
                case 'release':
                    voice.setRelease(value);
                    break;
            }
        });
    }

    if (key === 'choir') {
        const gain = value * 0.7;
        choirLeftGain?.gain.setTargetAtTime(gain, currentTime, 0.05);
        choirRightGain?.gain.setTargetAtTime(gain, currentTime, 0.05);
    }
}

interface SamplerVoiceParamUpdateOptions {
    manager: SingingVoiceManager | null;
    currentTime: number;
    param: string;
    value: number | string | boolean;
}

export function applySamplerVoiceParamUpdate({
    manager,
    currentTime,
    param,
    value,
}: SamplerVoiceParamUpdateOptions): void {
    if (!manager) {
        return;
    }

    manager.getAllVoices().forEach((voice) => {
        switch (param) {
            case 'rootNote':
                voice.setRootNote(value as number);
                break;
            case 'coarseTune':
                voice.setCoarseTune(value as number);
                break;
            case 'fineTune':
                voice.setFineTune(value as number);
                break;
            case 'formantShift':
                voice.setFormantShift(value as number, currentTime);
                break;
            case 'pitchAttack':
                voice.setPitchAttack(value as number);
                break;
            case 'pitchDecay':
                voice.setPitchDecay(value as number);
                break;
        }
    });
}
