
import React from 'react';
import type { AmbianceTrack } from '../types';

interface AmbiancePlayerProps {
  tracks: AmbianceTrack[];
  selectedUrl: string;
  onSelect: (url: string) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
}

export const AmbiancePlayer: React.FC<AmbiancePlayerProps> = ({ tracks, selectedUrl, onSelect, volume, onVolumeChange }) => {
  return (
    <div className="flex items-center space-x-3 bg-gray-900 p-2 rounded-lg border border-gray-700">
      <label htmlFor="ambiance-select" className="text-xs text-gray-400 uppercase tracking-wider">Ambiance</label>
      <select
        id="ambiance-select"
        value={selectedUrl}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-gray-800 text-gray-200 border-2 border-gray-700 rounded-md text-sm focus:border-indigo-400 focus:ring-0 focus:outline-none"
      >
        {tracks.map(track => (
          <option key={track.name} value={track.url}>{track.name}</option>
        ))}
      </select>
      <div className="flex items-center space-x-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
          <path d="M7 4a1 1 0 00-2 0v12a1 1 0 102 0V4zM13 4a1 1 0 10-2 0v12a1 1 0 102 0V4z" />
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="w-24 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          aria-label="Ambiance volume"
          aria-valuetext={`${Math.round(volume * 100)}%`}
        />
      </div>
    </div>
  );
};
