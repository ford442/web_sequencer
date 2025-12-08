import React from 'react';
import type { Waveform } from '../types';

interface WaveformSelectorProps {
  selected: Waveform;
  onChange: (waveform: Waveform) => void;
  accentColor: 'cyan' | 'pink';
}

const waveforms: Waveform[] = ['sawtooth', 'square', 'triangle', 'sine'];

const WaveformIcon: React.FC<{ type: Waveform }> = ({ type }) => {
  switch (type) {
    case 'sawtooth':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M0 18 L12 6 L12 18 L24 6 L24 18" /></svg>;
    case 'square':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M0 18 L0 6 L12 6 L12 18 L24 18 L24 6" /></svg>;
    case 'triangle':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M0 12 L6 6 L18 18 L24 12" /></svg>;
    case 'sine':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M0 12 Q6 0, 12 12 T24 12" /></svg>;
    default:
      return null;
  }
};

export const WaveformSelector: React.FC<WaveformSelectorProps> = ({ selected, onChange, accentColor }) => {
  const accentClasses = {
    cyan: 'bg-cyan-500 text-gray-900 ring-cyan-400',
    pink: 'bg-pink-500 text-gray-900 ring-pink-400',
  };

  const handleSelect = (e: React.MouseEvent, wave: Waveform) => {
    // PREVENT THE PANEL FROM CLOSING
    e.preventDefault();
    e.stopPropagation();
    onChange(wave);
  };

  return (
    <div
      className="flex justify-around items-center bg-gray-800 rounded-md p-1"
      // Also stop propagation on the container to be safe
      onClick={(e) => e.stopPropagation()}
    >
      {waveforms.map((wave) => (
        <button
          key={wave}
          onClick={(e) => handleSelect(e, wave)}
          aria-pressed={selected === wave}
          aria-label={`Select ${wave} waveform`}
          type="button" // Explicitly prevent form submission
          className={`w-10 h-10 p-2 rounded-md transition-all duration-200 focus:outline-none focus:ring-2 ring-offset-2 ring-offset-gray-900 ${selected === wave
              ? accentClasses[accentColor]
              : 'text-gray-500 hover:bg-gray-700 hover:text-gray-300'
            }`}
        >
          <WaveformIcon type={wave} />
        </button>
      ))}
    </div>
  );
};