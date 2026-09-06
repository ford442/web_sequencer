import React from 'react';
import type { TrackStats } from '../../types/aiSongModal';

interface TrackStatisticsPanelProps {
  trackStats: TrackStats | null;
  trackStatisticsRows: React.ReactNode[];
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const TrackStatisticsPanel: React.FC<TrackStatisticsPanelProps> = React.memo(({ trackStats, trackStatisticsRows }) => {
  if (!trackStats) {
    return (
      <div className="p-4">
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center bg-gray-800/20 border border-dashed border-gray-700 rounded-lg">
          <div className="w-12 h-12 rounded-full bg-cyan-900/30 flex items-center justify-center mb-4 text-cyan-500" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-gray-300 font-bold mb-2 text-sm">No track statistics</h3>
          <p className="text-gray-500 text-xs max-w-[250px]">
            Track statistics will appear here once the file is loaded.
          </p>
        </div>
      </div>
    );
  }

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
