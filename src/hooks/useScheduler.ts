import { useState, useEffect, useRef, useCallback } from 'react'

export const useScheduler = (
  tempo: number,
  steps: number,
  onStep: (step: number, time: number) => void,
  isAudioReady: boolean,
  getCurrentTime: () => number,
  lookahead: number = 0.1 // Default to 100ms
) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)

  // Use refs for values that change often but shouldn't restart the loop logic.
  const onStepRef = useRef(onStep)
  const tempoRef = useRef(tempo)
  const nextStepTime = useRef(0)
  const currentStepRef = useRef(-1)
  const workerRef = useRef<Worker | null>(null);

  // Ref to hold the latest processing function to avoid stale closures in Worker callback
  const processTickRef = useRef<() => void>(() => {});

  // Keep refs updated with the latest props
  useEffect(() => {
    onStepRef.current = onStep
  }, [onStep])

  useEffect(() => {
    tempoRef.current = tempo
  }, [tempo])

  // Initialize Worker
  useEffect(() => {
      const worker = new Worker(new URL('../workers/clock.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;

      worker.onmessage = (e) => {
          if (e.data === 'tick') {
             // Call the latest version of processTick
             processTickRef.current();
          }
      };

      return () => {
          worker.terminate();
      };
  }, []); // Run once on mount

  const processTick = useCallback(() => {
      if (!isAudioReady || !isPlaying) return;

      const now = getCurrentTime();

      // Safety check: if getCurrentTime returns 0 (e.g. context suspended/not ready), abort
      if (now === 0) return;

      const stepDuration = 60 / tempoRef.current / 4; // 16th notes

      // Catch-up logic: If we are significantly behind (e.g. > 200ms),
      // resync nextStepTime to 'now' to avoid playing a burst of old notes.
      if (nextStepTime.current < now - 0.2) {
          nextStepTime.current = now;
      }

      // Schedule all notes that fall within the lookahead window
      while (nextStepTime.current < now + lookahead) {
          currentStepRef.current = (currentStepRef.current + 1) % steps;
          const stepToPlay = currentStepRef.current;

          // Lookahead Scheduling:
          // We pass the calculated 'future' time to onStep.
          // App.tsx will use this time to schedule the oscillator start.
          onStepRef.current(stepToPlay, nextStepTime.current)

          // Update UI immediately (or close enough)
          // Since we are scheduling only ~100ms ahead, updating UI now is acceptable
          // and feels responsive. For perfect UI sync, we'd need a separate
          // requestAnimationFrame loop to update UI when time matches,
          // but that adds complexity. This is the standard simple approach.
          setCurrentStep(stepToPlay)

          nextStepTime.current += stepDuration;
      }
  }, [isPlaying, isAudioReady, steps, getCurrentTime]);

  // Keep the ref updated
  useEffect(() => {
      processTickRef.current = processTick;
  }, [processTick]);


  useEffect(() => {
    if (isPlaying && isAudioReady) {
      // Start
      currentStepRef.current = -1;

      // Initialize nextStepTime.
      // Important: Add a small buffer (e.g. 0.1s) so the first note isn't "in the past"
      // by the time the message loop runs.
      const now = getCurrentTime();
      nextStepTime.current = now + lookahead;

      workerRef.current?.postMessage('start');
    } else {
      // Stop
      workerRef.current?.postMessage('stop');
      setCurrentStep(-1)
    }
  }, [isPlaying, isAudioReady, getCurrentTime])

  return { isPlaying, currentStep, setIsPlaying }
}
