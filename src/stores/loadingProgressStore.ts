/**
 * Loading Progress Store
 * Manages initialization state across the audio engine startup sequence.
 * Uses a subscription pattern for decoupled updates.
 */

import React from 'react';

export type LoadingStep =
  | 'audioContext'
  | 'masterChain'
  | 'webGpuEngine'
  | 'wasmEngine'
  | 'open303Engine'
  | 'prophecyEngine'
  | 'wavFiles'
  | 'singingVoice'
  | 'ambianceBuffers'
  | 'ttsEngine'
  | 'complete';

export interface LoadingStepInfo {
  id: LoadingStep;
  label: string;
  weight: number; // Progress weight (0-100 total)
  status: 'pending' | 'active' | 'completed' | 'error';
  errorMessage?: string;
  startTime?: number;
  endTime?: number;
}

export interface LoadingState {
  isLoading: boolean;
  totalProgress: number; // 0-100
  currentStep: LoadingStep | null;
  steps: Record<LoadingStep, LoadingStepInfo>;
  errors: string[];
  startTime: number | null;
  estimatedTimeRemaining: number | null;
}

type ProgressListener = (state: LoadingState) => void;

class LoadingProgressStore {
  private state: LoadingState;
  private listeners: Set<ProgressListener> = new Set();
  private animationFrame: number | null = null;

  // Step weights — calibrated to typical wall-clock cost during initializeAudio().
  // Supertonic (ttsEngine) and ambiance buffers load AFTER the overlay closes, so
  // they're weighted 0 and only present for backward compatibility.
  // Total of active weights must = 100.
  private static readonly STEP_WEIGHTS: Record<LoadingStep, number> = {
    audioContext: 3,        // createContext + resume, ~10ms
    masterChain: 4,         // gain/saturation/reverb/delay nodes, ~10ms
    webGpuEngine: 8,        // GPU detection / adapter request, ~100-300ms
    wasmEngine: 5,          // WASM oscillator init
    open303Engine: 15,      // WASM fetch + worklet × 2 (now parallel)
    prophecyEngine: 10,     // Prophecy formant WASM worklet init
    wavFiles: 5,            // fetch + decodeAudioData for saw/square
    singingVoice: 45,       // 12 SingingVoice worklets, dominant cost
    ambianceBuffers: 0,     // lazy-loaded, not part of init
    ttsEngine: 0,           // Supertonic, loads after overlay closes
    complete: 5,            // final wiring
  };

