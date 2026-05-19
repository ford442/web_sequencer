
import React, { useRef } from 'react';
import type { Waveform } from '../types';

interface WaveformSelectorProps {
  selected: Waveform;
  onChange: (waveform: Waveform) => void;
  accentColor: 'cyan' | 'pink';
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
const WaveformIcon: React.FC<{ type: Waveform }> = React.memo(({ type }) => {
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
    // NEW: Rust icons
    case 'rust-saw':
      return <div className="font-bold text-[10px] leading-none text-center text-orange-500">RUST<br/>SAW</div>;
    case 'rust-sqr':
      return <div className="font-bold text-[10px] leading-none text-center text-orange-500">RUST<br/>SQR</div>;
    // NEW: Open303 (TB-303 clone) icons
    case '303-saw':
      return <div className="font-bold text-[10px] leading-none text-center text-green-400">303<br/>SAW</div>;
    case '303-sqr':
      return <div className="font-bold text-[10px] leading-none text-center text-green-400">303<br/>SQR</div>;
    default:
      // Always show at least the waveform name so unknown types are visible
      return <div className="font-bold text-[10px] leading-none text-center break-all">{type}</div>;
  }
});

const OSCILLATOR_GROUPS = [
  { label: 'JavaScript', items: ['sawtooth', 'square', 'triangle', 'sine'] as Waveform[] },
  { label: 'PCM', items: ['wav-saw', 'wav-sqr'] as Waveform[] },
  { label: 'Open303', items: ['303-saw', '303-sqr'] as Waveform[] },
  { label: 'Pyodide', items: ['pyodide-saw', 'pyodide-square', 'pyodide-sine'] as Waveform[] },
  { label: 'Rust', items: ['rust-saw', 'rust-sqr'] as Waveform[] },
  { label: 'WebGPU', items: ['wgsl-saw', 'wgsl-sqr', 'wgsl-tri', 'wgsl-sin'] as Waveform[] },
  { label: 'Web Audio Module', items: ['wam-saw', 'wam-sqr', 'wam-tri', 'wam-sin'] as Waveform[] },
];

// Flat list of all waveforms in display order, for cycling
const ALL_WAVEFORMS: Waveform[] = OSCILLATOR_GROUPS.flatMap(g => g.items);

// Get the next waveform in the cycle (wraps around across all groups)
const getNextWaveform = (current: Waveform, reverse = false): Waveform => {
  const idx = ALL_WAVEFORMS.indexOf(current);
  if (idx === -1) {
    // Unknown waveform: fall back to the first waveform
    return ALL_WAVEFORMS[0];
  }
  const step = reverse ? -1 : 1;
  const nextIndex = (idx + step + ALL_WAVEFORMS.length) % ALL_WAVEFORMS.length;
  return ALL_WAVEFORMS[nextIndex];
};

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const WaveformSelector: React.FC<WaveformSelectorProps> = React.memo(({ selected, onChange, accentColor }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const accentClasses = {
    cyan: 'bg-cyan-500 text-gray-900 border-cyan-400 ring-cyan-400',
    pink: 'bg-pink-500 text-gray-900 border-pink-400 ring-pink-400',
  };

  const bgClasses = {
      cyan: 'hover:bg-cyan-900/30 text-cyan-400',
      pink: 'hover:bg-pink-900/30 text-pink-400'
  };

  // Handle waveform cycling on left click (Shift+click cycles in reverse)
  const handleWaveformClick = (e: React.MouseEvent) => {
    const nextWaveform = getNextWaveform(selected, e.shiftKey);
    onChange(nextWaveform);
  };

  return (
    <div className="relative inline-flex flex-col gap-2 p-2 bg-gray-800/50 rounded-lg border border-gray-700 max-h-[500px] overflow-y-auto custom-scrollbar" ref={containerRef}>
      {/* Header with title and cycling button */}
      <div className="flex items-center justify-between gap-2 px-2 pb-2 border-b border-gray-700">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Waveforms</span>
        <button
          ref={triggerRef}
          onClick={handleWaveformClick}
          aria-label={`Current waveform: ${selected}. Click to cycle, Shift+click to cycle back.`}
          title={`Current: ${selected}. Click to cycle, Shift+click for reverse.`}
          className={`w-8 h-8 p-1.5 rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ring-offset-gray-900 border border-gray-600 bg-gray-700 hover:bg-gray-600 flex items-center justify-center ${accentColor === 'cyan' ? 'focus:ring-cyan-400 ring-cyan-400' : 'focus:ring-pink-400 ring-pink-400'}`}
        >
          <WaveformIcon type={selected} />
        </button>
      </div>

      {/* Oscillator groups as vertical column */}
      <div className="flex flex-col gap-3">
        {OSCILLATOR_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            {/* Engine label */}
            <div className="text-[10px] font-bold text-gray-500 px-2 uppercase tracking-widest">
              {group.label}
            </div>
            {/* Waveform buttons in a row */}
            <div className="flex flex-wrap gap-1 px-2">
              {group.items.map((wave) => (
                <button
                  key={wave}
                  onClick={() => { onChange(wave); triggerRef.current?.focus(); }}
                  aria-pressed={selected === wave}
                  aria-current={selected === wave ? 'true' : undefined}
                  aria-label={`Select ${wave} waveform`}
                  title={wave}
                  className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-offset-1 ring-offset-gray-900 flex items-center justify-center whitespace-nowrap ${
                    selected === wave
                      ? `${accentClasses[accentColor]} shadow-lg`
                      : `bg-gray-700 ${bgClasses[accentColor]} border border-gray-600 hover:border-gray-500`
                  }`}
                >
                  <WaveformIcon type={wave} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
