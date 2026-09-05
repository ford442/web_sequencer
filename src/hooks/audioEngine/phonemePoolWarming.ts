import type { MutableRefObject } from 'react';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';
import type { PhonemeBufferPool } from '../../services/PhonemeBufferPool';
import type { MultisampleBank } from '../../types';

interface PhonemePoolRefs {
    phonemeBufferPoolRef: MutableRefObject<PhonemeBufferPool | null>;
    vocalAlignmentsRef: MutableRefObject<Map<string, AlignmentResult>>;
    multisampleBanksRef: MutableRefObject<Map<string, MultisampleBank>>;
    loadedSampleBuffersRef: MutableRefObject<Map<string, AudioBuffer>>;
}

export function warmPoolForBank(
    pool: PhonemeBufferPool | null,
    sampleName: string,
    alignment: AlignmentResult,
    audioBuffer: AudioBuffer,
): void {
    if (!pool) return;
    const monoAudio = audioBuffer.getChannelData(0);
    const sr = audioBuffer.sampleRate;
    for (let i = 0; i < alignment.phonemes.length; i++) {
        const ph = alignment.phonemes[i];
        const startSample = Math.floor(ph.start * sr);
        const endSample = Math.floor(ph.end * sr);
        if (endSample <= startSample) continue;
        const slice = monoAudio.slice(startSample, endSample);
        pool.warmPhoneme(`${sampleName}_${i}`, [slice], sr);
    }
}

export function createPhonemeAlignmentWrappers(
    refs: PhonemePoolRefs,
    prepareVocalBase: (bankIndex: number, text: string, durationPriors?: number[]) => Promise<void>,
    setAlignmentBase: (bankIndex: number, alignment: AlignmentResult | null) => void,
) {
    const prepareVocal = async (bankIndex: number, text: string, durationPriors?: number[]): Promise<void> => {
        await prepareVocalBase(bankIndex, text, durationPriors);
        const sampleName = `bank_${bankIndex}`;
        const alignment = refs.vocalAlignmentsRef.current.get(sampleName);
        const audioBuffer = (refs.multisampleBanksRef.current.get(sampleName)?.baseBuffer)
            ?? refs.loadedSampleBuffersRef.current.get(sampleName);
        if (alignment && audioBuffer) {
            warmPoolForBank(refs.phonemeBufferPoolRef.current, sampleName, alignment, audioBuffer);
        }
    };

    const setAlignment = (bankIndex: number, alignment: AlignmentResult | null): void => {
        setAlignmentBase(bankIndex, alignment);
        if (alignment) {
            const sampleName = `bank_${bankIndex}`;
            const audioBuffer = (refs.multisampleBanksRef.current.get(sampleName)?.baseBuffer)
                ?? refs.loadedSampleBuffersRef.current.get(sampleName);
            if (audioBuffer) {
                warmPoolForBank(refs.phonemeBufferPoolRef.current, sampleName, alignment, audioBuffer);
            }
        }
    };

    return { prepareVocal, setAlignment };
}
