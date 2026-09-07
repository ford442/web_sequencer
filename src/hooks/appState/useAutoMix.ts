import { useCallback } from 'react'
import type { AudioEngine, Pattern, PartSequence, SamplerParams } from '../../types'

export function useAutoMix(deps: {
    patternRef: React.MutableRefObject<Pattern>;
    updateSynthA: (updates: any) => void;
    updateSynthB: (updates: any) => void;
    updateBass2: (updates: any) => void;
    updateKick: (updates: any) => void;
    updateSnare: (updates: any) => void;
    updateClosedHat: (updates: any) => void;
    updateOpenHat: (updates: any) => void;
    setSampler: React.Dispatch<React.SetStateAction<SamplerParams>>;
    setMasterVolume: React.Dispatch<React.SetStateAction<number>>;
    audioEngine: AudioEngine | null;
    synthA: { filterCutoff: number; filterResonance: number };
    synthB: { filterCutoff: number; filterResonance: number };
}) {
    const {
        patternRef, updateSynthA, updateSynthB, updateBass2, updateKick, updateSnare,
        updateClosedHat, updateOpenHat, setSampler, setMasterVolume, audioEngine,
        synthA, synthB,
    } = deps;

    const handleAutoMix = useCallback(() => {
        const pattern = patternRef.current;
        const calculateActivity = (trackSeq: PartSequence | null | undefined) => {
            if (!trackSeq || !trackSeq.steps) return 0;
            let activeSteps = 0;
            let totalVelocity = 0;
            const steps = trackSeq.steps;
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                if (step) {
                    activeSteps++;
                    totalVelocity += step.velocity || 1;
                }
            }
            return activeSteps === 0 ? 0 : totalVelocity / steps.length;
        };

        const synthAActivity = calculateActivity(pattern.partA);
        const synthBActivity = calculateActivity(pattern.partB);
        const bassActivity = calculateActivity(pattern.bass2);
        const kickActivity = calculateActivity(pattern.kick);
        const snareActivity = calculateActivity(pattern.snare);
        const closedHatActivity = calculateActivity(pattern.closedHat);
        const openHatActivity = calculateActivity(pattern.openHat);

        const samplerActivities = new Array(pattern.sampler.length);
        let totalSamplerActivity = 0;
        for (let i = 0; i < pattern.sampler.length; i++) {
            const activity = calculateActivity(pattern.sampler[i]);
            samplerActivities[i] = activity;
            totalSamplerActivity += activity;
        }

        let synthAPan = -0.3;
        let synthBPan = 0.3;
        if (synthAActivity > 0 && synthBActivity === 0) {
            synthAPan = 0;
        } else if (synthBActivity > 0 && synthAActivity === 0) {
            synthBPan = 0;
        }

        updateSynthA({ pan: synthAPan });
        updateSynthB({ pan: synthBPan });
        updateBass2({ pan: 0 });
        updateKick({ pan: 0 });
        updateSnare({ pan: 0 });
        updateClosedHat({ pan: 0.15 });
        updateOpenHat({ pan: 0.25 });

        setSampler(prev => {
            const next = [...prev];
            let panSpread = 0.4;
            if (totalSamplerActivity > 0.5) panSpread = 0.6;
            for (let i = 0; i < 8; i++) {
                const direction = i % 2 === 0 ? -1 : 1;
                const width = panSpread + (i * 0.05 * direction);
                next[i] = { ...next[i], pan: i === 0 ? 0 : Math.max(-1, Math.min(1, width)) };
            }
            return next;
        });

        const scaleVolume = (baseVol: number, activity: number) => {
            if (activity === 0) return baseVol;
            const reduction = Math.min(0.15, activity * 0.2);
            return Math.max(0.1, baseVol - reduction);
        };

        updateSynthA({ volume: scaleVolume(0.7, synthAActivity) });
        updateSynthB({ volume: scaleVolume(0.7, synthBActivity) });
        updateBass2({ volume: scaleVolume(0.85, bassActivity) });
        updateKick({ volume: scaleVolume(0.95, kickActivity) });
        updateSnare({ volume: scaleVolume(0.85, snareActivity) });
        updateClosedHat({ volume: scaleVolume(0.6, closedHatActivity) });
        updateOpenHat({ volume: scaleVolume(0.65, openHatActivity) });

        setSampler(prev => {
            const next = [...prev];
            for (let i = 0; i < 8; i++) {
                next[i] = { ...next[i], volume: scaleVolume(0.75, samplerActivities[i]) };
            }
            return next;
        });

        if (bassActivity > 0.1) {
            updateSynthA({ filterCutoff: Math.max(synthA.filterCutoff, 250) });
            updateSynthB({ filterCutoff: Math.max(synthB.filterCutoff, 250) });
        } else {
            if (synthA.filterCutoff > 100) updateSynthA({ filterCutoff: 100 });
            if (synthB.filterCutoff > 100) updateSynthB({ filterCutoff: 100 });
        }

        if (totalSamplerActivity > 0.3) {
            updateSynthA({ filterResonance: Math.min(synthA.filterResonance, 3) });
            updateSynthB({ filterResonance: Math.min(synthB.filterResonance, 3) });
        }

        setMasterVolume(0.85);
        if (audioEngine) {
            audioEngine.setMasterVolume(0.85);
        }

        console.log("Auto-Mix Assistant applied dynamic, content-aware mixing parameters.");
    }, [updateSynthA, updateSynthB, updateBass2, updateKick, updateSnare, updateClosedHat, updateOpenHat, audioEngine, synthA.filterCutoff, synthA.filterResonance, synthB.filterCutoff, synthB.filterResonance, setSampler, setMasterVolume, patternRef]);

    return { handleAutoMix };
}
