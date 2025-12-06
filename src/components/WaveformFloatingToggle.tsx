import React, { useState } from 'react';
import { WaveformSelector } from './WaveformSelector';
import type { Waveform } from '../types';

interface WaveformFloatingToggleProps {
  selected: Waveform;
  onChange: (w: Waveform) => void;
  accentColor: 'cyan' | 'pink';
  disabled?: boolean;
}

export const WaveformFloatingToggle: React.FC<WaveformFloatingToggleProps> = ({ selected, onChange, accentColor, disabled }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-[330px] right-6 z-50 pointer-events-auto">
      <button
        aria-label="Open waveform selector"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={`rounded-md px-3 py-2 font-mono text-xs font-bold shadow-lg transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : 'bg-gray-800 hover:bg-gray-700 text-cyan-400 border border-cyan-900'}`}
      >
        {open ? 'Close Waveforms' : 'Waveforms'}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-60 pointer-events-auto p-2 bg-gray-900 border border-gray-700 rounded-md shadow-2xl">
          <WaveformSelector selected={selected} onChange={onChange} accentColor={accentColor} />
        </div>
      )}
    </div>
  );
};

export default WaveformFloatingToggle;

