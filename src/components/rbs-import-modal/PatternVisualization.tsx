import React, { useMemo } from 'react';
import { noteToName } from '../../utils/rbsImportUtils';

interface Step {
  note: number;
  octave: number;
}

interface PatternVisualizationProps {
  tb303A: Step[];
  tb303B: Step[];
  drums: {
    kick: boolean[];
    snare: boolean[];
    closedHat: boolean[];
    openHat: boolean[];
  };
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const PatternVisualization: React.FC<PatternVisualizationProps> = React.memo(({ tb303A, tb303B, drums }) => {
  const drumPatterns = useMemo(() => [
    { name: 'Kick', pattern: drums.kick, color: 'bg-orange-500' },
    { name: 'Snare', pattern: drums.snare, color: 'bg-green-500' },
    { name: 'Closed Hat', pattern: drums.closedHat, color: 'bg-yellow-500' },
    { name: 'Open Hat', pattern: drums.openHat, color: 'bg-yellow-600' }
  ], [drums.kick, drums.snare, drums.closedHat, drums.openHat]);

  return (
    <>
      {/* TB-303 A */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-20 text-xs text-amber-500 text-right">TB-303 A</span>
          <div className="flex gap-0.5">
            {tb303A.map((step, i) => (
              <div
                key={i}
                className={`w-6 h-6 rounded-sm flex items-center justify-center text-[8px] font-mono ${
                  step.note !== -1
                    ? 'bg-amber-500/80 text-black'
                    : i % 4 === 0
                      ? 'bg-gray-700'
                      : 'bg-gray-800'
                }`}
                title={step.note !== -1 ? noteToName(step.note, step.octave) : 'Rest'}
              >
                {step.note !== -1 ? noteToName(step.note, step.octave).slice(0, 2) : ''}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TB-303 B */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-20 text-xs text-amber-500/70 text-right">TB-303 B</span>
          <div className="flex gap-0.5">
            {tb303B.map((step, i) => (
              <div
                key={i}
                className={`w-6 h-6 rounded-sm flex items-center justify-center text-[8px] font-mono ${
                  step.note !== -1
                    ? 'bg-amber-500/60 text-black'
                    : i % 4 === 0
                      ? 'bg-gray-700'
                      : 'bg-gray-800'
                }`}
                title={step.note !== -1 ? noteToName(step.note, step.octave) : 'Rest'}
              >
                {step.note !== -1 ? noteToName(step.note, step.octave).slice(0, 2) : ''}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Drums */}
      <div className="space-y-1">
        {drumPatterns.map(drum => (
          <div key={drum.name} className="flex items-center gap-2">
            <span className="w-20 text-xs text-gray-500 text-right">{drum.name}</span>
            <div className="flex gap-0.5">
              {drum.pattern.map((hit, i) => (
                <div
                  key={i}
                  className={`w-6 h-4 rounded-sm ${
                    hit
                      ? drum.color
                      : i % 4 === 0
                        ? 'bg-gray-700'
                        : 'bg-gray-800'
                  }`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
});
