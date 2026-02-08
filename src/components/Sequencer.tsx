import React, { useState, useEffect, useCallback } from 'react';
import type { Pattern } from '../types';
import { StepButton } from './StepButton';
import { NUM_STEPS } from '../constants';

interface SequencerProps {
  pattern: Pattern;
  currentStep: number;
  isPlaying: boolean;
  onPatternChange: (part: keyof Pattern, stepIndex: number, subIndex?: number) => void;
  activeSamplerBank: number;
}

const synthParts = [
    { name: 'partA', color: 'cyan', label: 'Synth A' },
    { name: 'partB', color: 'pink', label: 'Synth B' },
] as const;

const drumParts = [
    { name: 'kick', color: 'yellow', label: 'Kick' },
    { name: 'snare', color: 'yellow', label: 'Snare' },
    { name: 'closedHat', color: 'yellow', label: 'CH' },
    { name: 'openHat', color: 'yellow', label: 'OH' },
] as const;

export const Sequencer: React.FC<SequencerProps> = ({
    pattern, currentStep, isPlaying, onPatternChange, activeSamplerBank
}) => {
  // State for Rubber-Band Selection
  const [selection, setSelection] = useState<{ track: string, start: number, end: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  // Global mouse up to end selection
  useEffect(() => {
      const handleGlobalMouseUp = () => {
          setIsSelecting(false);
      };
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Handle Delete/Backspace to clear selection
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
              const { track, start, end } = selection;
              const low = Math.min(start, end);
              const high = Math.max(start, end);
              const partKey = track as keyof Pattern | 'sampler';

              for (let i = low; i <= high; i++) {
                 let isActiveStep = false;
                 if (partKey === 'sampler') {
                     isActiveStep = !!pattern.sampler[activeSamplerBank]?.steps[i];
                 } else {
                     isActiveStep = !!((pattern[partKey as keyof Pattern] as PartSequence).steps[i]);
                 }

                 if (isActiveStep) {
                     if (partKey === 'sampler') {
                         onPatternChange('sampler', i, activeSamplerBank);
                     } else {
                         onPatternChange(partKey, i);
                     }
                 }
              }
              // Keep selection active after deletion
          }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, pattern, onPatternChange, activeSamplerBank]);

  const handleStepMouseDown = useCallback((trackId: string, step: number, e: React.MouseEvent) => {
      if (e.shiftKey) {
          e.preventDefault();
          setIsSelecting(true);
          setSelection({ track: trackId, start: step, end: step });
      }
  }, []);

  const handleStepMouseEnter = useCallback((trackId: string, step: number) => {
      if (isSelecting && selection && selection.track === trackId) {
          setSelection(prev => prev ? { ...prev, end: step } : null);
      }
  }, [isSelecting, selection]);

  // Get the sequence for the currently selected bank, ensuring it exists
  const activeSamplerSequence = pattern.sampler && pattern.sampler[activeSamplerBank]
      ? pattern.sampler[activeSamplerBank]
      : { steps: Array(NUM_STEPS).fill(null) };

  return (
    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50 space-y-3 select-none"
         onMouseLeave={() => setIsSelecting(false)}
    >
      {/* Synth Tracks */}
      {synthParts.map(config => (
        <TrackRow
            key={config.name}
            label={config.label}
            trackId={config.name}
            color={config.color}
            steps={pattern[config.name].steps}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggle={(i) => onPatternChange(config.name, i)}
            selection={selection}
            onStepMouseDown={handleStepMouseDown}
            onStepMouseEnter={handleStepMouseEnter}
        />
      ))}

      <div className="h-px bg-slate-700/50 my-2" />

      {/* Drum Tracks */}
      {drumParts.map(config => (
        <TrackRow
            key={config.name}
            label={config.label}
            trackId={config.name}
            color={config.color}
            steps={pattern[config.name].steps}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggle={(i) => onPatternChange(config.name, i)}
            selection={selection}
            onStepMouseDown={handleStepMouseDown}
            onStepMouseEnter={handleStepMouseEnter}
        />
      ))}

      <div className="h-px bg-slate-700/50 my-2" />

      {/* DYNAMIC SAMPLER TRACK */}
      <div className="bg-slate-900/50 rounded p-2 -mx-2 border border-purple-900/30">
        <TrackRow
            label={`SMP ${activeSamplerBank + 1}`} 
            trackId="sampler"
            color="purple"
            steps={activeSamplerSequence.steps}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggle={(i) => onPatternChange('sampler', i, activeSamplerBank)}
            selection={selection}
            onStepMouseDown={handleStepMouseDown}
            onStepMouseEnter={handleStepMouseEnter}
        />
        <div className="text-[10px] text-purple-400 text-right mt-1 pr-2">
            Editing Bank {activeSamplerBank + 1} Pattern
        </div>
      </div>

    </div>
  );
};

// Helper Sub-component to reduce duplication
interface TrackRowProps {
    label: string;
    trackId: string;
    color: string;
    steps: (any)[];
    currentStep: number;
    isPlaying: boolean;
    onToggle: (i: number) => void;
    selection: { track: string, start: number, end: number } | null;
    onStepMouseDown: (trackId: string, step: number, e: React.MouseEvent) => void;
    onStepMouseEnter: (trackId: string, step: number) => void;
}

const TrackRow: React.FC<TrackRowProps> = ({
    label, trackId, color, steps, currentStep, isPlaying, onToggle,
    selection, onStepMouseDown, onStepMouseEnter
}) => {
    
    // UPDATED: Custom Rendering Loop to handle Note Lengths
    const renderSteps = () => {
        const elements = [];
        
        for (let i = 0; i < NUM_STEPS; i++) {
            const stepData = steps[i];
            const length = stepData?.length || 1;
            
            // Determine if this step (or the long note covering it) is currently playing
            const isCurrent = isPlaying && currentStep >= i && currentStep < (i + length);
            
            // Check selection
            let isSelected = false;
            if (selection && selection.track === trackId) {
                const low = Math.min(selection.start, selection.end);
                const high = Math.max(selection.start, selection.end);
                // Simple hit test for now
                if (i >= low && i <= high) {
                    isSelected = true;
                }
            }

            elements.push(
                <div 
                    key={i} 
                    className={`${(i + length) % 4 === 0 && i < (NUM_STEPS - 1) ? 'mr-2' : ''}`}
                    style={{ gridColumn: `span ${length}` }}
                >
                    <StepButton
                        isActive={!!stepData}
                        isCurrent={isCurrent}
                        isSelected={isSelected}
                        onClick={(e) => {
                            if (e.shiftKey) return; // Prevent toggle on selection start
                            onToggle(i);
                        }}
                        onMouseDown={(e) => onStepMouseDown(trackId, i, e)}
                        onMouseEnter={() => onStepMouseEnter(trackId, i)}
                        color={color}
                        aria-label={`${label} step ${i + 1}`}
                    />
                </div>
            );
            
            // Skip the next indices if length > 1 because they are covered by this note
            if (length > 1) {
                i += (length - 1);
            }
        }
        return elements;
    };

    return (
        <div className="flex items-center gap-3">
            <span className="w-16 text-right text-xs font-bold uppercase text-slate-400 shrink-0 truncate">{label}</span>
            {/* UPDATED: grid-cols matches NUM_STEPS (32) to prevent wrapping logic issues */}
            <div className={`grid grid-cols-[repeat(32,minmax(0,1fr))] gap-1.5 flex-1`}>
                {renderSteps()}
            </div>
        </div>
    );
};
