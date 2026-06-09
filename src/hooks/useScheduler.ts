// useScheduler — AudioWorklet-backed sequencer clock.
//
// Replaces the previous requestAnimationFrame scheduler, which was subject to
// 16 ms rAF jitter and background-tab throttling (rAF drops to ~1 Hz in hidden tabs).
//
// The AudioWorklet clock runs on the audio rendering thread, is never throttled,
// and provides sample-accurate `audioTime` values for each step so downstream
// callers can schedule Web Audio events into the future (see useStepHandler).
//
// Swing is forwarded to the worklet; the worklet adjusts step durations so
// even steps receive extra time and odd steps lose the same amount — classic
// 16th-note shuffle. swing=0 is perfectly straight; swing=1 is max shuffle.

import { useState, useEffect, useRef, useCallback } from 'react';

// Step callback receives (stepIndex, audioTime).
// audioTime is the AudioContext timestamp at which the step fires — use it
// directly as the `time` argument when scheduling Web Audio events.
export type StepCallback = (step: number, audioTime: number) => void;

// Loaded lazily on first play so the AudioContext is definitely available.
let clockModulePromise: Promise<void> | null = null;

function ensureClockModule(context: AudioContext): Promise<void> {
    if (!clockModulePromise) {
        // Vite ?worker&url import — same pattern as the other worklets in this project.
        // The dynamic import below is analysed by Vite; if you need to relocate the
        // processor file update the path here.
        clockModulePromise = import('../audio-worklets/clock-processor.ts?worker&url')
            .then(({ default: url }) => context.audioWorklet.addModule(url))
            .catch((err) => {
                clockModulePromise = null; // allow retry on next play
                throw err;
            });
    }
    return clockModulePromise;
}

export interface UseSchedulerOptions {
    /** AudioContext from the audio engine. null until the engine is ready. */
    context: AudioContext | null;
    tempo: number;
    /** Swing 0–1 (0 = straight, ~0.33 = light shuffle, 1 = max triplet shuffle). */
    swing?: number;
    steps: number;
    onStep: StepCallback;
    isAudioReady: boolean;
}

export interface UseSchedulerReturn {
    isPlaying: boolean;
    setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}

export const useScheduler = (
    tempo: number,
    steps: number,
    onStep: StepCallback,
    isAudioReady: boolean,
    context?: AudioContext | null,
    swing = 0,
): UseSchedulerReturn => {
    const [isPlaying, setIsPlaying] = useState(false);

    const onStepRef = useRef(onStep);
    const tempoRef = useRef(tempo);
    const swingRef = useRef(swing);
    const clockNodeRef = useRef<AudioWorkletNode | null>(null);

    useEffect(() => { onStepRef.current = onStep; }, [onStep]);

    // Forward tempo changes to the running worklet (no restart needed).
    useEffect(() => {
        tempoRef.current = tempo;
        clockNodeRef.current?.port.postMessage({ type: 'setTempo', tempo });
    }, [tempo]);

    // Forward swing changes to the running worklet.
    useEffect(() => {
        swingRef.current = swing;
        clockNodeRef.current?.port.postMessage({ type: 'setSwing', swing });
    }, [swing]);

    const startClock = useCallback(async () => {
        if (!context || !isAudioReady) return;

        if (context.state === 'suspended') {
            try {
                await context.resume();
            } catch (err) {
                console.error('[useScheduler] AudioContext.resume() failed:', err);
                setIsPlaying(false);
                return;
            }
        }

        try {
            await ensureClockModule(context);
        } catch (err) {
            console.error('[useScheduler] Clock worklet failed to load:', err);
            setIsPlaying(false);
            return;
        }

        // Tear down any stale node before creating a new one.
        if (clockNodeRef.current) {
            clockNodeRef.current.port.postMessage({ type: 'stop' });
            clockNodeRef.current.disconnect();
            clockNodeRef.current = null;
        }

        const node = new AudioWorkletNode(context, 'clock-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 0,
        });

        node.port.onmessage = (e: MessageEvent) => {
            if (e.data?.type === 'step') {
                onStepRef.current(e.data.step, e.data.audioTime);
            }
        };

        // Configure before starting.
        node.port.postMessage({ type: 'setTempo', tempo: tempoRef.current });
        node.port.postMessage({ type: 'setSwing', swing: swingRef.current });
        node.port.postMessage({ type: 'setSteps', steps });
        node.port.postMessage({ type: 'start' });

        // The clock node needs to stay in the audio graph to keep its process()
        // called. Connecting to destination with zero output channels is the
        // idiomatic way to keep a no-output processor alive.
        node.connect(context.destination);

        clockNodeRef.current = node;
    }, [context, isAudioReady, steps]);

    const stopClock = useCallback(() => {
        if (clockNodeRef.current) {
            clockNodeRef.current.port.postMessage({ type: 'stop' });
            clockNodeRef.current.disconnect();
            clockNodeRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (isPlaying && isAudioReady) {
            startClock();
        } else {
            stopClock();
        }
        return () => stopClock();
    }, [isPlaying, isAudioReady, startClock, stopClock]);

    return { isPlaying, setIsPlaying };
};
