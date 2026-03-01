# Loading Progress Bar System Design

## Overview

This document outlines a comprehensive loading progress bar system for the Hyphon web sequencer's audio engine initialization. The system provides visual feedback, debug logging, and error handling for the 7 major initialization steps.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        App Component                            │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐  │
│  │  LoadingOverlay  │  │         useAudioEngine Hook          │  │
│  │   (Visual UI)    │◄─┤   (Progress Tracking & Logic)        │  │
│  └─────────────────┘  └──────────────────────────────────────┘  │
│           ▲                          │                          │
│           │                          ▼                          │
│           │           ┌──────────────────────────┐              │
│           └───────────┤   LoadingProgressStore   │              │
│                       │   (Zustand-style store)  │              │
│                       └──────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Loading Progress Store

A lightweight state management module for tracking initialization progress.

### File: `src/stores/loadingProgressStore.ts`

```typescript
/**
 * Loading Progress Store
 * Manages initialization state across the audio engine startup sequence.
 * Uses a subscription pattern for decoupled updates.
 */

export type LoadingStep = 
  | 'audioContext'
  | 'masterChain'
  | 'webGpuEngine'
  | 'wasmEngine'
  | 'open303Engine'
  | 'wavFiles'
  | 'ambianceBuffers'
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

  // Step weights - total = 100
  private static readonly STEP_WEIGHTS: Record<LoadingStep, number> = {
    audioContext: 5,      // Fast, native API
    masterChain: 5,       // Fast, node creation
    webGpuEngine: 20,     // May fail, GPU detection
    wasmEngine: 15,       // WASM instantiation
    open303Engine: 25,    // Complex worklet + WASM
    wavFiles: 15,         // Network fetch + decode
    ambianceBuffers: 10,  // Optional, lazy loaded
    complete: 5,          // Final state
  };

  private static readonly STEP_LABELS: Record<LoadingStep, string> = {
    audioContext: 'Initializing Audio Context',
    masterChain: 'Setting up Master Audio Chain',
    webGpuEngine: 'Initializing WebGPU Oscillator',
    wasmEngine: 'Loading WASM Oscillator',
    open303Engine: 'Loading TB-303 Bass Engine',
    wavFiles: 'Loading Waveform Samples',
    ambianceBuffers: 'Preparing Ambiance Tracks',
    complete: 'Finalizing Setup',
  };

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): LoadingState {
    const now = performance.now();
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
      `${isRecoverable ? '⚠️' : '❌'} Failed: ${this.state.steps[step].label} - ${error.message}`
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

// Import React at top of actual file
import React from 'react';
```

---

## 2. Loading Overlay Component

A visually appealing loading overlay with progress bar and status indicators.

### File: `src/components/LoadingOverlay.tsx`

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { useLoadingProgress, LoadingStep, loadingProgressStore } from '../stores/loadingProgressStore';

interface LoadingOverlayProps {
  isVisible: boolean;
  onComplete?: () => void;
}

// Step icon mapping
const STEP_ICONS: Record<LoadingStep, string> = {
  audioContext: '🔊',
  masterChain: '🔗',
  webGpuEngine: '🎮',
  wasmEngine: '⚡',
  open303Engine: '🎸',
  wavFiles: '🎵',
  ambianceBuffers: '🌊',
  complete: '✨',
};

