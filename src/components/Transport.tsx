import React from 'react';
import { DragValue } from './DragValue';

interface TransportProps {
  isPlaying: boolean;
  onPlayClick: () => void;
  tempo: number;
  onTempoChange: (tempo: number) => void;
}

export const Transport: React.FC<TransportProps> = ({ isPlaying, onPlayClick, tempo, onTempoChange }) => {
  return (
    <div className="flex items-center space-x-4 bg-gray-900 p-2 rounded-lg border border-gray-700">
      <button
        onClick={onPlayClick}
        aria-label={isPlaying ? 'Stop sequencer' : 'Play sequencer'}
        aria-pressed={isPlaying}
        title={isPlaying ? 'Stop sequencer (Space)' : 'Play sequencer (Space)'}
        className={`w-12 h-12 flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 ${
          isPlaying
            ? 'bg-red-500 hover:bg-red-600 focus:ring-red-400'
            : 'bg-green-500 hover:bg-green-600 focus:ring-green-400'
        }`}
      >
        {isPlaying ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5 5a1 1 0 011-1h8a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1V5z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
          </svg>
        )}
      </button>
      <div className="flex flex-col items-center">
        <DragValue
          label="Tempo"
          value={tempo}
          onChange={(v) => onTempoChange(Math.max(30, Math.min(300, Math.round(v))))}
          min={30}
          max={300}
          step={1}
        />
      </div>
    </div>
  );
};
