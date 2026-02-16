
import React, { useState, useRef, useEffect } from 'react';
import type { Waveform } from '../types';

interface WaveformSelectorProps {
  selected: Waveform;
  onChange: (waveform: Waveform) => void;
  accentColor: 'cyan' | 'pink';
}

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
      return null;
  }
};

const WAVEFORM_DESCRIPTIONS: Record<Waveform, string> = {
  'sawtooth': 'Standard Sawtooth. Rich harmonics, great for leads and basses.',
  'square': 'Standard Square. Hollow sound, good for bass and woodwind-like tones.',
  'triangle': 'Standard Triangle. Mellow, flute-like sound.',
  'sine': 'Standard Sine. Pure tone, no harmonics.',
  'pyodide-saw': 'Python-generated Sawtooth via Pyodide.',
  'pyodide-square': 'Python-generated Square via Pyodide.',
  'pyodide-sine': 'Python-generated Sine via Pyodide.',
  'wgsl-saw': 'GPU-accelerated Sawtooth. Massive unison capability.',
  'wgsl-sqr': 'GPU-accelerated Square. Massive unison capability.',
  'wgsl-tri': 'GPU-accelerated Triangle. Massive unison capability.',
  'wgsl-sin': 'GPU-accelerated Sine. Massive unison capability.',
  'wam-saw': 'WebAssembly Music (WAM) Sawtooth.',
  'wam-sqr': 'WebAssembly Music (WAM) Square.',
  'wam-tri': 'WebAssembly Music (WAM) Triangle.',
  'wam-sin': 'WebAssembly Music (WAM) Sine.',
  'wav-saw': 'Sampled Sawtooth. Vintage analog character.',
  'wav-sqr': 'Sampled Square. Vintage analog character.',
  'rust-saw': 'Rust/WASM Sawtooth. High-performance synthesis.',
  'rust-sqr': 'Rust/WASM Square. High-performance synthesis.',
  '303-saw': 'TB-303 Clone Sawtooth. Acid bass iconic sound.',
  '303-sqr': 'TB-303 Clone Square. Acid bass iconic sound.',
};

const GROUPS = [
  { label: 'BASIC', items: ['sawtooth', 'square', 'triangle', 'sine'] as Waveform[] },
  { label: 'VINTAGE', items: ['wav-saw', 'wav-sqr', '303-saw', '303-sqr'] as Waveform[] },
  { label: 'WASM/JS', items: ['pyodide-saw', 'pyodide-square', 'pyodide-sine', 'rust-saw', 'rust-sqr'] as Waveform[] },
  { label: 'GPU/WEB', items: ['wgsl-saw', 'wgsl-sqr', 'wgsl-tri', 'wgsl-sin', 'wam-saw', 'wam-sqr', 'wam-tri', 'wam-sin'] as Waveform[] },
];

export const WaveformSelector: React.FC<WaveformSelectorProps> = ({ selected, onChange, accentColor }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredWaveform, setHoveredWaveform] = useState<Waveform | null>(null);
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="relative inline-block" ref={containerRef} onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={`Current waveform: ${selected}. Click to change.`}
        className={`w-10 h-10 p-2 rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ring-offset-gray-900 border border-gray-600 bg-gray-800 hover:bg-gray-700 flex items-center justify-center ${isOpen ? 'ring-2' : ''} ${accentColor === 'cyan' ? 'focus:ring-cyan-400 ring-cyan-400' : 'focus:ring-pink-400 ring-pink-400'}`}
      >
        <WaveformIcon type={selected} />
        {/* Subtle indicator triangle */}
        <div className="absolute bottom-0.5 right-0.5 w-0 h-0 border-l-[4px] border-l-transparent border-t-[4px] border-t-gray-400 transform rotate-[-45deg] opacity-50"></div>
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
          <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto overflow-x-hidden custom-scrollbar">
            {GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-1">
                <div className="text-[9px] font-bold text-gray-500 px-1 border-b border-gray-800 pb-0.5 mb-0.5 tracking-wider">
                  {group.label}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {group.items.map((wave) => (
                    <button
                      key={wave}
                      onClick={() => { onChange(wave); setIsOpen(false); triggerRef.current?.focus(); }}
                      onMouseEnter={() => setHoveredWaveform(wave)}
                      onMouseLeave={() => setHoveredWaveform(null)}
                      onFocus={() => setHoveredWaveform(wave)}
                      onBlur={() => setHoveredWaveform(null)}
                      aria-pressed={selected === wave}
                      aria-label={`Select ${wave}`}
                      title={wave}
                      className={`w-10 h-10 p-2 rounded transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-offset-1 ring-offset-gray-900 flex items-center justify-center ${
                        selected === wave
                          ? `${accentClasses[accentColor]} shadow-lg`
                          : `bg-gray-800/50 ${bgClasses[accentColor]} border border-transparent hover:border-gray-600`
                      }`}
                    >
                      <WaveformIcon type={wave} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-gray-800 text-[10px] text-gray-400 font-mono leading-tight min-h-[2.5em] animate-in fade-in duration-200">
            {hoveredWaveform ? WAVEFORM_DESCRIPTIONS[hoveredWaveform] : WAVEFORM_DESCRIPTIONS[selected]}
          </div>
        </div>
      )}
    </div>
  );
};
