import { useState, useEffect, useRef, useCallback } from 'react';
import type { Pattern, SongStructure, PartSequence, PlayMode, TrackKey } from '../types';

export interface SchedulerConfig {
    mode: PlayMode;
    pattern: Pattern;
    song: SongStructure;
    trackStorage: Record<TrackKey, (PartSequence | null)[]>;
}

export const useScheduler = (
    tempo: number,
    config: SchedulerConfig,
    onStep: (step: { songStep: number, subStep: number }, time: number) => void,
    isAudioReady: boolean,
    getCurrentTime: () => number,
    lookahead: number = 0.1
) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentSubStep, setCurrentSubStep] = useState(-1);
    const [currentSongStep, setCurrentSongStep] = useState(-1);

    const onStepRef = useRef(onStep);
    const tempoRef = useRef(tempo);
    const configRef = useRef(config);
    const nextStepTime = useRef(0);
    const subStepRef = useRef(-1);
    const songStepRef = useRef(-1);
    const workerRef = useRef<Worker | null>(null);
    const currentPatternLength = useRef(16);

    const processTickRef = useRef<() => void>(() => {});

    useEffect(() => { onStepRef.current = onStep; }, [onStep]);
    useEffect(() => { tempoRef.current = tempo; }, [tempo]);
    useEffect(() => { configRef.current = config; }, [config]);

    useEffect(() => {
        const worker = new Worker(new URL('../workers/clock.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        worker.onmessage = (e) => {
            if (e.data === 'tick') {
                processTickRef.current();
            }
        };
        return () => { worker.terminate(); };
    }, []);

    const processTick = useCallback(() => {
        if (!isAudioReady || !isPlaying) return;

        const now = getCurrentTime();
        if (now === 0) return;

        if (nextStepTime.current === 0) {
            nextStepTime.current = now;
        }

        // Failsafe: If nextStepTime fell too far behind (e.g. tab backgrounded), reset it to avoid "catch-up" bursts
        if (nextStepTime.current < now - 0.5) {
             nextStepTime.current = now;
        }

        const stepDuration = 60 / tempoRef.current / 4; // 16th notes

        while (nextStepTime.current < now + lookahead) {
            const { mode, pattern, song, trackStorage } = configRef.current;

            if (mode === 'song' && subStepRef.current === -1) {
                // First step of a new song position
                songStepRef.current++;
                if (songStepRef.current >= song.loopLength) {
                    if (song.loop) {
                        songStepRef.current = 0;
                    } else {
                        setIsPlaying(false);
                        return;
                    }
                }

                // Determine the max length of patterns in the current song step
                let maxLength = 0;
                song.steps.forEach((track, trackIndex) => {
                    const trackKey = Object.keys(trackStorage)[trackIndex];
                    const patternIndex = track[songStepRef.current]?.patternIndex;
                    if (patternIndex !== null && patternIndex !== undefined) {
                        const pattern = (trackStorage as Record<string, (PartSequence | null)[]>)[trackKey]?.[patternIndex];
                        if (pattern && pattern.steps.length > maxLength) {
                            maxLength = pattern.steps.length;
                        }
                    }
                });
                currentPatternLength.current = maxLength > 0 ? maxLength : 16;
            }

            subStepRef.current++;

            if (mode === 'pattern') {
                if (subStepRef.current >= pattern.length) {
                    subStepRef.current = 0;
                }
            } else { // Song Mode
                if (subStepRef.current >= currentPatternLength.current) {
                    subStepRef.current = -1; // Reset to trigger next song step logic
                    continue; // Re-run the loop for the new song step immediately
                }
            }

            const step = {
                songStep: songStepRef.current,
                subStep: subStepRef.current
            };

            onStepRef.current(step, nextStepTime.current);

            // Update UI state
            setCurrentSubStep(step.subStep);
            setCurrentSongStep(step.songStep);

            nextStepTime.current += stepDuration;
        }
    }, [isPlaying, isAudioReady, getCurrentTime, lookahead]);

    useEffect(() => {
        processTickRef.current = processTick;
    }, [processTick]);

    useEffect(() => {
        if (isPlaying && isAudioReady) {
            subStepRef.current = -1;
            songStepRef.current = config.mode === 'song' ? -1 : 0;
            // Ensure we get a valid time. If context is weird, default to 0 and let processTick fix it.
            nextStepTime.current = getCurrentTime();
            workerRef.current?.postMessage('start');
        } else {
            workerRef.current?.postMessage('stop');
            setCurrentSubStep(-1);
            setCurrentSongStep(-1);
        }
    }, [isPlaying, isAudioReady, config.mode]);

    return { isPlaying, currentSubStep, currentSongStep, setIsPlaying };
};
