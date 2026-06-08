import React from 'react';
import type { AISongData } from '../../importers/ai-song/types';
import type { TrackStats } from '../../types/aiSongModal';

interface SongInfoPanelProps {
  parsedData: AISongData;
  trackStats: TrackStats;
}

export const SongInfoPanel: React.FC<SongInfoPanelProps> = ({ parsedData, trackStats }) => {
  return (
    <div className="p-4 bg-gray-900/50 rounded-lg">
      <h3 className="text-sm font-medium text-emerald-400 mb-3">{String(parsedData.meta.title)}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
        <div>
          <span className="text-gray-500 block">Tempo</span>
          <span className="text-white">{String(parsedData.globals.tempo)} BPM</span>
        </div>
        <div>
          <span className="text-gray-500 block">Time Signature</span>
          <span className="text-white">{String((parsedData.globals.timeSignature as any[]).join('/'))}</span>
        </div>
        <div>
          <span className="text-gray-500 block">Swing</span>
          <span className="text-white">{String(parsedData.globals?.swing ?? 0)}%</span>
        </div>
        <div>
          <span className="text-gray-500 block">Est. Duration</span>
          <span className="text-white">{String(trackStats.duration.toFixed(1))}s</span>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <span className="text-gray-500 block">Total Notes</span>
          <span className="text-white">{String(trackStats.totalNotes ?? 0)}</span>
        </div>
      </div>
    </div>
  );
};