// Status colors
const STATUS_COLORS = {
  pending: 'bg-gray-700',
  active: 'bg-cyan-500 animate-pulse',
  completed: 'bg-green-500',
  error: 'bg-red-500',
};

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ 
  isVisible, 
  onComplete 
}) => {
  const { isLoading, totalProgress, currentStep, steps, errors } = useLoadingProgress();
  const [showDetails, setShowDetails] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  // Smooth progress animation using CSS transition
  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.style.width = `${totalProgress}%`;
    }
  }, [totalProgress]);

  // Call onComplete when loading finishes
  useEffect(() => {
    if (!isLoading && totalProgress === 100 && isVisible) {
      const timer = setTimeout(() => {
        onComplete?.();
      }, 500); // Brief delay to show 100%
      return () => clearTimeout(timer);
    }
  }, [isLoading, totalProgress, isVisible, onComplete]);

  if (!isVisible) return null;

  const currentStepInfo = currentStep ? steps[currentStep] : null;
  const hasErrors = errors.length > 0;
  const stepList = Object.values(steps).filter(s => s.id !== 'complete');

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827] bg-opacity-98 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loading-title"
      aria-describedby="loading-desc"
    >
      <div className="w-full max-w-xl p-8 mx-4 bg-[#1f2937] border-2 border-cyan-500 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 
            id="loading-title"
            className="text-4xl font-bold font-orbitron text-cyan-400 mb-2 tracking-widest drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]"
          >
            HYPHON
          </h1>
          <p className="text-gray-400 font-mono text-sm tracking-wide">INITIALIZING AUDIO ENGINE</p>
        </div>

        {/* Progress Bar Container */}
        <div className="mb-6">
          {/* Percentage and status */}
          <div className="flex justify-between items-center mb-2 font-mono text-sm">
            <span className="text-cyan-400 font-semibold">
              {currentStepInfo?.label || 'Preparing...'}
            </span>
            <span className="text-gray-300">{Math.round(totalProgress)}%</span>
          </div>

          {/* Main progress bar */}
          <div 
            className="h-4 bg-gray-800 rounded-full overflow-hidden border border-gray-700"
            role="progressbar"
            aria-valuenow={Math.round(totalProgress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Loading progress"
          >
            <div
              ref={progressRef}
              className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(6,182,212,0.5)]"
              style={{ width: '0%' }}
            >
              {/* Shimmer effect */}
              <div className="w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.5s_infinite]" />
            </div>
          </div>

          {/* Current step indicator */}
          {currentStepInfo && (
            <div className="mt-2 flex items-center gap-2 font-mono text-xs text-gray-500">
              <span>{STEP_ICONS[currentStepInfo.id]}</span>
              <span>{currentStepInfo.status === 'active' ? 'Working...' : 'Queued'}</span>
              {currentStepInfo.status === 'error' && (
                <span className="text-yellow-500">(Using fallback)</span>
              )}
            </div>
          )}
        </div>

        {/* Error messages */}
        {hasErrors && (
          <div 
            className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg"
            role="alert"
          >
            <p className="text-red-400 font-mono text-xs mb-1">
              ⚠️ Some features may be unavailable:
            </p>
            <ul className="text-red-300 font-mono text-xs list-disc list-inside">
              {errors.map((error, idx) => (
                <li key={idx}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Step details (collapsible) */}
        <div className="border-t border-gray-700 pt-4">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 text-gray-400 hover:text-cyan-400 transition-colors font-mono text-xs w-full"
            aria-expanded={showDetails}
          >
            <span className={`transform transition-transform ${showDetails ? 'rotate-90' : ''}`}>
              ▶
            </span>
            <span>View Initialization Steps ({stepList.filter(s => s.status === 'completed').length}/{stepList.length})</span>
          </button>

          {showDetails && (
            <div className="mt-3 space-y-2 animate-[fadeIn_0.2s_ease-out]">
              {stepList.map((step) => (
                <div 
                  key={step.id}
                  className="flex items-center gap-3 p-2 rounded bg-gray-800/50"
                >
                  {/* Status indicator */}
                  <div 
                    className={`w-2 h-2 rounded-full ${STATUS_COLORS[step.status]}`}
                    aria-hidden="true"
                  />
                  
                  {/* Icon */}
                  <span className="text-lg" aria-hidden="true">{STEP_ICONS[step.id]}</span>
                  
                  {/* Label */}
                  <span className={`flex-1 font-mono text-xs ${
                    step.status === 'active' ? 'text-cyan-400' :
                    step.status === 'completed' ? 'text-green-400' :
                    step.status === 'error' ? 'text-yellow-400' :
                    'text-gray-500'
                  }`}>
                    {step.label}
                  </span>

                  {/* Status text */}
                  <span className="font-mono text-xs text-gray-500">
                    {step.status === 'completed' ? 'Done' :
                     step.status === 'active' ? '...' :
                     step.status === 'error' ? 'Fallback' :
                     'Waiting'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Completion message */}
        {totalProgress === 100 && !isLoading && (
          <div className="mt-6 text-center animate-[fadeIn_0.5s_ease-out]">
            <p className="text-green-400 font-mono text-sm">
              ✓ Audio Engine Ready
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// CSS Animation keyframes (add to your CSS/Tailwind config)
/*
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
*/
```

---

## 3. Enhanced useAudioEngine Hook

Modified initialization with progress tracking and debug logging.

### File: `src/hooks/useAudioEngine.ts` (Modified Sections)

```typescript
import { loadingProgressStore } from '../stores/loadingProgressStore';

// Debug logger that respects user preferences
const createDebugLogger = (context: string) => {
  return (message: string, data?: unknown) => {
    // Check if debug mode is enabled
    const isDebug = typeof window !== 'undefined' && 
      ((window as any).__AUDIO_LOADER_DEBUG__ || localStorage.getItem('hyphon_debug') === 'true');
    
    if (isDebug) {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      console.log(`[${timestamp}] [${context}]`, message, data !== undefined ? data : '');
    }
  };
};

// Error wrapper with user-friendly messages
class AudioEngineError extends Error {
  public userMessage: string;
  public isRecoverable: boolean;
  public step: string;

  constructor(
    message: string, 
    userMessage: string, 
    step: string,
    isRecoverable = true
  ) {
    super(message);
    this.name = 'AudioEngineError';
    this.userMessage = userMessage;
    this.step = step;
    this.isRecoverable = isRecoverable;
  }
}

export const useAudioEngine = (pyodide: any, forceScriptProcessor: boolean = false) => {
  const debug = useMemo(() => createDebugLogger('useAudioEngine'), []);
  
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
  const isInitializing = useRef(false);
  // ... other refs

  const initializeAudio = useCallback(async () => {
    if (audioEngine || isInitializing.current) return;
    isInitializing.current = true;

    // Start progress tracking
    loadingProgressStore.startLoading();
    loadingProgressStore.enableDebug();
    setInitError(null);

    debug('🎵 Audio initialization started');

    try {
      // Step 1: Create AudioContext
      loadingProgressStore.startStep('audioContext');
      debug('Creating AudioContext...');
      
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      debug('✅ AudioContext created', { sampleRate: context.sampleRate });

      if (context.state === 'suspended') {
        debug('Resuming suspended AudioContext...');
        await context.resume();
        debug('✅ AudioContext resumed');
      }
      
      loadingProgressStore.completeStep('audioContext');

      // Step 2: Initialize Master Chain
      loadingProgressStore.startStep('masterChain');
      debug('Setting up master audio chain...');

      const masterGain = context.createGain();
      masterGain.gain.setValueAtTime(0.8, 0);
      masterGainRef.current = masterGain;

      let masterPanner: StereoPannerNode | null = null;
      if (context.createStereoPanner) {
        masterPanner = context.createStereoPanner();
        masterPanner.pan.setValueAtTime(0, 0);
        masterPannerRef.current = masterPanner;
        masterGain.connect(masterPanner);
        masterPanner.connect(context.destination);
        debug('✅ Master chain with stereo panner created');
      } else {
        masterGain.connect(context.destination);
        debug('⚠️ Master chain without panner (not supported)');
      }

      loadingProgressStore.completeStep('masterChain');

      // Step 3: Initialize WebGPU Oscillator
      loadingProgressStore.startStep('webGpuEngine');
      debug('Initializing WebGPU oscillator...');

      const gpuEngine = new WebGpuOscillator();
      try {
        await gpuEngine.init();
        if (gpuEngine.device) {
          gpuEngineRef.current = gpuEngine;
          debug('✅ WebGPU engine initialized');
        } else {
          throw new Error('WebGPU not supported');
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        debug('⚠️ WebGPU init failed (non-critical)', error.message);
        loadingProgressStore.failStep('webGpuEngine', error, true);
      }
      
      if (gpuEngineRef.current) {
        loadingProgressStore.completeStep('webGpuEngine');
      }

      // Step 4: Initialize WASM Oscillator
      loadingProgressStore.startStep('wasmEngine');
      debug('Initializing WASM oscillator...');

      const wasmEngine = new WasmOscillator();
      try {
        await wasmEngine.init();
        if (wasmEngine.isReady) {
          wasmEngineRef.current = wasmEngine;
          debug('✅ WASM engine initialized');
        } else {
          throw new Error('WASM failed to initialize');
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        debug('⚠️ WASM init failed (non-critical)', error.message);
        loadingProgressStore.failStep('wasmEngine', error, true);
      }

      if (wasmEngineRef.current) {
        loadingProgressStore.completeStep('wasmEngine');
      }

      // Step 5: Initialize Open303 Engine
      loadingProgressStore.startStep('open303Engine');
      debug('Initializing Open303 engine...');

      const open303Engine = new Open303Oscillator();
      let open303Ready = false;

      try {
        open303Ready = await open303Engine.init(context, open303ProcessorUrl, {
          preferWorklet: true,
          preferThreaded: false,
          forceSingleThreaded: true
        });

        if (open303Ready && open303Engine.isReady) {
          open303Engine.connect(masterGain);
          open303EngineRef.current = open303Engine;
          debug('✅ Open303 engine ready', { 
            isFallback: open303Engine.isFallback 
          });
        } else {
          throw new Error('Open303 initialization returned false');
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        debug('⚠️ Open303 init failed (using fallback)', error.message);
        loadingProgressStore.failStep('open303Engine', error, true);
        // Open303 has built-in fallback, so we still mark as ready
        open303Ready = true;
      }

      loadingProgressStore.completeStep('open303Engine');

      // Step 6: Load WAV Files
      loadingProgressStore.startStep('wavFiles');
      debug('Loading waveform samples...');

      const loadWav = async (url: string, name: string): Promise<AudioBuffer | null> => {
        try {
          debug(`Fetching ${name}...`);
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} for ${url}`);
          }
          const arrayBuf = await res.arrayBuffer();
          const decoded = await context.decodeAudioData(arrayBuf);
          debug(`✅ Loaded ${name}`, { duration: decoded.duration.toFixed(2) + 's' });
          return decoded;
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          debug(`❌ Failed to load ${name}`, error.message);
          return null;
        }
      };

      // Load with progress simulation for UX
      const [sawBuf, sqrBuf] = await Promise.all([
        loadWav('./assets/saw.wav', 'saw.wav'),
        loadWav('./assets/square.wav', 'square.wav')
      ]);

      wavSawBufferRef.current = sawBuf;
      wavSqrBufferRef.current = sqrBuf;

      if (!sawBuf || !sqrBuf) {
        debug('⚠️ Some WAV files failed to load');
      }

      loadingProgressStore.completeStep('wavFiles');

      // Initialize Voice Managers (instant, no async)
      voiceManagerARef.current = new VoiceManager(
        context, masterGainRef.current!, 8, false, 
        sawBuf || undefined, sqrBuf || undefined
      );
      voiceManagerBRef.current = new VoiceManager(
        context, masterGainRef.current!, 1, true,
        sawBuf || undefined, sqrBuf || undefined
      );
      debug('✅ Voice managers initialized');

      // Step 7: Initialize AudioWorklets
      if (!forceScriptProcessorFallback) {
        try {
          debug('Adding AudioWorklet modules...');
          await context.audioWorklet.addModule(sustainProcessorUrl);
          const sustainNode = new AudioWorkletNode(context, 'sustain-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2]
          });
          sustainNode.connect(masterGainRef.current!);
          sustainNodeRef.current = sustainNode;
          debug('✅ SustainProcessor AudioWorklet initialized');
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          debug('⚠️ Sustain worklet not available', error.message);
        }
      } else {
        debug('Using ScriptProcessorNode fallback (forced)');
        // ... fallback implementation
      }

      // Step 8: Initialize Singing Voice (with progress sub-steps)
      debug('Initializing Singing Voice engine...');
      try {
        let wasmBinary: ArrayBuffer | undefined;
        try {
          const response = await fetch(import.meta.env.BASE_URL + 'rubberband.wasm');
          if (response.ok) wasmBinary = await response.arrayBuffer();
        } catch (e) {
          debug('⚠️ Could not preload rubberband.wasm', e);
        }

        // Initialize voices in parallel with timeout
        const voiceInitTimeout = 15000; // 15 second timeout
        
        const initVoice = async (voice: SingingVoice, name: string) => {
          await voice.initWorklet(forceScriptProcessorFallback, wasmBinary);
          debug(`✅ ${name} voice initialized`);
        };

        await Promise.all([
          initVoice(singingVoiceRef.current!, 'Center'),
          initVoice(singingVoiceLeftRef.current!, 'Left'),
          initVoice(singingVoiceRightRef.current!, 'Right')
        ]);

        // Connect voices
        singingVoiceRef.current!.getSourceNode().connect(masterGainRef.current!);
        // ... choir connections

      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        debug('⚠️ SingingVoice failed to init', error.message);
      }

      // Initialize noise buffer (instant)
      const bufferSize = context.sampleRate * 2;
      const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      noiseBufferRef.current = buffer;
      debug('✅ Noise buffer created');

      // Mark ambiance as ready (lazy loaded on demand)
      loadingProgressStore.startStep('ambianceBuffers');
      loadingProgressStore.completeStep('ambianceBuffers');
      debug('✅ Ambiance system ready (lazy load)');

      // Create engine API
      // ... (existing engine function definitions)

      setAudioEngine({
        context,
        webGpuEngine: gpuEngineRef.current,
        wasmEngine: wasmEngineRef.current,
        open303Engine: open303EngineRef.current,
        singingVoice: singingVoiceRef.current || undefined,
        // ... all other engine methods
      });

      // Finish loading
      loadingProgressStore.finishLoading();
      setIsReady(true);
      isInitializing.current = false;
      
      debug('🎉 Audio engine fully initialized');

      // Log performance report
      if (typeof window !== 'undefined' && (window as any).__AUDIO_LOADER_DEBUG__) {
        const timing = loadingProgressStore.getTimingReport();
        console.table(timing);
      }

    } catch (e) {
      // Critical failure
      const error = e instanceof Error ? e : new Error(String(e));
      debug('❌ CRITICAL AUDIO INIT FAILURE', error.message);
      
      loadingProgressStore.addError(
        `Critical error: ${error.message}. Some audio features may not work.`
      );
      
      setInitError(error.message);
      setIsReady(true); // Allow UI to unblock
      isInitializing.current = false;
      loadingProgressStore.finishLoading();
    }
  }, [audioEngine, forceScriptProcessorFallback]);

  // Enable debug mode via URL parameter
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('debug')) {
      loadingProgressStore.enableDebug();
      localStorage.setItem('hyphon_debug', 'true');
    }
  }, []);

  return useMemo(() => ({
    audioEngine,
    isReady,
    initError,
    initializeAudio,
    onParamChange: updateVoiceParams
  }), [audioEngine, isReady, initError, initializeAudio, updateVoiceParams]);
};
```

---

## 4. Integration with App.tsx

### Modified App.tsx Structure

```typescript
import { LoadingOverlay } from './components/LoadingOverlay';
import { loadingProgressStore } from './stores/loadingProgressStore';

export const App: React.FC = () => {
  // ... existing state
  const { audioEngine, isReady, initError, initializeAudio } = useAudioEngine(pyodide, forceScriptProcessorFallback);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [audioInitialized, setAudioInitialized] = useState(false);

  const handleStart = async () => {
    console.log("Initialization sequence started...");
    
    // Show loading overlay
    setShowLoadingOverlay(true);
    setHasStarted(true);

    try {
      await initializeAudio();
      setAudioInitialized(true);
      console.log("Audio Engine Initialized");
    } catch (e) {
      console.error("Failed to start system:", e);
      // Keep overlay visible to show error, then hide after delay
      setTimeout(() => setShowLoadingOverlay(false), 2000);
    }
  };

  // Hide loading overlay when complete
  const handleLoadingComplete = () => {
    setShowLoadingOverlay(false);
  };

  // ... rest of component

  return (
    <>
      {/* Start Overlay - shown before user clicks initialize */}
      {!hasStarted && (
        <StartOverlay 
          onStart={handleStart} 
          isReady={isPyodideReady} 
        />
      )}

      {/* Loading Overlay - shown during initialization */}
      <LoadingOverlay 
        isVisible={showLoadingOverlay}
        onComplete={handleLoadingComplete}
      />

      {/* Main App */}
      {audioInitialized && (
        <div className="app-container">
          {/* ... app content */}
        </div>
      )}
    </>
  );
};
```

---

## 5. Debug Logging Strategy

### Console Output Example

```
[12:34:56] [AudioLoader] 🚀 Loading sequence started
[12:34:56] [useAudioEngine] 🎵 Audio initialization started
[12:34:56] [useAudioEngine] Creating AudioContext...
[12:34:56] [AudioLoader] ▶️  Starting: Initializing Audio Context
[12:34:56] [useAudioEngine] ✅ AudioContext created {sampleRate: 48000}
[12:34:56] [AudioLoader] ✅ Completed: Initializing Audio Context (23ms)
[12:34:56] [AudioLoader] ▶️  Starting: Setting up Master Audio Chain
[12:34:56] [useAudioEngine] ✅ Master chain with stereo panner created
[12:34:56] [AudioLoader] ✅ Completed: Setting up Master Audio Chain (5ms)
[12:34:56] [AudioLoader] ▶️  Starting: Initializing WebGPU Oscillator
[12:34:56] [useAudioEngine] ✅ WebGPU engine initialized
[12:34:56] [AudioLoader] ✅ Completed: Initializing WebGPU Oscillator (145ms)
[12:34:56] [AudioLoader] ▶️  Starting: Loading WASM Oscillator
[12:34:57] [useAudioEngine] ✅ WASM engine initialized
[12:34:57] [AudioLoader] ✅ Completed: Loading WASM Oscillator (203ms)
[12:34:57] [AudioLoader] ▶️  Starting: Loading TB-303 Bass Engine
[12:34:57] [useAudioEngine] ✅ Open303 engine ready {isFallback: false}
[12:34:58] [AudioLoader] ✅ Completed: Loading TB-303 Bass Engine (823ms)
[12:34:58] [AudioLoader] ▶️  Starting: Loading Waveform Samples
[12:34:58] [useAudioEngine] Fetching saw.wav...
[12:34:58] [useAudioEngine] ✅ Loaded saw.wav {duration: "0.05s"}
[12:34:58] [useAudioEngine] ✅ Loaded square.wav {duration: "0.05s"}
[12:34:58] [AudioLoader] ✅ Completed: Loading Waveform Samples (156ms)
[12:34:58] [AudioLoader] ▶️  Starting: Preparing Ambiance Tracks
[12:34:58] [AudioLoader] ✅ Completed: Preparing Ambiance Tracks (2ms)
[12:34:58] [AudioLoader] 🎉 Loading complete! Total time: 1357ms

// Performance table
┌──────────────────────┬────────┐
│ (index)              │ Values │
├──────────────────────┼────────┤
│ audioContext         │ 23     │
│ masterChain          │ 5      │
│ webGpuEngine         │ 145    │
│ wasmEngine           │ 203    │
│ open303Engine        │ 823    │
│ wavFiles             │ 156    │
│ ambianceBuffers      │ 2      │
└──────────────────────┴────────┘
```

### Enabling Debug Mode

```typescript
// Method 1: URL parameter
// http://localhost:5173/?debug

// Method 2: LocalStorage
localStorage.setItem('hyphon_debug', 'true');

// Method 3: Runtime API
loadingProgressStore.enableDebug();
```

---

## 6. Error Handling Strategy

### Error Classification

| Category | Examples | User Message | Action |
|----------|----------|--------------|--------|
| **Critical** | AudioContext creation failed | "Audio system unavailable. Please check your browser permissions." | Block audio features |
| **Recoverable** | WebGPU not available | "WebGPU unavailable. Using fallback renderer." | Continue with fallback |
| **Optional** | Ambiance load failed | "" | Silent, lazy retry |

### User-Friendly Error Messages

```typescript
const ERROR_MESSAGES: Record<string, string> = {
  'NotAllowedError': 'Audio permission denied. Please allow audio in your browser.',
  'NotSupportedError': 'Web Audio API not supported. Try Chrome, Firefox, or Safari.',
  'WebGPU not supported': 'WebGPU not available. High-performance mode disabled.',
  'WASM failed to initialize': 'WASM engine failed. Using JavaScript fallback.',
  'Open303 initialization returned false': 'Bass synth using fallback mode.',
  'HTTP 404': 'Audio file not found. Check assets folder.',
  'decodeAudioData failed': 'Invalid audio file format.',
};

function getUserFriendlyError(error: Error): string {
  for (const [key, message] of Object.entries(ERROR_MESSAGES)) {
    if (error.message.includes(key) || error.name === key) {
      return message;
    }
  }
  return 'An unexpected error occurred. Please refresh the page.';
}
```

---

## 7. Progress Calculation Logic

### Weight Distribution

```
Total: 100 points
├─ Audio Context:        5%  (Fast, critical)
├─ Master Chain:         5%  (Fast, critical)
├─ WebGPU Engine:       20%  (May fail, GPU detection)
├─ WASM Engine:         15%  (Network + compilation)
├─ Open303 Engine:      25%  (Complex, worklet + WASM)
├─ WAV Files:           15%  (Network fetch + decode)
├─ Ambiance Buffers:    10%  (Optional, lazy)
└─ Complete:             5%  (Final state)
```

### Smooth Progress Updates

To prevent UI blocking during CPU-intensive operations:

```typescript
// Yield to event loop between heavy operations
const yieldToMainThread = () => new Promise(resolve => setTimeout(resolve, 0));

// Use in initialization
async function initializeHeavyComponent() {
  loadingProgressStore.startStep('heavyComponent');
  
  // Do some work
  await heavyTask1();
  loadingProgressStore.updateStepProgress('heavyComponent', 33);
  await yieldToMainThread(); // Allow UI update
  
  await heavyTask2();
  loadingProgressStore.updateStepProgress('heavyComponent', 66);
  await yieldToMainThread();
  
  await heavyTask3();
  loadingProgressStore.completeStep('heavyComponent');
}
```

---

## 8. Testing the Progress Bar
n
### Unit Test Example

```typescript
// src/__tests__/LoadingOverlay.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { loadingProgressStore } from '../stores/loadingProgressStore';

describe('LoadingOverlay', () => {
  beforeEach(() => {
    loadingProgressStore.startLoading();
  });

  it('renders progress bar with correct percentage', () => {
    render(<LoadingOverlay isVisible={true} />);
    
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('updates progress when store changes', async () => {
    render(<LoadingOverlay isVisible={true} />);
    
    loadingProgressStore.startStep('audioContext');
    loadingProgressStore.completeStep('audioContext');
    
    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
    });
  });

  it('shows error messages when errors occur', async () => {
    render(<LoadingOverlay isVisible={true} />);
    
    loadingProgressStore.addError('Test error message');
    
    await waitFor(() => {
      expect(screen.getByText(/Test error message/)).toBeInTheDocument();
    });
  });

  it('calls onComplete when loading finishes', async () => {
    const onComplete = vi.fn();
    render(<LoadingOverlay isVisible={true} onComplete={onComplete} />);
    
    // Complete all steps
    const steps = ['audioContext', 'masterChain', 'webGpuEngine', 'wasmEngine', 
                   'open303Engine', 'wavFiles', 'ambianceBuffers'] as const;
    
    steps.forEach(step => {
      loadingProgressStore.startStep(step);
      loadingProgressStore.completeStep(step);
    });
    
    loadingProgressStore.finishLoading();
    
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
```

---

## 9. File Structure

```
src/
├── components/
│   ├── LoadingOverlay.tsx          # Main progress bar UI
│   ├── StartOverlay.tsx            # Existing (unchanged)
│   └── ...
├── stores/
│   └── loadingProgressStore.ts     # Progress state management
├── hooks/
│   ├── useAudioEngine.ts           # Modified with progress tracking
│   └── ...
├── __tests__/
│   ├── LoadingOverlay.test.tsx     # Component tests
│   └── useAudioEngine.perf.test.tsx # Performance tests
└── ...
```

---

## 10. Summary

This design provides:

1. **Visual Feedback**: Smooth animated progress bar with step-by-step status
2. **Non-blocking Updates**: requestAnimationFrame-based updates that don't freeze UI
3. **Debug Logging**: Structured console output with timing reports
4. **Error Resilience**: Graceful fallbacks with user-friendly error messages
5. **Accessibility**: ARIA labels, role attributes, and keyboard navigation
6. **Performance**: Lightweight store with minimal re-renders

The system integrates seamlessly with the existing codebase while providing a significantly improved user experience during the critical initialization phase.
