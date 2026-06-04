import React, { memo } from 'react';
import type { OscillatorType, Waveform } from '../types';
import { getWaveformsForType, OSCILLATOR_THEMES } from '../types';

interface OscillatorVariantSelectorProps {
  /** The high-level oscillator family (determines which variants are offered). */
  type: OscillatorType;
  /** The currently selected concrete waveform (must be compatible with type, or first will be treated as selected). */
  selected: Waveform;
  /** Called with a concrete waveform variant from this type's list. Does not change the OscillatorType. */
  onChange: (waveform: Waveform) => void;
  /** Accent colour matching the parent rack module (cyan for SYNTH A, pink for SYNTH B). */
  accentColor?: 'pink' | 'cyan';
}

/**
 * Per-oscillator-type waveform variant picker.
 *
 * Renders a compact row of buttons for the specific sub-waveforms belonging to the active OscillatorType
 * (e.g. SAW/SQR/TRI/SIN for 'javascript', or the 4 prophecy carriers, or 303-saw/sqr etc).
 *
 * This replaces the legacy full WaveformSelector popup for the main synth overlays in Phase 2+.
 * Keeps selection within family so the outer OscillatorTypeSelector + panel theme stay stable.
 *
 * Themed lightly using part accent for active state; sits inside a container already tinted by getOscillatorPanelClasses.
 */
export const OscillatorVariantSelector: React.FC<OscillatorVariantSelectorProps> = memo(({
  type,
  selected,
  onChange,
  accentColor = 'pink',
}) => {
  const variants = getWaveformsForType(type);
  if (variants.length === 0) return null;

  const theme = OSCILLATOR_THEMES[type];

  // Family-specific active styling for variant buttons (stronger osc-type theming inside the panel).
  // Mirrors the approach in OscillatorTypeSelector for consistency.
  const familyActiveMap: Record<OscillatorType, string> = {
    javascript: 'bg-gradient-to-b from-sky-500 to-sky-600 text-white border-sky-400 shadow-[0_0_8px_rgba(14,165,233,0.4)]',
    pcm: 'bg-gradient-to-b from-stone-500 to-stone-600 text-white border-stone-400 shadow-[0_0_8px_rgba(120,113,108,0.4)]',
    open303: 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]',
    jc303: 'bg-gradient-to-b from-teal-500 to-teal-600 text-white border-teal-400 shadow-[0_0_8px_rgba(20,184,166,0.4)]',
    prophecy: 'bg-gradient-to-b from-violet-500 to-violet-600 text-white border-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.4)]',
    pyodide: 'bg-gradient-to-b from-yellow-500 to-yellow-600 text-white border-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.4)]',
    rust: 'bg-gradient-to-b from-orange-500 to-orange-600 text-white border-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.4)]',
    webgpu: 'bg-gradient-to-b from-fuchsia-500 to-fuchsia-600 text-white border-fuchsia-400 shadow-[0_0_8px_rgba(217,70,239,0.4)]',
    wam: 'bg-gradient-to-b from-amber-500 to-amber-600 text-white border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]',
  };

  const inactiveBase = 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200';

  // Short labels for the tight overlay UI
  const getLabel = (w: Waveform): string => {
    const s = w as string;
    if (s === 'sawtooth' || s === '303-saw' || s === 'prophecy-saw' || s === 'rust-saw' || s === 'wav-saw' || s === 'pyodide-saw' || s === 'wgsl-saw' || s === 'wam-saw') return 'SAW';
    if (s === 'square' || s === '303-sqr' || s === 'prophecy-sqr' || s === 'rust-sqr' || s === 'wav-sqr' || s === 'pyodide-square' || s === 'wgsl-sqr' || s === 'wam-sqr') return 'SQR';
    if (s === 'triangle' || s === 'prophecy-tri' || s === 'wgsl-tri' || s === 'wam-tri') return 'TRI';
    if (s === 'sine' || s === 'pyodide-sine' || s === 'wgsl-sin' || s === 'wam-sin') return 'SIN';
    if (s === 'prophecy-pulse') return 'PLS';
    // Fallback to last segment or upper
    return s.split('-').pop()?.toUpperCase().slice(0, 3) ?? 'WAV';
  };

  // Determine if this variant "matches" current selection.
  // We match on exact waveform; also tolerate if selected derives to same type but different (edge).
  const isActive = (w: Waveform) => w === selected;

  return (
    <div
      className={`flex flex-col gap-1 p-1.5 rounded-md bg-zinc-950/60 border ${accentColor === 'cyan' ? 'border-cyan-500/10' : 'border-pink-500/10'}`}
      role="group"
      aria-label={`${theme.label} waveform variants`}
    >
      <div className="flex items-center justify-between gap-1 px-0.5">
        <span className={`text-[7px] font-mono uppercase tracking-widest ${accentColor === 'cyan' ? 'text-cyan-400/60' : 'text-pink-400/60'}`}>
          {type === 'prophecy' ? 'Carrier' : type.includes('303') ? 'Wave' : 'Shape'}
        </span>
        <span className={`text-[6px] font-bold uppercase tracking-[1px] ${theme.text} opacity-70`}>
          {theme.badge}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {variants.map((w) => {
          const label = getLabel(w);
          const active = isActive(w);
          return (
            <button
              key={w}
              onClick={() => onChange(w)}
              aria-pressed={active}
              title={`${theme.label} ${label} (${w})`}
              className={`px-1.5 py-0.5 text-[8px] font-bold rounded transition-all border flex-1 min-w-[32px] ${
                active ? familyActiveMap[type] : inactiveBase
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
});

OscillatorVariantSelector.displayName = 'OscillatorVariantSelector';
