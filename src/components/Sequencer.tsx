import React from 'react';
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

  // Get the sequence for the currently selected bank, ensuring it exists
  const activeSamplerSequence = pattern.sampler && pattern.sampler[activeSamplerBank]
      ? pattern.sampler[activeSamplerBank]
      : { steps: Array(NUM_STEPS).fill(null) };

  return (
    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50 space-y-3">
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
        />
      ))}

      <div className="h-px bg-slate-700/50 my-2" />

      {/* Drum Tracks */}
      {drumParts.map(config => (
        <TrackRow
            key={config.name}
            label={config.label}
            color={config.color}
            steps={pattern[config.name].steps}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggle={(i) => onPatternChange(config.name, i)}
        />
      ))}

      <div className="h-px bg-slate-700/50 my-2" />

      {/* DYNAMIC SAMPLER TRACK */}
      <div className="bg-slate-900/50 rounded p-2 -mx-2 border border-purple-900/30">
        <TrackRow
            label={`SMP ${activeSamplerBank + 1}`} // Dynamic Label
            color="purple"
            steps={activeSamplerSequence.steps}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggle={(i) => onPatternChange('sampler', i, activeSamplerBank)} // Pass bank index
        />
        <div className="text-[10px] text-purple-400 text-right mt-1 pr-2">
            Editing Bank {activeSamplerBank + 1} Pattern
        </div>
      </div>

    </div>
  );
};

// Helper Sub-component to reduce duplication
const TrackRow: React.FC<{
    label: string,
    color: string,
    steps: (any)[],
    currentStep: number,
    isPlaying: boolean,
    onToggle: (i: number) => void
}> = ({ label, color, steps, currentStep, isPlaying, onToggle }) => (
    <div className="flex items-center gap-3">
        <span className="w-16 text-right text-xs font-bold uppercase text-slate-400 shrink-0 truncate">{label}</span>
        <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5 flex-1">
            {Array.from({ length: NUM_STEPS }).map((_, i) => (
                <div key={i} className={`${(i + 1) % 4 === 0 && i < 15 ? 'mr-2' : ''}`}>
                    <StepButton
                        isActive={!!steps[i]}
                        isCurrent={isPlaying && currentStep === i}
                        onClick={() => onToggle(i)}
                        color={color}
                    />
                </div>
            ))}
        </div>
    </div>
);
