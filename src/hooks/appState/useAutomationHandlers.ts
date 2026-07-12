import { useCallback, useEffect } from 'react'
import { automationStore } from '../../stores/automationStore'
import { NUM_STEPS } from '../../constants'
import type { Pattern, AutomationTarget } from '../../types'
import type { TrackKey } from '../../constants/appDefaults'
import { GLOBAL_ARM_PARAMS } from './constants'

export function useAutomationHandlers(deps: {
    automationParam: string;
    patternRef: React.MutableRefObject<Pattern>;
    setPattern: React.Dispatch<React.SetStateAction<Pattern>>;
    activeSamplerBankRef: React.MutableRefObject<number>;
    updateStorageForTrack: (track: TrackKey, sequence: any) => void;
    currentStepRef: React.MutableRefObject<number>;
    schedPlaying: boolean;
    isAutomationRecording: boolean;
    isSongModeActive: boolean;
    activeTrackSlotsRef: React.MutableRefObject<Record<TrackKey, number>>;
    isSongModeActiveRef: React.MutableRefObject<boolean>;
}) {
    const {
        automationParam, patternRef, setPattern, activeSamplerBankRef, updateStorageForTrack,
        currentStepRef, schedPlaying, isAutomationRecording, isSongModeActive,
        activeTrackSlotsRef, isSongModeActiveRef,
    } = deps;

    const handleAutomationChange = useCallback((trackKey: TrackKey, step: number, value: number | boolean) => {
        const prev = patternRef.current;
        let newPattern = prev;

        if (trackKey === 'sampler') {
            const bankIdx = activeSamplerBankRef.current;
            const bank = prev.sampler[bankIdx];
            const nextAutomation = bank.automation ? { ...bank.automation } : {};
            const nextParamArray = nextAutomation[automationParam]
                ? [...nextAutomation[automationParam]]
                : Array(NUM_STEPS).fill(null);

            nextParamArray[step] = value;

            nextAutomation[automationParam] = nextParamArray;
            newPattern = {
                ...prev,
                sampler: prev.sampler.map((b, i) => 
                    i === bankIdx ? { ...b, automation: nextAutomation } : b
                )
            };
            updateStorageForTrack(trackKey, newPattern.sampler);
        } else {
            const track = prev[trackKey] as any;
            const nextAutomation = track.automation ? { ...track.automation } : {};
            const nextParamArray = nextAutomation[automationParam]
                ? [...nextAutomation[automationParam]]
                : Array(NUM_STEPS).fill(null);

            nextParamArray[step] = value;

            nextAutomation[automationParam] = nextParamArray;
            const nextTrack = { ...track, automation: nextAutomation };
            newPattern = { ...prev, [trackKey]: nextTrack };
            updateStorageForTrack(trackKey, newPattern[trackKey]);
        }

        setPattern(newPattern);
    }, [automationParam, updateStorageForTrack, activeSamplerBankRef, patternRef, setPattern]);

    const handleKnobRecordToggle = useCallback((target: AutomationTarget, paramId: string) => {
        if (automationStore.isParameterArmed(target, paramId)) {
            if (schedPlaying) {
                const scope: 'pattern' | 'song' = isSongModeActiveRef.current ? 'song' : 'pattern';
                const patternIdx = isSongModeActiveRef.current ? undefined : (activeTrackSlotsRef.current['partA'] ?? 0);
                automationStore.stopRecording(target, paramId, { scope, patternIndex: patternIdx, name: `${target}.${paramId} (recorded)` });
            } else {
                automationStore.cancelRecording(target, paramId);
            }
            automationStore.disarmParameter(target, paramId);
        } else {
            automationStore.armParameter(target, paramId);
            if (schedPlaying) {
                automationStore.startRecording(target, paramId);
            }
        }
    }, [schedPlaying, isSongModeActiveRef, activeTrackSlotsRef]);

    useEffect(() => {
        if (isAutomationRecording && schedPlaying) {
            GLOBAL_ARM_PARAMS.forEach(({ target, param }) => {
                if (!automationStore.isParameterArmed(target, param)) {
                    automationStore.armParameter(target, param);
                }
                const buf = automationStore.getState().recordingBuffers.find(b => b.target === target && b.parameter === param && b.isRecording);
                if (!buf) {
                    automationStore.startRecording(target, param);
                }
            });
        } else if (!isAutomationRecording || !schedPlaying) {
            GLOBAL_ARM_PARAMS.forEach(({ target, param }) => {
                if (automationStore.isParameterArmed(target, param)) {
                    const scope: 'pattern' | 'song' = isSongModeActive ? 'song' : 'pattern';
                    const patternIdx = isSongModeActive ? undefined : (activeTrackSlotsRef.current['partA'] ?? 0);
                    automationStore.stopRecording(target, param, { scope, patternIndex: patternIdx, name: `${target}.${param} (recorded)` });
                    automationStore.disarmParameter(target, param);
                }
            });
        }
    }, [isAutomationRecording, schedPlaying, isSongModeActive, activeTrackSlotsRef]);

    return {
        handleAutomationChange,
        handleKnobRecordToggle,
    };
}
