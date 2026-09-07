import React from 'react';
import type { TrackStats } from '../../types/aiSongModal';
import type { AISongData } from '../../importers/ai-song/types';

interface AutomationVisualizationPanelProps {
  trackStats: TrackStats;
  parsedData: AISongData | null;
  parsedAutomationRows: React.ReactNode[] | null;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const AutomationVisualizationPanel: React.FC<AutomationVisualizationPanelProps> = React.memo(({
  trackStats,
  parsedData,
  parsedAutomationRows
}) => {
  if (trackStats.automationLaneCount <= 0 || !parsedData?.automation) {
    return (
      <div className="p-4">
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center bg-gray-800/20 border border-dashed border-gray-700 rounded-lg">
          <div className="w-12 h-12 rounded-full bg-cyan-900/30 flex items-center justify-center mb-4 text-cyan-500" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <h3 className="text-gray-300 font-bold mb-2 text-sm">No automation lanes</h3>
          <p className="text-gray-500 text-xs max-w-[250px]">
            This song has no automation data. Lanes will appear here when the import includes parameter curves.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-900/50 rounded-lg">
      <h3 className="text-sm font-medium text-gray-300 mb-3">
        Automation ({trackStats.automationLaneCount} lanes, {trackStats.automationPointCount} points)
      </h3>
      <div className="space-y-3">
        {parsedAutomationRows}
      </div>

      {/* Automated Parameters Summary */}
      <div className="mt-3 pt-3 border-t border-gray-800">
        <p className="text-[10px] text-gray-500 mb-2">Automated Parameters:</p>
        <div className="flex flex-wrap gap-1">
          {trackStats.automatedParams.map((param, idx) => (
            <span
              key={idx}
              className="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded text-[10px] text-cyan-400"
            >
              {param}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});
