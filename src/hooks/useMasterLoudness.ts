// useMasterLoudness — subscribes the UI to the master-bus loudness worklet.
//
// The worklet pushes scalar snapshots at ≤ 30 Hz; this hook mirrors the latest
// one into React state and exposes the (unidirectional) settings writer. No
// audio buffers and no AudioNodes are handed to components.

import { useCallback, useEffect, useState } from 'react';

import {
    DEFAULT_LIMITER_SETTINGS,
    IDLE_LOUDNESS_STATS,
    subscribeMasterLoudnessStage,
    type LimiterSettings,
    type LoudnessStats,
    type MasterLoudnessStage,
} from '../audio/loudness';

export interface UseMasterLoudnessResult {
    stats: LoudnessStats;
    settings: LimiterSettings;
    /** True once the worklet is running — the UI shows a disabled strip until then. */
    ready: boolean;
    /** Added monitor latency from the limiter lookahead, in seconds. */
    latencySeconds: number;
    setSettings: (update: Partial<LimiterSettings>) => void;
    resetLoudness: () => void;
}

export function useMasterLoudness(): UseMasterLoudnessResult {
    const [stage, setStage] = useState<MasterLoudnessStage | null>(null);
    const [stats, setStats] = useState<LoudnessStats>(IDLE_LOUDNESS_STATS);
    const [settings, setLocalSettings] = useState<LimiterSettings>(DEFAULT_LIMITER_SETTINGS);
    const [latencySeconds, setLatencySeconds] = useState(0);

    useEffect(() => subscribeMasterLoudnessStage(setStage), []);

    useEffect(() => {
        if (!stage) {
            setStats(IDLE_LOUDNESS_STATS);
            return;
        }
        setLocalSettings(stage.getSettings());
        setStats(stage.latestStats);
        return stage.subscribe((next) => {
            setStats(next);
            setLatencySeconds(stage.latencySeconds);
        });
    }, [stage]);

    const setSettings = useCallback(
        (update: Partial<LimiterSettings>) => {
            setLocalSettings((previous) => ({ ...previous, ...update }));
            stage?.update(update);
        },
        [stage],
    );

    const resetLoudness = useCallback(() => {
        stage?.resetLoudness();
    }, [stage]);

    return {
        stats,
        settings,
        ready: stage !== null,
        latencySeconds,
        setSettings,
        resetLoudness,
    };
}
