// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
// Character-driven oscillator module selector.
// Replaces the flat WaveformSelector in SynthPart with 5 personality-driven cards,
// each with a distinct hardware-style icon face and colour theme.
// Clicking a card sets the representative waveform for that character.
// The active card is derived from the current waveform via waveformToModuleId().

import React, { memo } from 'react';
import type { Waveform } from '../types';
import { oscillatorIconUrl } from './oscillatorThemes';

// ── Icon faces ──────────────────────────────────────────────────────────────
// Hardware-style LCD icon faces live in public/osc/icons/*.svg (bezel + glowing
// trace in each character's accent). Accent colour is baked into the asset; the
// LED dot in each card reflects the active state.

// ── Module definitions ───────────────────────────────────────────────────────

interface OscModule {
  id: string;
  label: string;
  sub: string;
  /** Default waveform that pressing this card sets. */
  waveform: Waveform;
  /** File stem in public/osc/icons/. */
  icon: string;
}

const MODULES: OscModule[] = [
  { id: 'analog-saw',     label: 'Analog Saw',  sub: 'fat · warm',    waveform: 'sawtooth',     icon: 'saw' },
  { id: 'digital-sqr',   label: 'Digital Sqr',  sub: 'crisp · cold',  waveform: 'square',       icon: 'square' },
  { id: 'sine-sub',      label: 'Sine / Sub',   sub: 'pure · deep',   waveform: 'sine',         icon: 'sine' },
  { id: 'aggressive',    label: 'Aggressive',   sub: 'raw · gritty',  waveform: 'prophecy-saw', icon: 'aggressive' },
  { id: 'textural',      label: 'Textural',     sub: 'airy · layered',waveform: 'wgsl-saw',     icon: 'textural' },
];

// Static Tailwind classes per module (JIT cannot evaluate dynamic colour names at runtime).
const ACTIVE_CARD: Record<string, string> = {
  'analog-saw':   'border-amber-400/80 bg-amber-950/50 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.25)]',
  'digital-sqr':  'border-sky-400/80   bg-sky-950/50   text-sky-300   shadow-[0_0_12px_rgba(56,189,248,0.25)]',
  'sine-sub':     'border-violet-400/80 bg-violet-950/50 text-violet-300 shadow-[0_0_12px_rgba(167,139,250,0.25)]',
  'aggressive':   'border-rose-400/80  bg-rose-950/50  text-rose-300  shadow-[0_0_12px_rgba(251,113,133,0.25)]',
  'textural':     'border-teal-400/80  bg-teal-950/50  text-teal-300  shadow-[0_0_12px_rgba(45,212,191,0.25)]',
};

const HOVER_CARD: Record<string, string> = {
  'analog-saw':   'hover:border-amber-600/60 hover:bg-amber-950/25 hover:text-amber-400/80',
  'digital-sqr':  'hover:border-sky-600/60   hover:bg-sky-950/25   hover:text-sky-400/80',
  'sine-sub':     'hover:border-violet-600/60 hover:bg-violet-950/25 hover:text-violet-400/80',
  'aggressive':   'hover:border-rose-600/60  hover:bg-rose-950/25  hover:text-rose-400/80',
  'textural':     'hover:border-teal-600/60  hover:bg-teal-950/25  hover:text-teal-400/80',
};

const LED_ON: Record<string, string> = {
  'analog-saw':   'bg-amber-300 shadow-[0_0_4px_rgba(251,191,36,0.9)]',
  'digital-sqr':  'bg-sky-300 shadow-[0_0_4px_rgba(56,189,248,0.9)]',
  'sine-sub':     'bg-violet-300 shadow-[0_0_4px_rgba(167,139,250,0.9)]',
  'aggressive':   'bg-rose-300 shadow-[0_0_4px_rgba(251,113,133,0.9)]',
  'textural':     'bg-teal-300 shadow-[0_0_4px_rgba(45,212,191,0.9)]',
};

const FOCUS_RING: Record<string, string> = {
  'analog-saw':   'focus-visible:ring-amber-500/60',
  'digital-sqr':  'focus-visible:ring-sky-500/60',
  'sine-sub':     'focus-visible:ring-violet-500/60',
  'aggressive':   'focus-visible:ring-rose-500/60',
  'textural':     'focus-visible:ring-teal-500/60',
};

// ── Waveform → module mapping ────────────────────────────────────────────────
// Derive the active character from the current raw Waveform value.
// Designed to be stable: any saw-family → analog-saw, etc.
function waveformToModuleId(w: Waveform): string {
  const s = w as string;
  if (s === 'triangle' || s === 'wgsl-tri' || s === 'wam-tri'
    || s === 'sine'    || s === 'wgsl-sin' || s === 'wam-sin' || s === 'pyodide-sine') {
    return 'sine-sub';
  }
  if (s === 'square' || s.endsWith('-sqr') || s === 'pyodide-square') {
    return 'digital-sqr';
  }
  if (s.startsWith('prophecy-')) {
    return 'aggressive';
  }
  if (s.startsWith('wav-') || s.startsWith('wam-')) {
    return 'textural';
  }
  // sawtooth, 303-saw, wgsl-saw, pyodide-saw → analog-saw (default)
  return 'analog-saw';
}

// ── Component ────────────────────────────────────────────────────────────────

interface OscillatorModuleSelectorProps {
  selected: Waveform;
  onChange: (waveform: Waveform) => void;
  accentColor?: 'cyan' | 'pink';
}

export const OscillatorModuleSelector: React.FC<OscillatorModuleSelectorProps> = memo(({
  selected,
  onChange,
  accentColor = 'cyan',
}) => {
  const activeId = waveformToModuleId(selected);

  const containerBorder = accentColor === 'cyan'
    ? 'border-cyan-500/10'
    : 'border-pink-500/10';

  return (
    <div
      className={`grid grid-cols-3 gap-1 p-1 rounded-lg bg-zinc-950/60 border ${containerBorder}`}
      role="group"
      aria-label="Oscillator character selection"
    >
      {MODULES.map((m) => {
        const isActive = m.id === activeId;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.waveform)}
            aria-pressed={isActive}
            title={`${m.label} — ${m.sub}`}
            className={[
              'flex flex-col items-center gap-0.5 px-1 pt-1.5 pb-1 rounded-md border',
              'transition-all duration-150 active:scale-95',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-900',
              FOCUS_RING[m.id],
              isActive
                ? ACTIVE_CARD[m.id]
                : `border-zinc-700/50 bg-zinc-900/50 text-zinc-500 ${HOVER_CARD[m.id]}`,
            ].join(' ')}
          >
            {/* Hardware icon face + status LED */}
            <div className="relative w-10 h-[23px]">
              <img
                src={oscillatorIconUrl(m.icon)}
                alt=""
                aria-hidden="true"
                draggable={false}
                width={48}
                height={28}
                className={`w-full h-full transition-[filter,opacity] duration-150 ${isActive ? '' : 'opacity-50 grayscale'}`}
              />
              <span
                aria-hidden="true"
                data-led={isActive ? 'on' : 'off'}
                className={`absolute top-[3px] right-[3px] w-[3px] h-[3px] rounded-full ${isActive ? LED_ON[m.id] : 'bg-zinc-700'}`}
              />
            </div>
            {/* Name */}
            <span className="text-[7px] font-bold font-mono uppercase tracking-wide leading-none text-center whitespace-nowrap">
              {m.label}
            </span>
            {/* Tagline */}
            <span className="text-[5.5px] leading-none text-center opacity-50 whitespace-nowrap">
              {m.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
});

OscillatorModuleSelector.displayName = 'OscillatorModuleSelector';
