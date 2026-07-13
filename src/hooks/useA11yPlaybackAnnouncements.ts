import { useEffect, useRef } from 'react';
import type { TrackKey } from '../types';
import { a11yAnnouncerStore } from '../stores/a11yAnnouncerStore';
import { automationStore } from '../stores/automationStore';
interface PlaybackAnnounceOptions {
    isPlaying: boolean;
    isAutomationRecording: boolean;
    selectedTrack: TrackKey;
    activeTrackSlots: Record<TrackKey, number>;
    viewMode: 'notes' | 'automation';
    automationParam?: string;
    isSongModeActive: boolean;
    currentSongMeasure: number;
}

const ROW_LABEL: Partial<Record<TrackKey, string>> = {
    partA: 'Lead',
    partB: 'Bass',
    bass2: 'Bass2',
    kick: 'Kick',
    snare: 'Snare',
    closedHat: 'CH',
    openHat: 'OH',
    sampler: 'SMP',
};

/** Announces playhead, pattern, and automation state changes to the live region. */
export function useA11yPlaybackAnnouncements({
    isPlaying,
    isAutomationRecording,
    selectedTrack,
    activeTrackSlots,
    viewMode,
    automationParam,
    isSongModeActive,
    currentSongMeasure,
}: PlaybackAnnounceOptions): void {
    const wasPlayingRef = useRef(isPlaying);
    const lastStepRef = useRef(-1);
    const lastPatternRef = useRef(activeTrackSlots[selectedTrack]);
    const lastAutomationRef = useRef(isAutomationRecording);
    const lastViewRef = useRef(viewMode);
    const lastSongMeasureRef = useRef(currentSongMeasure);

    useEffect(() => {
        if (isPlaying && !wasPlayingRef.current) {
            a11yAnnouncerStore.announce('Playback started', 'polite');
        } else if (!isPlaying && wasPlayingRef.current) {
            a11yAnnouncerStore.announce('Playback stopped', 'polite');
        }
        wasPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => {
        if (isAutomationRecording !== lastAutomationRef.current) {
            a11yAnnouncerStore.announce(
                isAutomationRecording ? 'Automation recording on' : 'Automation recording off',
                'assertive',
            );
            lastAutomationRef.current = isAutomationRecording;
        }
    }, [isAutomationRecording]);

    useEffect(() => {
        const slot = activeTrackSlots[selectedTrack];
        if (slot !== lastPatternRef.current) {
            const label = ROW_LABEL[selectedTrack] ?? selectedTrack;
            a11yAnnouncerStore.announce(`${label} pattern ${slot + 1} selected`, 'polite');
            lastPatternRef.current = slot;
        }
    }, [activeTrackSlots, selectedTrack]);

    useEffect(() => {
        if (viewMode !== lastViewRef.current) {
            if (viewMode === 'automation' && automationParam) {
                a11yAnnouncerStore.announce(`Automation view: ${automationParam}`, 'polite');
            } else if (viewMode === 'notes') {
                a11yAnnouncerStore.announce('Note view', 'polite');
            }
            lastViewRef.current = viewMode;
        }
    }, [viewMode, automationParam]);

    useEffect(() => {
        if (!isSongModeActive) return;
        if (currentSongMeasure !== lastSongMeasureRef.current) {
            a11yAnnouncerStore.announce(`Song measure ${currentSongMeasure + 1}`, 'polite');
            lastSongMeasureRef.current = currentSongMeasure;
        }
    }, [isSongModeActive, currentSongMeasure]);

    useEffect(() => {
        if (!isPlaying) {
            lastStepRef.current = -1;
            return;
        }

        let raf = 0;
        const tick = () => {
            const step = automationStore.getState().playbackStep;
            if (step !== lastStepRef.current && step >= 0) {
                lastStepRef.current = step;
                if (step % 4 === 0) {
                    a11yAnnouncerStore.announce(`Step ${step + 1}`, 'polite');
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [isPlaying]);
}
