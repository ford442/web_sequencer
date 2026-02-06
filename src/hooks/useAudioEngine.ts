import { type AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import { useState } from 'react';

const playSampler = (params: SamplerBankParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.2) => {
    // ...existing playSampler code...
};

const handleSamplerParamChange = (bankIdx: number, key: keyof SamplerBankParams, value: number) => {
    setSamplerParams(prev => {
        const newParams = [...prev];
        newParams[bankIdx] = { ...newParams[bankIdx], [key]: value };
        return newParams;
    });

    const voice = singingVoiceRef.current;
    if (voice && voice.workletNode) {
        const now = audioContext.currentTime;
        switch (key) {
            case 'timeRatio':
                voice.workletNode.parameters.get('timeRatio')?.setValueAtTime(value, now);
                break;
            case 'pitchScale':
                voice.workletNode.parameters.get('pitchScale')?.setValueAtTime(value, now);
                break;
            case 'formantShift':
                // Map to formant scale or postMessage
                voice.workletNode.parameters.get('formantScale')?.setValueAtTime(value / 12, now); // Normalize
                break;
            case 'vibratoDepth':
                voice.workletNode.parameters.get('vibratoDepth')?.setValueAtTime(value / 100, now);
                break;
            case 'breathIntensity':
                voice.workletNode.parameters.get('breathIntensity')?.setValueAtTime(value, now);
                break;
        }
    }
};

return {
    // ...existing returns...
    onParamChange: handleSamplerParamChange,
    // ...existing...
};