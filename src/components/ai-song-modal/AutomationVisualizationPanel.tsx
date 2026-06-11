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
  if (trackStats.automationLaneCount <= 0 || !parsedData?.automation) return null;

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