  private static readonly STEP_LABELS: Record<LoadingStep, string> = {
    audioContext: 'Initializing Audio Context',
    masterChain: 'Setting up Master Audio Chain',
    webGpuEngine: 'Initializing WebGPU Oscillator',
    wasmEngine: 'Loading WASM Oscillator',
    open303Engine: 'Loading TB-303 Bass Engine',
    prophecyEngine: 'Loading Prophecy Formant Engine',
    wavFiles: 'Loading Waveform Samples',
    singingVoice: 'Initializing Singing Voice Pool',
    ambianceBuffers: 'Preparing Ambiance Tracks',
    ttsEngine: 'Loading TTS Voice Engine',
    complete: 'Finalizing Setup',
  };

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): LoadingState {
    const steps = {} as Record<LoadingStep, LoadingStepInfo>;

    (Object.keys(LoadingProgressStore.STEP_WEIGHTS) as LoadingStep[]).forEach((step) => {
      steps[step] = {
        id: step,
        label: LoadingProgressStore.STEP_LABELS[step],
        weight: LoadingProgressStore.STEP_WEIGHTS[step],
        status: 'pending',
      };
    });

    return {
      isLoading: false,
      totalProgress: 0,
      currentStep: null,
      steps,
      errors: [],
      startTime: null,
      estimatedTimeRemaining: null,
    };
  }

  // Subscribe to progress updates
  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.animationFrame = requestAnimationFrame(() => {
      const state = this.getState();
      this.listeners.forEach((listener) => listener(state));
    });
  }

  getState(): LoadingState {
    return { ...this.state };
  }

  // Start loading sequence
  startLoading(): void {
    this.state = {
      ...this.createInitialState(),
      isLoading: true,
      startTime: performance.now(),
    };
    this.logDebug('🚀 Loading sequence started');
    this.notify();
  }

  // Mark a step as active (started)
  startStep(step: LoadingStep): void {
    if (!this.state.isLoading) return;

    this.state.steps[step] = {
      ...this.state.steps[step],
      status: 'active',
      startTime: performance.now(),
    };
    this.state.currentStep = step;
    this.logDebug(`▶️  Starting: ${this.state.steps[step].label}`);
    this.notify();
  }

  // Mark a step as completed
  completeStep(step: LoadingStep): void {
    if (!this.state.isLoading) return;

    const endTime = performance.now();
    const duration = this.state.steps[step].startTime
      ? Math.round(endTime - this.state.steps[step].startTime)
      : 0;

    this.state.steps[step] = {
      ...this.state.steps[step],
      status: 'completed',
      endTime,
    };

    this.updateTotalProgress();
    this.logDebug(`✅ Completed: ${this.state.steps[step].label} (${duration}ms)`);
    this.notify();
  }

  // Mark a step as failed (non-fatal)
  failStep(step: LoadingStep, error: Error, isRecoverable = true): void {
    if (!this.state.isLoading) return;

    this.state.steps[step] = {
      ...this.state.steps[step],
      status: 'error',
      errorMessage: error.message,
    };

    if (!isRecoverable) {
      this.state.errors.push(`${this.state.steps[step].label}: ${error.message}`);
    }

    this.updateTotalProgress();
    this.logDebug(
      `${isRecoverable ? '⚠️' : '❌'} Failed: ${this.state.steps[step].label} - ${error.message}`,
    );
    this.notify();
  }

  // Update progress for a step (for fine-grained updates like file loading)
  updateStepProgress(step: LoadingStep, percent: number): void {
    if (!this.state.isLoading) return;

    // Calculate weighted contribution
    const stepWeight = this.state.steps[step].weight;
    const weightedProgress = (percent / 100) * stepWeight;

    // Update total progress (completed steps + current step partial)
    const completedSteps = (Object.keys(this.state.steps) as LoadingStep[])
      .filter((s) => this.state.steps[s].status === 'completed' && s !== step)
      .reduce((sum, s) => sum + this.state.steps[s].weight, 0);

    this.state.totalProgress = Math.min(99, completedSteps + weightedProgress);
    this.notify();
  }

  private updateTotalProgress(): void {
    const completedWeight = (Object.keys(this.state.steps) as LoadingStep[])
      .filter((s) => this.state.steps[s].status === 'completed')
      .reduce((sum, s) => sum + this.state.steps[s].weight, 0);

    this.state.totalProgress = Math.min(99, completedWeight);
  }

  // Complete loading sequence
  finishLoading(): void {
    this.state.isLoading = false;
    this.state.totalProgress = 100;
    this.state.currentStep = 'complete';

    const totalTime = this.state.startTime
      ? Math.round(performance.now() - this.state.startTime)
      : 0;

    this.logDebug(`🎉 Loading complete! Total time: ${totalTime}ms`);
    this.notify();
  }

  // Add an error message
  addError(message: string): void {
    this.state.errors.push(message);
    this.logDebug(`❌ Error: ${message}`);
    this.notify();
  }

  // Debug logging with structured output
  private logDebug(message: string): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const prefix = `[${timestamp}] [AudioLoader]`;

    // Structured log for debugging
    if (typeof window !== 'undefined' && (window as any).__AUDIO_LOADER_DEBUG__) {
      console.log(`${prefix} ${message}`);
    }
  }

  // Enable debug logging
  enableDebug(): void {
    if (typeof window !== 'undefined') {
      (window as any).__AUDIO_LOADER_DEBUG__ = true;
    }
  }

  // Get timing report for performance analysis
  getTimingReport(): Record<string, number> {
    const report: Record<string, number> = {};
    (Object.keys(this.state.steps) as LoadingStep[]).forEach((step) => {
      const info = this.state.steps[step];
      if (info.startTime && info.endTime) {
        report[step] = Math.round(info.endTime - info.startTime);
      }
    });
    return report;
  }
}

// Singleton instance
export const loadingProgressStore = new LoadingProgressStore();

// Hook for React components
export function useLoadingProgress(): LoadingState {
  const [state, setState] = React.useState<LoadingState>(loadingProgressStore.getState());

  React.useEffect(() => {
    return loadingProgressStore.subscribe(setState);
  }, []);

  return state;
}
