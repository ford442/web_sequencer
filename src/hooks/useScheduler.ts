import { useState, useEffect, useRef, useCallback } from 'react'

export const useScheduler = (
  tempo: number,
  steps: number,
  onStep: (step: number) => void,
  isAudioReady: boolean
) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)

  // Track if tab was hidden to gracefully handle resume
  const wasHiddenRef = useRef(false)

  // Use refs for values that change often but shouldn't restart the loop logic.
  const onStepRef = useRef(onStep)
  const tempoRef = useRef(tempo)
  const animationFrameId = useRef<number | null>(null)
  const nextStepTime = useRef(0)
  const currentStepRef = useRef(-1)

  // Keep refs updated with the latest props
  useEffect(() => {
    onStepRef.current = onStep
  }, [onStep])

  useEffect(() => {
    tempoRef.current = tempo
  }, [tempo])

  // The main animation loop. It's a stable useCallback.
  const loop = useCallback((time: number) => {
    if (!isAudioReady) return

    const now = time / 1000
    const stepDuration = 60 / tempoRef.current / 4 // 16th notes

    // If the tab was hidden, gracefully reset timing instead of dropping notes
    // This prevents the "catch-up burst" problem
    if (wasHiddenRef.current) {
      wasHiddenRef.current = false
      nextStepTime.current = now
      console.log('Scheduler: Resuming from tab hidden, reset timing')
    }
    // If the scheduler is more than a full beat behind (e.g., 4 steps),
    // it's likely the tab was inactive or the main thread was blocked.
    // Reset the next step time to now to avoid a "catch-up" burst of notes
    // that can overload the audio engine and cause it to get stuck.
    else if (now > nextStepTime.current + stepDuration * 4) {
      nextStepTime.current = now
      console.log('Scheduler: Detected timing drift, reset timing')
    }

    // The while loop is still good for handling minor timing inconsistencies.
    while (now >= nextStepTime.current) {
      currentStepRef.current = (currentStepRef.current + 1) % steps
      const stepToPlay = currentStepRef.current

      // Update the UI state for the visual indicator
      setCurrentStep(stepToPlay)

      // Trigger the audio callback with the correct step
      onStepRef.current(stepToPlay)

      // Advance the time for the next step
      nextStepTime.current += stepDuration
    }

    animationFrameId.current = requestAnimationFrame(loop)
  }, [isAudioReady, steps])

  // Handle tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab became hidden - mark it so we can gracefully resume
        wasHiddenRef.current = true
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (isPlaying && isAudioReady) {
      // Start the loop when play is pressed.
      currentStepRef.current = -1
      wasHiddenRef.current = false
      // Use performance.now() for the initial time to align with requestAnimationFrame.
      nextStepTime.current = window.performance.now() / 1000
      animationFrameId.current = requestAnimationFrame(loop)
    } else {
      // Stop the loop.
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
        animationFrameId.current = null
      }
      setCurrentStep(-1) // Reset the visual indicator
    }

    // The cleanup function is crucial for stopping the loop when the component unmounts.
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [isPlaying, isAudioReady, loop])

  return { isPlaying, currentStep, setIsPlaying }
}
