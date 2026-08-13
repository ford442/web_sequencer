// useScheduler — thin React wrapper over TransportClockController (internal mode default).

import { useState, useEffect, useRef, useCallback } from 'react';
import { transportClockController } from '../midi/clock/TransportClockController';
import { engineTelemetry } from '../utils/engineTelemetry';

export type StepCallback = (step: number, audioTime: number) => void;

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

    useEffect(() => { onStepRef.current = onStep; }, [onStep]);

    useEffect(() => {
        tempoRef.current = tempo;
        transportClockController.setTempo(tempo);
    }, [tempo]);

    useEffect(() => {
        swingRef.current = swing;
        transportClockController.setSwing(swing);
    }, [swing]);

    useEffect(() => {
        transportClockController.setSteps(steps);
    }, [steps]);

    useEffect(() => {
        transportClockController.setContext(context ?? null);
    }, [context]);

    useEffect(() => {
        return transportClockController.onStep((step, audioTime) => {
            onStepRef.current(step, audioTime);
        });
    }, []);

    const startClock = useCallback(async () => {
        if (!context || !isAudioReady) {
            console.warn(
                '[useScheduler] startClock called before the audio engine was ready — ' +
                `context: ${context ? 'present' : 'null'}, isAudioReady: ${isAudioReady}. ` +
                'Transport will not advance until the engine finishes initializing.',
            );
            return;
        }

        if (context.state === 'suspended') {
            try {
                await context.resume();
            } catch (err) {
                console.error('[useScheduler] AudioContext.resume() failed:', err);
                setIsPlaying(false);
                return;
            }
        }

        transportClockController.start();
    }, [context, isAudioReady]);

    const stopClock = useCallback(() => {
        transportClockController.stop();
    }, []);

    useEffect(() => {
        if (isPlaying && isAudioReady) {
            void startClock();
        } else {
            if (isPlaying && !isAudioReady) {
                console.warn(
                    '[useScheduler] Play was requested but the audio engine is not ready yet — ' +
                    'the clock will start automatically once it is.',
                );
            }
            stopClock();
        }
        return () => stopClock();
    }, [isPlaying, isAudioReady, startClock, stopClock]);

    useEffect(() => {
        transportClockController.setOnExternalStop(() => setIsPlaying(false));
        return () => transportClockController.setOnExternalStop(null);
    }, []);

    useEffect(() => {
        const timer = setInterval(() => {
            engineTelemetry.recordTransportSync(transportClockController.getTelemetry());
        }, 250);
        return () => clearInterval(timer);
    }, []);

    return { isPlaying, setIsPlaying };
};
