// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
import React, { memo } from 'react';
import type { OscillatorType, OscillatorTheme } from '../types';
import { OSCILLATOR_THEMES } from '../types';

interface OscillatorTypeSelectorProps {
  /** Currently active oscillator family (derived or stored). */
  type: OscillatorType;
  /** Called when user picks a different oscillator family. Parent maps to waveform + engine303 updates. */
  onChange: (type: OscillatorType) => void;
  /** Accent colour matching the parent rack module (cyan for SYNTH A, pink for SYNTH B). */
  accentColor?: 'pink' | 'cyan';
  /** Optional compact mode (smaller buttons, for tight overlays). */
  compact?: boolean;
}

/**
 * Oscillator Type selector — the new primary control for choosing the "sound engine family".
 *
 * Replaces the flat list of waveform buttons with a higher-level themed selector.
 * Clicking a type typically switches the voice to a representative waveform for that family
 * (see getDefaultWaveformForType) and applies the matching visual theme to the oscillator panel.
 *
 * Phase 1: basic theming + type switching.
 * Future: per-type custom parameter sub-panels (e.g. Prophecy vowels live inside the themed container).
 */
export const OscillatorTypeSelector: React.FC<OscillatorTypeSelectorProps> = memo(({
  type,
  onChange,
  accentColor = 'pink',
  compact = false,
}) => {
  const types = Object.keys(OSCILLATOR_THEMES) as OscillatorType[];

  const partAccent = accentColor === 'cyan'
    ? 'from-cyan-500 to-cyan-600 text-white border-cyan-400 shadow-[0_0_10px_rgba(0,229,255,0.4)]'
    : 'from-pink-500 to-pink-600 text-white border-pink-400 shadow-[0_0_10px_rgba(255,0,102,0.4)]';

  const inactiveBase = 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200';

  return (
    <div
      className={`flex flex-col gap-1 p-2 rounded-lg bg-zinc-950/80 border ${accentColor === 'cyan' ? 'border-cyan-500/20' : 'border-pink-500/20'}`}
      role="group"
      aria-label="Oscillator type selection"
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[8px] font-mono uppercase tracking-wider ${accentColor === 'cyan' ? 'text-cyan-400/70' : 'text-pink-400/70'}`}>
          Oscillator
        </span>
        <span
          className={`text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${accentColor === 'cyan' ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60' : 'bg-pink-950/90 text-pink-300 border-pink-500/60'}`}
          title={`Active oscillator family: ${OSCILLATOR_THEMES[type].label}`}
        >
          {OSCILLATOR_THEMES[type].badge ?? OSCILLATOR_THEMES[type].label.slice(0, 3).toUpperCase()}
        </span>
      </div>

      <div className={`flex flex-wrap gap-1 ${compact ? 'text-[8px]' : 'text-[9px]'}`}>
        {types.map((t) => {
          const theme: OscillatorTheme = OSCILLATOR_THEMES[t];
          const isActive = t === type;

          // Static safe classes (Tailwind JIT cannot handle template literals for colors at runtime).
          // Each family gets its own distinctive but subtle active treatment for theming.
          const activeStyleMap: Record<OscillatorType, string> = {
            javascript: 'bg-gradient-to-b from-sky-500 to-sky-600 text-white border-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.35)]',
            pcm: 'bg-gradient-to-b from-stone-500 to-stone-600 text-white border-stone-400 shadow-[0_0_10px_rgba(120,113,108,0.35)]',
            open303: 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.35)]',
            jc303: 'bg-gradient-to-b from-teal-500 to-teal-600 text-white border-teal-400 shadow-[0_0_10px_rgba(20,184,166,0.35)]',
            prophecy: 'bg-gradient-to-b from-violet-500 to-violet-600 text-white border-violet-400 shadow-[0_0_10px_rgba(139,92,246,0.35)]',
            pyodide: 'bg-gradient-to-b from-yellow-500 to-yellow-600 text-white border-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.35)]',
            rust: 'bg-gradient-to-b from-orange-500 to-orange-600 text-white border-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.35)]',
            webgpu: 'bg-gradient-to-b from-fuchsia-500 to-fuchsia-600 text-white border-fuchsia-400 shadow-[0_0_10px_rgba(217,70,239,0.35)]',
            wam: 'bg-gradient-to-b from-amber-500 to-amber-600 text-white border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.35)]',
          };

          return (
            <button
              key={t}
              onClick={() => onChange(t)}
              aria-pressed={isActive}
              title={`${theme.label} oscillator family`}
              className={`px-2 py-0.5 font-bold rounded-md transition-all border flex-1 min-w-[52px] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115] ${accentColor === 'cyan' ? 'focus-visible:ring-cyan-500' : 'focus-visible:ring-pink-500'} ${
                isActive ? activeStyleMap[t] : inactiveBase
              }`}
            >
              {theme.badge ?? theme.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
