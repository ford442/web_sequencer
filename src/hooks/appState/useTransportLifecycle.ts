import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { AudioEngine } from '../../types'
import type { AutomationScheduler } from '../../audio/automation/AutomationScheduler'
import { broadcastPcfTransport } from '../../audio/pcf/pcfInsert'
import { automationStore } from '../../stores/automationStore'
import { arrangementPlayhead } from '../../arrangement/playhead'
import { transportPlayhead } from '../../sequencer/transportPlayhead'
import type { MainSequencerHandle } from '../../components/MainSequencer'
import type { SessionLaunchEngine } from '../../session/SessionLaunchEngine'

/**
 * What follows the scheduler's play state: the UI's `isPlaying`, the session
 * clock's tempo, the PCF patterns, and the reset on stop. Moved out of
 * `useAppState()` unchanged (#1597 P2 split).
 */
export function useTransportLifecycle(deps: {
    schedPlaying: boolean;
    tempo: number;
    audioEngine: AudioEngine | null;
    setIsPlaying: (playing: boolean) => void;
    setCurrentSongMeasure: (measure: number) => void;
    songMeasureRef: MutableRefObject<number>;
    isFirstStepRef: MutableRefObject<boolean>;
    sequencerRef: RefObject<MainSequencerHandle | null>;
    currentStepRef: MutableRefObject<number>;
    automationSchedulerRef: MutableRefObject<AutomationScheduler | null>;
    sessionClockRef: MutableRefObject<{ tempo: number }>;
    sessionEngineRef: MutableRefObject<SessionLaunchEngine | null>;
}): void {
    const {
        schedPlaying, tempo, audioEngine, setIsPlaying, setCurrentSongMeasure, songMeasureRef, isFirstStepRef,
        sequencerRef, currentStepRef, automationSchedulerRef, sessionClockRef, sessionEngineRef,
    } = deps;

    useEffect(() => {
        sessionClockRef.current.tempo = tempo;
    }, [tempo, sessionClockRef]);
    useEffect(() => setIsPlaying(schedPlaying), [schedPlaying, setIsPlaying]);

    // Master PCF pattern: restart on play, freeze on stop, follow the tempo.
    const pcfEffect = audioEngine?.pcfEffect ?? null;
    const pcfPlayingRef = useRef(false);
    useEffect(() => {
        if (!pcfEffect) return;
        const started = schedPlaying && !pcfPlayingRef.current;
        pcfPlayingRef.current = schedPlaying;
        // Placed PCF nodes step with the master.
        broadcastPcfTransport(pcfEffect, schedPlaying, tempo, started ? 0 : undefined);
    }, [schedPlaying, tempo, pcfEffect]);

    useEffect(() => {
        if (schedPlaying) return;
        songMeasureRef.current = 0;
        setCurrentSongMeasure(0);
        isFirstStepRef.current = true;
        arrangementPlayhead.publish(-1);
        transportPlayhead.stop();
        if (sequencerRef.current) sequencerRef.current.setHighlight(-1);
        currentStepRef.current = -1;
        sessionEngineRef.current?.resetTransport();
        automationStore.clearLiveValues();
        automationSchedulerRef.current?.cancelAll();
    }, [schedPlaying, songMeasureRef, setCurrentSongMeasure, isFirstStepRef, sessionEngineRef, sequencerRef, currentStepRef, automationSchedulerRef]);
}
