// src/components/Sequencer.tsx
import React from 'react';
import type { Pattern } from '../types';
import { StepButton } from './StepButton';
import { NUM_STEPS } from '../constants';

interface SequencerProps {
  pattern: Pattern;
  currentStep: number;
  isPlaying: boolean;
  // Updated signature to support length updates
  onPatternChange: (part: keyof Pattern, stepIndex: number, subIndex?: number, updates?: { length: number }) => void;
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
  const activeSamplerSequence = pattern.sampler[activeSamplerBank] || { steps: Array(NUM_STEPS).fill(null) };

  return (
    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50 space-y-3 h-full overflow-y-auto select-none">
      <h3 className="text-center text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
        Shift + Drag to adjust note length
      </h3>

      {/* Synth Tracks */}
      {synthParts.map(config => (
        <TrackRow
            key={config.name}
            label={config.label}
            color={config.color}
            steps={pattern[config.name].steps}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggle={(i) => onPatternChange(config.name, i)}
            onEditLength={(i, len) => onPatternChange(config.name, i, undefined, { length: len })}
        />
      ))}

      <div className="h-px bg-slate-700/50 my-2" />

      {/* Drum Tracks (Usually length 1, but we enable feature anyway) */}
      {drumParts.map(config => (
        <TrackRow
            key={config.name}
            label={config.label}
            color={config.color}
            steps={pattern[config.name].steps}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggle={(i) => onPatternChange(config.name, i)}
            onEditLength={(i, len) => onPatternChange(config.name, i, undefined, { length: len })}
        />
      ))}

      <div className="h-px bg-slate-700/50 my-2" />

      {/* Sampler Track */}
      <div className="bg-slate-900/50 rounded p-2 -mx-2 border border-purple-900/30">
        <TrackRow
            label={`Smp ${activeSamplerBank + 1}`}
            color="purple"
            steps={activeSamplerSequence.steps}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggle={(i) => onPatternChange('sampler', i, activeSamplerBank)}
            onEditLength={(i, len) => onPatternChange('sampler', i, activeSamplerBank, { length: len })}
        />
      </div>
    </div>
  );
};

// Helper Component
const TrackRow: React.FC<{
    label: string,
    color: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps: (any)[],
    currentStep: number,
    isPlaying: boolean,
    onToggle: (i: number) => void,
    onEditLength: (i: number, len: number) => void
}> = ({ label, color, steps, currentStep, isPlaying, onToggle, onEditLength }) => (
    <div className="flex items-center gap-3">
        <span className="w-16 text-right text-xs font-bold uppercase text-slate-400 shrink-0 truncate">{label}</span>
        <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1 flex-1">
            {Array.from({ length: NUM_STEPS }).map((_, i) => (
                <div key={i} className={`${(i + 1) % 4 === 0 && i < 15 ? 'mr-2' : ''}`}>
                    <StepButton
                        isActive={!!steps[i]}
                        isCurrent={isPlaying && currentStep === i}
                        color={color}
                        length={steps[i]?.length || 1}
                        onClick={() => onToggle(i)}
                        onEditLength={(len) => onEditLength(i, len)}
                    />
                </div>
            ))}
        </div>
    </div>
);
