import React from 'react';
import type { Waveform } from '../types';

interface WaveformSelectorProps {
  selected: Waveform;
  onChange: (waveform: Waveform) => void;
  accentColor: 'cyan' | 'pink';
}

const waveforms: Waveform[] = [
  'sawtooth', 'square', 'triangle', 'sine',
  'wav-saw', 'wav-sqr',
  'pyodide-saw', 'pyodide-square', 'pyodide-sine',
  'wgsl-saw', 'wgsl-sqr', 'wgsl-tri', 'wgsl-sin',
  'wam-saw', 'wam-sqr', 'wam-tri', 'wam-sin'
];

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
    // Native WAV icons
    case 'wav-saw':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <text x="0" y="8" fontSize="8" fill="currentColor" stroke="none">WAV</text>
          <path d="M0 20 L12 10 L12 20 L24 10 L24 20" transform="translate(0, 0)" />
        </svg>
      );
    case 'wav-sqr':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <text x="0" y="8" fontSize="8" fill="currentColor" stroke="none">WAV</text>
          <path d="M0 20 L0 10 L12 10 L12 20 L24 20 L24 10" transform="translate(0, 0)" />
        </svg>
      );
    // NEW: Pyodide icons
    case 'pyodide-saw':
      return <div className="font-bold text-xs leading-none">PY<br/>SAW</div>;
    case 'pyodide-square':
      return <div className="font-bold text-xs leading-none">PY<br/>SQR</div>;
    case 'pyodide-sine':
      return <div className="font-bold text-xs leading-none">PY<br/>SIN</div>;
    // NEW: WGSL icons
    case 'wgsl-saw':
      return <div className="font-bold text-[10px] leading-none text-center">GPU<br/>SAW</div>;
    case 'wgsl-sqr':
      return <div className="font-bold text-[10px] leading-none text-center">GPU<br/>SQR</div>;
    case 'wgsl-tri':
      return <div className="font-bold text-[10px] leading-none text-center">GPU<br/>TRI</div>;
    case 'wgsl-sin':
      return <div className="font-bold text-[10px] leading-none text-center">GPU<br/>SIN</div>;
    // NEW: WAM icons
    case 'wam-saw':
      return <div className="font-bold text-[10px] leading-none text-center text-yellow-500">WAM<br/>SAW</div>;
    case 'wam-sqr':
      return <div className="font-bold text-[10px] leading-none text-center text-yellow-500">WAM<br/>SQR</div>;
    case 'wam-tri':
      return <div className="font-bold text-[10px] leading-none text-center text-yellow-500">WAM<br/>TRI</div>;
    case 'wam-sin':
      return <div className="font-bold text-[10px] leading-none text-center text-yellow-500">WAM<br/>SIN</div>;
    default:
      return null;
  }
};

export const WaveformSelector: React.FC<WaveformSelectorProps> = ({ selected, onChange, accentColor }) => {
  const accentClasses = {
    cyan: 'bg-cyan-500 text-gray-900',
    pink: 'bg-pink-500 text-gray-900',
  };

  return (
    // UPDATED: Added flex-wrap, gap-1, and changed justify-around to justify-center
    <div className="flex flex-wrap justify-center gap-1 bg-gray-800 rounded-md p-1">
      {waveforms.map((wave) => (
        <button
          key={wave}
          onClick={() => onChange(wave)}
          aria-pressed={selected === wave}
          aria-label={`Select ${wave} waveform`}
          className={`w-10 h-10 p-2 rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 ring-offset-2 ring-offset-gray-900 ${
            selected === wave
              ? accentClasses[accentColor]
              : 'text-gray-500 hover:bg-gray-700 hover:text-gray-300'
          } ${accentColor === 'cyan' ? 'focus:ring-cyan-400' : 'focus:ring-pink-400'}`}
        >
          <WaveformIcon type={wave} />
        </button>
      ))}
    </div>
  );
};