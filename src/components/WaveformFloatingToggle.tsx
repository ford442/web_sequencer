import React, { useState } from 'react';
import { WaveformSelector } from './WaveformSelector';
import type { Waveform } from '../types';

interface WaveformFloatingToggleProps {
  selected: Waveform;
  onChange: (w: Waveform) => void;
  accentColor: 'cyan' | 'pink';
  disabled?: boolean;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const WaveformFloatingToggle: React.FC<WaveformFloatingToggleProps> = React.memo(({ selected, onChange, accentColor, disabled }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute top-2 right-4 z-50 pointer-events-auto">
      <button
        aria-label="Open waveform selector"
        aria-expanded={open}
        aria-controls="waveform-selector-popover"
        title={open ? 'Close waveform selector' : 'Open waveform selector'}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={`rounded-md px-3 py-2 font-mono text-xs font-bold shadow-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 focus-visible:ring-cyan-400 ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-800' : 'bg-cyan-900 hover:bg-cyan-800 text-cyan-300 border border-cyan-700'}`}
      >
        {open ? <><span aria-hidden="true">✕</span> Close</> : <><span aria-hidden="true">♪</span> Waveforms</>}
      </button>
      {open && (
        <div id="waveform-selector-popover" className="absolute top-full right-0 mt-2 z-[100] pointer-events-auto p-2 bg-gray-900 border border-cyan-900/50 rounded-md shadow-2xl min-w-[300px]">
          <WaveformSelector selected={selected} onChange={onChange} accentColor={accentColor} />
        </div>
      )}
    </div>
  );
});

export default WaveformFloatingToggle;

