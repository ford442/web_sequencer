
import React from 'react';
import type { Pattern } from '../types';
import { StepButton } from './StepButton';
import { NUM_STEPS } from '../constants';

interface SequencerProps {
  pattern: Pattern;
  currentStep: number;
  isPlaying: boolean;
  onPatternChange: (part: keyof Pattern, stepIndex: number) => void;
}

const partConfig = [
    { name: 'partA', color: 'cyan', label: 'Synth A' },
    { name: 'partB', color: 'pink', label: 'Synth B' },
    { name: 'kick', color: 'yellow', label: 'Kick' },
    { name: 'snare', color: 'yellow', label: 'Snare' },
    { name: 'closedHat', color: 'yellow', label: 'CH' },
    { name: 'openHat', color: 'yellow', label: 'OH' },
] as const;


export const Sequencer: React.FC<SequencerProps> = ({ pattern, currentStep, isPlaying, onPatternChange }) => {
  return (
    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50 shadow-inner-lg space-y-3">
      <h3 className="text-center text-sm font-bold text-slate-400 uppercase tracking-widest">Pattern Sequencer</h3>
      {partConfig.map(config => (
        <div key={config.name} className="flex items-center gap-3">
          <span className="w-16 text-right text-xs font-bold uppercase text-slate-400 shrink-0">{config.label}</span>
          <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5 flex-1">
            {Array.from({ length: NUM_STEPS }).map((_, i) => (
              <div key={`${config.name}-${i}`} className={`${(i + 1) % 4 === 0 && i < 15 ? 'mr-2' : ''}`}>
                <StepButton
                  isActive={!!pattern[config.name].steps[i]}
                  isCurrent={isPlaying && currentStep === i}
                  onClick={() => onPatternChange(config.name, i)}
                  color={config.color}
                  aria-label={`${config.label}, Step ${i + 1}`}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
