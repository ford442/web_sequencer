import React from 'react';
import { Tooltip } from './Tooltip';

interface PatternGridPanelProps {
  patternGrid: {
    tracks: string[];
    grid: boolean[][];
  };
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const PatternGridPanel: React.FC<PatternGridPanelProps> = React.memo(({ patternGrid }) => {
  return (
    <div className="p-4 bg-gray-900/50 rounded-lg">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Pattern Preview (8 tracks × 32 steps)</h3>
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {patternGrid.grid.map((row, trackIdx) => (
            <div key={String(trackIdx)} className="flex items-center gap-1 mb-1">
              <span className="w-16 sm:w-20 text-[10px] sm:text-xs text-gray-500 text-right mr-2 shrink-0">
                {String(patternGrid.tracks[trackIdx])}
              </span>
              <div className="flex gap-0.5">
                {row.map((active, stepIdx) => (
                  <Tooltip key={stepIdx} text={String(`Step ${stepIdx}`)} position="top">
                    <div
                      className={`w-1.5 h-3 sm:w-2 sm:h-4 rounded-sm transition-colors ${
                        active
                          ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]'
                          : stepIdx % 4 === 0
                            ? 'bg-gray-700'
                            : 'bg-gray-800'
                      }`}
                    />
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
