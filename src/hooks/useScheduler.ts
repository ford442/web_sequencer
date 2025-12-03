import { useState, useEffect, useRef, useCallback } from 'react'

// Lookahead time in seconds (how far ahead to schedule audio)
// Increased to 200ms to allow worker latency
const LOOKAHEAD = 0.20;

export const useScheduler = (
  tempo: number,
  steps: number,
  onStep: (step: number, time: number) => void,
  isAudioReady: boolean
) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)

  const onStepRef = useRef(onStep)
  const tempoRef = useRef(tempo)

  // AudioContext Time for the *next* note to be scheduled
  const nextNoteTime = useRef(0);
  const currentStepRef = useRef(0);

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    onStepRef.current = onStep
  }, [onStep])

  useEffect(() => {
    tempoRef.current = tempo
  }, [tempo])

  // Get AudioContext time from a global helper or pass it in?
  // Ideally, useScheduler should probably accept audioContext or get it.
  // For now, we assume standard AudioContext access or use `performance.now()` relative to start?
  // No, Web Audio API requires scheduling relative to `audioContext.currentTime`.
  // We'll create a temporary context just to get access to currentTime if needed,
  // BUT the best way is to expect the caller to pass a "getCurrentTime" function or similar.
  // However, since `useScheduler` is used in App, and App uses `useAudioEngine`.
  // Wait, `isAudioReady` implies we can start.
  // We really need `audioContext` to schedule correctly.

  // FIX: We need `currentTime` from the audio engine.
  // We will assume `window.AudioContext` exists and we can get `currentTime` from a global context
  // OR we rely on `performance.now()` if we sync it.
  // Standard practice: `new AudioContext().currentTime` refers to the same hardware clock (usually).
  // But creating multiple contexts is bad.
  // Let's modify the hook to accept a `getCurrentTime` function or similar?
  // Or just use `performance.now()` / 1000 and hope it aligns (it often drifts from AudioTime).

  // Better approach: We will change `onStep` signature in App to be triggered with `scheduledTime`.
  // But inside `useScheduler`, we need to know "what time is it now in Audio Time".
  // Since `useAudioEngine` creates the context, maybe we can export a global or pass it.
  // Refactoring `useScheduler` signature to `useScheduler(..., getCurrentTime: () => number)` would be best.

  // For this step, I'll assume we pass `getCurrentTime` as a prop? No, that breaks signature.
  // I will check `AudioContext` on window if available (singleton pattern usually).
  // Actually, I'll use a lazy getter for context time.

  const getAudioTime = useCallback(() => {
      // @ts-ignore
      const ctx = window._audioContext; // We will hack this in useAudioEngine to expose it globally or we pass it
      if (ctx) return ctx.currentTime;
      return performance.now() / 1000;
  }, []);

  const schedule = useCallback(() => {
    const currentTime = getAudioTime();

    // While the next note is within the lookahead window
    while (nextNoteTime.current < currentTime + LOOKAHEAD) {
        // Schedule the note
        // Calculate step index
        const step = currentStepRef.current % steps;

        // VISUAL UPDATE:
        // We want visuals to trigger closer to the actual time.
        // If we just `setCurrentStep(step)`, it updates NOW (early).
        // For tight visuals, we can use `setTimeout` or `requestAnimationFrame` to delay the visual update
        // until `nextNoteTime.current - currentTime`.
        const timeUntilNote = Math.max(0, nextNoteTime.current - currentTime);

        // Use a closure to capture the step for this specific event
        setTimeout(() => {
            setCurrentStep(step);
        }, timeUntilNote * 1000);

        // AUDIO TRIGGER:
        onStepRef.current(step, nextNoteTime.current);

        // Advance time
        const secondsPerBeat = 60.0 / tempoRef.current;
        const secondsPerStep = secondsPerBeat / 4; // 16th notes
        nextNoteTime.current += secondsPerStep;
        currentStepRef.current++;
    }
  }, [steps, getAudioTime]);

  useEffect(() => {
    if (isPlaying && isAudioReady) {
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../workers/clock.worker.ts', import.meta.url), { type: 'module' });

        workerRef.current.onmessage = (e) => {
            if (e.data === 'tick') {
                schedule();
            }
        };
      }

      // Reset logic
      currentStepRef.current = 0;
      nextNoteTime.current = getAudioTime() + 0.1; // Start slightly in future

      workerRef.current.postMessage('start'); // Uses default interval
    } else {
        workerRef.current?.postMessage('stop');
        setCurrentStep(-1);
    }

    return () => {
        workerRef.current?.postMessage('stop');
    }
  }, [isPlaying, isAudioReady, schedule, getAudioTime]);

  return { isPlaying, currentStep, setIsPlaying }
}
