import { useCallback, useEffect, useRef, useState } from 'react'
import { automationStore } from '../../stores/automationStore'
import { type HarmonizerConfig } from '../../engines/Harmonizer'
import type { SamplerBankParams, SamplerParams } from '../../types'

export function useSamplerVoiceState(deps: {
    audioEngine: any;
    sampler: SamplerParams;
    activeSamplerBank: number;
    activeSamplerBankRef: React.MutableRefObject<number>;
    samplerRef: React.MutableRefObject<SamplerParams>;
    setSampler: React.Dispatch<React.SetStateAction<SamplerParams>>;
    currentStepRef: React.MutableRefObject<number>;
}) {
    const { audioEngine, sampler, activeSamplerBank, activeSamplerBankRef, samplerRef, setSampler, currentStepRef } = deps;

    const samplerVoiceParamsRef = useRef({
        drive: 0,
        rootNote: 60,
        coarseTune: 0,
        fineTune: 0,
        formantShift: 0,
        attack: 0,
        decay: 0.5,
        vibratoRate: 5.5,
        vibratoDepth: 0,
        tremoloDepth: 0,
        breathAmount: 0,
        quality: 'good' as 'preview' | 'good' | 'better' | 'best',
        stretchMode: 'Time' as 'Time' | 'Pitch' | 'Formant',
        lockToSequencer: false
    });
    const [samplerVoiceParams, setSamplerVoiceParams] = useState(samplerVoiceParamsRef.current);

    const [harmonizerConfig, setHarmonizerConfig] = useState<HarmonizerConfig>({
        voiceCount: 2,
        harmonyType: 'third',
        detuneSpread: 15,
        formantSpread: 3,
        busGain: 0.85
    });
    const [isHarmonizeActive, setIsHarmonizeActive] = useState(false);

    const handleHarmonizerConfigChange = useCallback((config: HarmonizerConfig, isActive: boolean) => {
        setHarmonizerConfig(config);
        setIsHarmonizeActive(isActive);
        if (audioEngine?.setHarmonizerConfig) {
            audioEngine.setHarmonizerConfig(config, isActive);
        }
    }, [audioEngine]);

    const handleSamplerVoiceChange = useCallback((param: string, value: number | string | boolean) => {
        const newParams = { ...samplerVoiceParamsRef.current, [param]: value };
        samplerVoiceParamsRef.current = newParams;
        setSamplerVoiceParams(newParams);
        setSampler(prev => {
            const next = [...prev];
            const bankIndex = activeSamplerBankRef.current;
            const current = next[bankIndex];
            if (!current) return prev;

            const nextBank: SamplerBankParams = {
                ...current,
                [param]: value as any,
            };

            if (param === 'breathAmount') {
                nextBank.breathIntensity = value as number;
            }
            if (param === 'vibratoRate' || param === 'vibratoDepth' || param === 'tremoloDepth' || param === 'breathAmount') {
                nextBank.expressiveness = {
                    vibratoRate: param === 'vibratoRate' ? value as number : current.expressiveness?.vibratoRate ?? 5.5,
                    vibratoDepth: param === 'vibratoDepth' ? value as number : current.expressiveness?.vibratoDepth ?? (current.vibratoDepth ?? 0),
                    tremoloDepth: param === 'tremoloDepth' ? value as number : current.expressiveness?.tremoloDepth ?? (current.tremoloDepth ?? 0),
                    breathAmount: param === 'breathAmount' ? value as number : current.expressiveness?.breathAmount ?? (current.breathIntensity ?? 0),
                };
            }

            next[bankIndex] = nextBank;
            samplerRef.current = next;
            return next;
        });
        if (audioEngine?.updateSamplerVoiceParams) {
            audioEngine.updateSamplerVoiceParams(activeSamplerBankRef.current, param, value);
        }

        if (automationStore.isParameterArmed('sampler', param)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            let norm = typeof value === 'number' ? value : 0;
            if (param === 'formantShift') norm = (norm + 1) / 2;
            automationStore.recordPoint('sampler', param, { step, value: Math.max(0, Math.min(1, norm)) });
        }
    }, [audioEngine, activeSamplerBankRef, samplerRef, setSampler, currentStepRef]);

    useEffect(() => {
        const bank = sampler[activeSamplerBank];
        if (!bank) return;
        const expressiveness = bank.expressiveness;
        const nextParams = {
            ...samplerVoiceParamsRef.current,
            rootNote: bank.rootNote ?? samplerVoiceParamsRef.current.rootNote,
            coarseTune: bank.coarseTune ?? samplerVoiceParamsRef.current.coarseTune,
            fineTune: bank.fineTune ?? samplerVoiceParamsRef.current.fineTune,
            formantShift: bank.formantShift ?? samplerVoiceParamsRef.current.formantShift,
            attack: bank.attack ?? samplerVoiceParamsRef.current.attack,
            decay: bank.decay ?? samplerVoiceParamsRef.current.decay,
            quality: bank.quality ?? samplerVoiceParamsRef.current.quality,
            stretchMode: bank.stretchMode ?? samplerVoiceParamsRef.current.stretchMode,
            lockToSequencer: bank.lockToSequencer ?? samplerVoiceParamsRef.current.lockToSequencer,
            vibratoRate: expressiveness?.vibratoRate ?? samplerVoiceParamsRef.current.vibratoRate,
            vibratoDepth: expressiveness?.vibratoDepth ?? bank.vibratoDepth ?? samplerVoiceParamsRef.current.vibratoDepth,
            tremoloDepth: expressiveness?.tremoloDepth ?? bank.tremoloDepth ?? samplerVoiceParamsRef.current.tremoloDepth,
            breathAmount: expressiveness?.breathAmount ?? bank.breathIntensity ?? samplerVoiceParamsRef.current.breathAmount,
        };
        samplerVoiceParamsRef.current = nextParams;
        setSamplerVoiceParams(nextParams);
    }, [sampler, activeSamplerBank]);

    return {
        samplerVoiceParamsRef,
        samplerVoiceParams,
        setSamplerVoiceParams,
        harmonizerConfig,
        setHarmonizerConfig,
        isHarmonizeActive,
        setIsHarmonizeActive,
        handleHarmonizerConfigChange,
        handleSamplerVoiceChange,
    };
}
