// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
// Character-driven oscillator module selector.
// Replaces the flat WaveformSelector in SynthPart with 5 personality-driven cards,
// each with a distinct SVG waveform icon and colour theme.
// Clicking a card sets the representative waveform for that character.
// The active card is derived from the current waveform via waveformToModuleId().

import React, { memo } from 'react';
import type { Waveform } from '../types';

// ── SVG icons ───────────────────────────────────────────────────────────────
// Each draws a stylised oscilloscope trace in the parent's currentColor.
// ViewBox is 40 × 22; strokeWidth 1.8 for visual weight at small sizes.

const SawIcon = memo(() => (
  <svg viewBox="0 0 40 22" fill="none" className="w-full h-full" aria-hidden="true">
    <path d="M2 19 L16 3 L16 19 L30 3 L30 19 L38 9"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
));

const SquareIcon = memo(() => (
  <svg viewBox="0 0 40 22" fill="none" className="w-full h-full" aria-hidden="true">
    <path d="M2 18 L2 5 L14 5 L14 18 L26 18 L26 5 L38 5 L38 14"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
));

const SineIcon = memo(() => (
  <svg viewBox="0 0 40 22" fill="none" className="w-full h-full" aria-hidden="true">
    <path d="M2 11 C8 1 14 1 20 11 C26 21 32 21 38 11"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
));

// Buzzy, high-harmonic trace for the aggressive character
const AggressiveIcon = memo(() => (
  <svg viewBox="0 0 40 22" fill="none" className="w-full h-full" aria-hidden="true">
    <path d="M2 11 L5 3 L7 18 L10 4 L12 18 L15 6 L17 16 L20 4 L22 18 L25 7 L27 16 L30 4 L32 18 L35 7 L38 13"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
));

// Three overlapping sines at decreasing amplitude → rich, layered texture
const TexturalIcon = memo(() => (
  <svg viewBox="0 0 40 22" fill="none" className="w-full h-full" aria-hidden="true">
    <path d="M2 11 C8 1 14 1 20 11 C26 21 32 21 38 11"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.9" />
    <path d="M2 11 C5 5 8 5 11 11 C14 17 17 17 20 11 C23 5 26 5 29 11 C32 17 35 17 38 11"
      stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.5" />
    <path
      d="M2 11 C3 8 4 8 5 11 C6 14 7 14 8 11 C9 8 10 8 11 11 C12 14 13 14 14 11
         C15 8 16 8 17 11 C18 14 19 14 20 11 C21 8 22 8 23 11 C24 14 25 14 26 11
         C27 8 28 8 29 11 C30 14 31 14 32 11 C33 8 34 8 35 11 C36 14 37 14 38 11"
      stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeOpacity="0.28" />
  </svg>
));

// ── Module definitions ───────────────────────────────────────────────────────

interface OscModule {
  id: string;
  label: string;
  sub: string;
  /** Default waveform that pressing this card sets. */
  waveform: Waveform;
  Icon: React.FC;
}

const MODULES: OscModule[] = [
  { id: 'analog-saw',     label: 'Analog Saw',  sub: 'fat · warm',    waveform: 'sawtooth',     Icon: SawIcon       },
  { id: 'digital-sqr',   label: 'Digital Sqr',  sub: 'crisp · cold',  waveform: 'square',       Icon: SquareIcon    },
  { id: 'sine-sub',      label: 'Sine / Sub',   sub: 'pure · deep',   waveform: 'sine',         Icon: SineIcon      },
  { id: 'aggressive',    label: 'Aggressive',   sub: 'raw · gritty',  waveform: 'prophecy-saw', Icon: AggressiveIcon },
  { id: 'textural',      label: 'Textural',     sub: 'airy · layered',waveform: 'wgsl-saw',     Icon: TexturalIcon  },
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

const FOCUS_RING: Record<string, string> = {
  'analog-saw':   'focus:ring-amber-500/60',
  'digital-sqr':  'focus:ring-sky-500/60',
  'sine-sub':     'focus:ring-violet-500/60',
  'aggressive':   'focus:ring-rose-500/60',
  'textural':     'focus:ring-teal-500/60',
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
  if (s.startsWith('prophecy-') || s.startsWith('rust-')) {
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
        const Icon = m.Icon;
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
              'focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-offset-zinc-900',
              FOCUS_RING[m.id],
              isActive
                ? ACTIVE_CARD[m.id]
                : `border-zinc-700/50 bg-zinc-900/50 text-zinc-500 ${HOVER_CARD[m.id]}`,
            ].join(' ')}
          >
            {/* Waveform trace */}
            <div className="w-9 h-[18px]">
              <Icon />
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
