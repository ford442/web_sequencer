
import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
      return <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M0 18 L12 6 L12 18 L24 6 L24 18" /></svg>;
    case 'square':
      return <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M0 18 L0 6 L12 6 L12 18 L24 18 L24 6" /></svg>;
    case 'triangle':
      return <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M0 12 L6 6 L18 18 L24 12" /></svg>;
    case 'sine':
      return <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M0 12 Q6 0, 12 12 T24 12" /></svg>;
    // Native WAV icons
    case 'wav-saw':
      return (
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <text x="0" y="8" fontSize="8" fill="currentColor" stroke="none">WAV</text>
          <path d="M0 20 L12 10 L12 20 L24 10 L24 20" />
        </svg>
      );
    case 'wav-sqr':
      return (
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <text x="0" y="8" fontSize="8" fill="currentColor" stroke="none">WAV</text>
          <path d="M0 20 L0 10 L12 10 L12 20 L24 20 L24 10" />
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

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

  // Compute popup position from trigger rect when opened
  useEffect(() => {
    if (!isExpanded) {
      setPopupPos(null);
      return;
    }
    const updatePos = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setPopupPos({ top: rect.top, left: rect.left });
      }
    };
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [isExpanded]);

  // Close panel on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        popupRef.current && !popupRef.current.contains(target)
      ) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded]);

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Compact trigger button - always visible */}
      <button
        ref={triggerRef}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-label={`Waveform selector: ${selected}. Click to ${isExpanded ? 'collapse' : 'expand'} options. Click to cycle, Shift+click for reverse.`}
        aria-expanded={isExpanded}
        title={`Current: ${selected}. Click to expand waveforms, or click here to cycle (Shift+click for reverse).`}
        className={`w-10 h-10 p-2 rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ring-offset-gray-900 border border-gray-600 bg-gray-700 hover:bg-gray-600 flex items-center justify-center ${accentColor === 'cyan' ? 'focus:ring-cyan-400 ring-cyan-400' : 'focus:ring-pink-400 ring-pink-400'} ${isExpanded ? 'ring-2' : ''}`}
        onDoubleClick={handleWaveformClick}
      >
        <WaveformIcon type={selected} />
      </button>

      {/* Expandable pop-out panel - rendered via portal to escape stacking contexts */}
      {isExpanded && popupPos && createPortal(
        <div
          ref={popupRef}
          className="fixed z-[1000] origin-top-left"
          style={{
            top: popupPos.top,
            left: popupPos.left,
            animation: 'popOut 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          }}
        >
          <div className="flex items-start gap-2 p-2 bg-gray-900 rounded-lg border border-gray-700 shadow-2xl" role="region" aria-label="Waveform selection panel" tabIndex={0}>
            {/* Left side: Current waveform display and cycle button */}
            <div className="flex flex-col gap-2 border-r border-gray-700 pr-2">
              <div className="text-xs font-bold uppercase tracking-wider text-gray-400 text-center">Current</div>
              <button
                onClick={handleWaveformClick}
                aria-label={`Current waveform: ${selected}. Click to cycle, Shift+click to cycle back.`}
                title={`Current: ${selected}. Click to cycle, Shift+click for reverse.`}
                className={`w-12 h-12 p-2 rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ring-offset-gray-900 border border-gray-600 bg-gray-700 hover:bg-gray-600 flex items-center justify-center ${accentColor === 'cyan' ? 'focus:ring-cyan-400 ring-cyan-400' : 'focus:ring-pink-400 ring-pink-400'}`}
              >
                <WaveformIcon type={selected} />
              </button>
            </div>

            {/* Right side: Oscillator groups */}
            <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto custom-scrollbar">
              {OSCILLATOR_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-1">
                  {/* Engine label as heading for semantic structure */}
                  <h3 className="text-xs font-bold text-gray-500 px-2 uppercase tracking-widest">
                    {group.label}
                  </h3>
                  {/* Waveform buttons in a row */}
                  <div className="flex flex-wrap gap-1 px-2">
                    {group.items.map((wave) => (
                      <button
                        key={wave}
                        onClick={() => { onChange(wave); }}
                        aria-pressed={selected === wave}
                        aria-current={selected === wave ? 'true' : undefined}
                        aria-label={`Select ${wave} waveform ${selected === wave ? '(currently selected)' : ''}`}
                        title={wave}
                        className={`px-2 py-1 text-xs font-bold rounded-md transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-offset-1 ring-offset-gray-900 flex items-center justify-center whitespace-nowrap gap-1 ${
                          selected === wave
                            ? `${accentClasses[accentColor]} shadow-lg`
                            : `bg-gray-700 ${bgClasses[accentColor]} border border-gray-600 hover:border-gray-500`
                        }`}
                      >
                        <WaveformIcon type={wave} />
                        {selected === wave && (
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* CSS for pop-out animation */}
      <style>{`
        @keyframes popOut {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
});
