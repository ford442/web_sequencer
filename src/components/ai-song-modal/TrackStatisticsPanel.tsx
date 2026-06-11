import React from 'react';
import type { TrackStats } from '../../types/aiSongModal';

interface TrackStatisticsPanelProps {
  trackStats: TrackStats | null;
  trackStatisticsRows: React.ReactNode[];
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const TrackStatisticsPanel: React.FC<TrackStatisticsPanelProps> = React.memo(({ trackStats, trackStatisticsRows }) => {
  if (!trackStats) return null;

  return (
    <div className="p-4 bg-gray-900/50 rounded-lg">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Track Statistics</h3>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="text-xs">
          <span className="text-gray-500">Total Events:</span>
          <span className="text-white ml-2">{trackStats.totalNotes}</span>
        </div>
        <div className="text-xs">
          <span className="text-gray-500">Avg Velocity:</span>
          <span className="text-white ml-2">
            {Number.isNaN(Number(trackStats.avgVelocity)) ? '0' : (Number(trackStats.avgVelocity) * 100).toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="space-y-1.5">
        {trackStatisticsRows.length > 0 && trackStatisticsRows}
      </div>
    </div>
  );
});
