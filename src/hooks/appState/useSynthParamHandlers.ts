import { useCallback } from 'react'
import { automationStore } from '../../stores/automationStore'
import type { AutomationTarget, SamplerBankParams, SamplerParams } from '../../types'

export function useSynthParamHandlers(deps: {
    updateSynthA: (updates: any) => void;
    updateSynthB: (updates: any) => void;
    updateBass2: (updates: any) => void;
    updateKick: (updates: any) => void;
    updateSnare: (updates: any) => void;
    updateClosedHat: (updates: any) => void;
    updateOpenHat: (updates: any) => void;
    setSampler: React.Dispatch<React.SetStateAction<SamplerParams>>;
    activeSamplerBank: number;
    currentStepRef: React.MutableRefObject<number>;
    samplerRef: React.MutableRefObject<SamplerParams>;
}) {
    const {
        updateSynthA, updateSynthB, updateBass2, updateKick, updateSnare,
        updateClosedHat, updateOpenHat, setSampler, activeSamplerBank,
        currentStepRef, samplerRef,
    } = deps;

    const handleSynthChange = useCallback((isA: boolean, id: string, val: number) => {
        const updater = isA ? updateSynthA : updateSynthB;
        let realVal = val;
        if (id === 'pitch') realVal = Math.floor(val * 48 - 24);
        else if (id === 'filterCutoff') realVal = val * 8000;
        else if (id === 'filterResonance') realVal = val * 20;
        else if (id === 'filterMode') realVal = Math.round(val);
        else if (id === 'decay') realVal = val * 2;
        else if (id === 'release') realVal = val * 2;
        else if (id === 'length') realVal = val * 2;
        updater({ [id]: realVal });
        const target: AutomationTarget = isA ? 'synthA' : 'synthB';
        if (automationStore.isParameterArmed(target, id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint(target, id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateSynthA, updateSynthB, currentStepRef]);

    const handleBass2Change = useCallback((id: string, val: number) => {
        let realVal = val;
        if (id === 'waveform') realVal = val > 0.5 ? 1 : 0;
        else if (id === 'cutoff') realVal = val * 8000;
        else if (id === 'resonance') realVal = val * 20;
        else if (id === 'filterMode') realVal = Math.round(val);
        else if (id === 'decay') realVal = val * 2;
        else if (id === 'pitch') realVal = Math.floor(val * 48 - 24);
        updateBass2({ [id]: realVal });
        if (automationStore.isParameterArmed('bass2', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('bass2', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateBass2, currentStepRef]);

    const handleKickChange = useCallback((id: string, val: number) => {
        let realVal = val;
        if (id === 'pitch') realVal = val * 130 + 20;
        updateKick({ [id]: realVal });
        if (automationStore.isParameterArmed('kick', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('kick', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateKick, currentStepRef]);

    const handleSnareChange = useCallback((id: string, val: number) => {
        let realVal = val;
        if (id === 'tone') realVal = val * 300 + 100;
        else if (id === 'noise') realVal = val * 7000 + 1000;
        else if (id === 'decay') realVal = val * 0.5;
        updateSnare({ [id]: realVal });
        if (automationStore.isParameterArmed('snare', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('snare', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateSnare, currentStepRef]);

    const handleClosedHatChange = useCallback((id: string, val: number) => {
        updateClosedHat({ [id]: val });
        if (automationStore.isParameterArmed('closedHat', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('closedHat', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateClosedHat, currentStepRef]);

    const handleOpenHatChange = useCallback((id: string, val: number) => {
        updateOpenHat({ [id]: val });
        if (automationStore.isParameterArmed('openHat', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('openHat', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateOpenHat, currentStepRef]);

    const handleSamplerChange = useCallback((id: string, val: number) => {
        let realVal = val;
        if (id === 'playbackSpeed') realVal = val * 4.0;
        else if (id === 'filterCutoff') realVal = val * 20000;
        else if (id === 'filterResonance') realVal = val * 20;
        setSampler(prev => {
            const next = [...prev];
            const currentBank = next[activeSamplerBank];
            next[activeSamplerBank] = { ...currentBank, [id]: realVal };
            return next;
        });
        if (automationStore.isParameterArmed('sampler', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            let norm = val;
            if (id === 'filterCutoff') norm = Math.max(0, Math.min(1, val / 20000));
            else if (id === 'filterResonance') norm = Math.max(0, Math.min(1, val / 20));
            else if (id === 'volume') norm = Math.max(0, Math.min(1, val));
            automationStore.recordPoint('sampler', id, { step, value: norm });
        }
    }, [activeSamplerBank, setSampler, currentStepRef]);

    const handleSamplerParamChange = useCallback((bankIdx: number, key: string, val: any) => {
        setSampler(prev => {
            const next = [...prev];
            if (next[bankIdx]) {
                next[bankIdx] = { ...next[bankIdx], [key as keyof SamplerBankParams]: val };
            }
            samplerRef.current = next;
            return next;
        });
    }, [setSampler, samplerRef]);

    const onSynthAParamChange = useCallback((id: string, v: number) => handleSynthChange(true, id, v), [handleSynthChange]);
    const onSynthBParamChange = useCallback((id: string, v: number) => handleSynthChange(false, id, v), [handleSynthChange]);
    const onBass2ParamChange = useCallback((id: string, v: number) => handleBass2Change(id, v), [handleBass2Change]);

    return {
        handleSynthChange,
        handleBass2Change,
        handleKickChange,
        handleSnareChange,
        handleClosedHatChange,
        handleOpenHatChange,
        handleSamplerChange,
        handleSamplerParamChange,
        onSynthAParamChange,
        onSynthBParamChange,
        onBass2ParamChange,
    };
}
