import { useCallback } from 'react'
import { automationStore } from '../../stores/automationStore'
import type { ReverbType } from '../../types'

export function useMasterHandlers(deps: {
    setMasterVolume: React.Dispatch<React.SetStateAction<number>>;
    setMasterSaturation: React.Dispatch<React.SetStateAction<number>>;
    setGlobalPan: React.Dispatch<React.SetStateAction<number>>;
    setReverbType: React.Dispatch<React.SetStateAction<ReverbType>>;
    audioEngine: any;
    currentStepRef: React.MutableRefObject<number>;
}) {
    const { setMasterVolume, setMasterSaturation, setGlobalPan, setReverbType, audioEngine, currentStepRef } = deps;

    const handleMasterVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseFloat(e.target.value);
        setMasterVolume(v);
        audioEngine?.setMasterVolume(v);
        if (automationStore.isParameterArmed('master', 'volume')) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('master', 'volume', { step, value: Math.max(0, Math.min(1, v)) });
        }
    }, [audioEngine, setMasterVolume, currentStepRef]);

    const handleMasterVolumeKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            setMasterVolume(0.8);
            audioEngine?.setMasterVolume(0.8);
        }
    }, [audioEngine, setMasterVolume]);

    const handleMasterVolumeReset = useCallback(() => {
        setMasterVolume(0.8);
        audioEngine?.setMasterVolume(0.8);
    }, [audioEngine, setMasterVolume]);

    const handleMasterSaturation = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseFloat(e.target.value);
        setMasterSaturation(v);
        audioEngine?.setMasterSaturation(v);
    }, [audioEngine, setMasterSaturation]);

    const handleMasterSaturationKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            setMasterSaturation(0);
            audioEngine?.setMasterSaturation(0);
        }
    }, [audioEngine, setMasterSaturation]);

    const handleMasterSaturationReset = useCallback(() => {
        setMasterSaturation(0);
        audioEngine?.setMasterSaturation(0);
    }, [audioEngine, setMasterSaturation]);

    const handleGlobalPan = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const p = parseFloat(e.target.value);
        const val = (p > -0.1 && p < 0.1) ? 0 : p;
        setGlobalPan(val);
        audioEngine?.setGlobalPan(val);
    }, [audioEngine, setGlobalPan]);

    const handleGlobalPanKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            setGlobalPan(0);
            audioEngine?.setGlobalPan(0);
        }
    }, [audioEngine, setGlobalPan]);

    const handleGlobalPanReset = useCallback(() => {
        setGlobalPan(0);
        audioEngine?.setGlobalPan(0);
    }, [audioEngine, setGlobalPan]);

    const handleReverbType = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const t = e.target.value as ReverbType;
        setReverbType(t);
        audioEngine?.setReverbType?.(t);
    }, [audioEngine, setReverbType]);

    return {
        handleMasterVolume,
        handleMasterVolumeKeyDown,
        handleMasterVolumeReset,
        handleMasterSaturation,
        handleMasterSaturationKeyDown,
        handleMasterSaturationReset,
        handleGlobalPan,
        handleGlobalPanKeyDown,
        handleGlobalPanReset,
        handleReverbType,
    };
}
