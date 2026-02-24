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

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isVisible, onComplete }) => {
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
  const stepList = Object.values(steps).filter((s) => s.id !== 'complete');

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
          <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg" role="alert">
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
            <span>
              View Initialization Steps ({stepList.filter((s) => s.status === 'completed').length}/
              {stepList.length})
            </span>
          </button>

          {showDetails && (
            <div className="mt-3 space-y-2 animate-[fadeIn_0.2s_ease-out]">
              {stepList.map((step) => (
                <div key={step.id} className="flex items-center gap-3 p-2 rounded bg-gray-800/50">
                  {/* Status indicator */}
                  <div
                    className={`w-2 h-2 rounded-full ${STATUS_COLORS[step.status]}`}
                    aria-hidden="true"
                  />

                  {/* Icon */}
                  <span className="text-lg" aria-hidden="true">
                    {STEP_ICONS[step.id]}
                  </span>

                  {/* Label */}
                  <span
                    className={`flex-1 font-mono text-xs ${
                      step.status === 'active'
                        ? 'text-cyan-400'
                        : step.status === 'completed'
                          ? 'text-green-400'
                          : step.status === 'error'
                            ? 'text-yellow-400'
                            : 'text-gray-500'
                    }`}
                  >
                    {step.label}
                  </span>

                  {/* Status text */}
                  <span className="font-mono text-xs text-gray-500">
                    {step.status === 'completed'
                      ? 'Done'
                      : step.status === 'active'
                        ? '...'
                        : step.status === 'error'
                          ? 'Fallback'
                          : 'Waiting'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Completion message */}
        {totalProgress === 100 && !isLoading && (
          <div className="mt-6 text-center animate-[fadeIn_0.5s_ease-out]">
            <p className="text-green-400 font-mono text-sm">✓ Audio Engine Ready</p>
          </div>
        )}
      </div>
    </div>
  );
};
