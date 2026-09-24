import type { OscillatorType, Waveform, Engine303 } from '../types/synth';

/** Visual theme applied to the oscillator panel / overlay when this type is active. */
export interface OscillatorTheme {
  /** Human label for the type (shown in selector / badge). */
  label: string;
  /** Tailwind color key used for active accents (e.g. 'emerald', 'violet'). */
  accent: string;
  /** Subtle background treatment for the oscillator control container. */
  panelBg: string;
  /** Border / ring treatment for the panel. */
  panelBorder: string;
  /** Text / icon tint. */
  text: string;
  /** Optional short badge text or emoji hint. */
  badge?: string;
}

/** Static theme map for all oscillator types. Keep colors subtle so they compose with cyan/pink part accents. */
export const OSCILLATOR_THEMES: Record<OscillatorType, OscillatorTheme> = {
  javascript: {
    label: 'JavaScript',
    accent: 'sky',
    panelBg: 'bg-sky-950/30',
    panelBorder: 'border-sky-500/30',
    text: 'text-sky-300',
    badge: 'JS',
  },
  pcm: {
    label: 'PCM / WAV',
    accent: 'stone',
    panelBg: 'bg-stone-950/30',
    panelBorder: 'border-stone-500/30',
    text: 'text-stone-300',
    badge: 'WAV',
  },
  open303: {
    label: 'Open303',
    accent: 'emerald',
    panelBg: 'bg-emerald-950/30',
    panelBorder: 'border-emerald-500/30',
    text: 'text-emerald-300',
    badge: '303',
  },
  jc303: {
    label: 'JC303',
    accent: 'teal',
    panelBg: 'bg-teal-950/30',
    panelBorder: 'border-teal-500/30',
    text: 'text-teal-300',
    badge: 'JC',
  },
  prophecy: {
    label: 'Prophecy',
    accent: 'violet',
    panelBg: 'bg-violet-950/30',
    panelBorder: 'border-violet-500/30',
    text: 'text-violet-300',
    badge: 'PRO',
  },
  pyodide: {
    label: 'Pyodide',
    accent: 'yellow',
    panelBg: 'bg-yellow-950/30',
    panelBorder: 'border-yellow-500/30',
    text: 'text-yellow-300',
    badge: 'PY',
  },
  webgpu: {
    label: 'WebGPU',
    accent: 'fuchsia',
    panelBg: 'bg-fuchsia-950/30',
    panelBorder: 'border-fuchsia-500/30',
    text: 'text-fuchsia-300',
    badge: 'GPU',
  },
  wam: {
    label: 'WASM OSC',
    accent: 'amber',
    panelBg: 'bg-amber-950/30',
    panelBorder: 'border-amber-500/30',
    text: 'text-amber-300',
    badge: 'AS',
  },
};

/** Hardware panel artwork in public/osc/ — one WebP per oscillator family. */
export const OSCILLATOR_PANEL_IMAGES: Record<OscillatorType, string> = {
  javascript: '/osc/js.webp',
  pcm: '/osc/pcm.webp',
  open303: '/osc/open303.webp',
  jc303: '/osc/jc303.webp',
  prophecy: '/osc/prophecy.webp',
  pyodide: '/osc/pyodide.webp',
  webgpu: '/osc/webgpu.webp',
  wam: '/osc/wam.webp',
};

/** Derive the OscillatorType from a concrete Waveform + optional engine303 override. */
export function waveformToOscillatorType(waveform: Waveform, engine303?: Engine303): OscillatorType {
  const w = waveform as string;
  if (['sawtooth', 'square', 'triangle', 'sine'].includes(w)) return 'javascript';
  if (w.startsWith('wav-')) return 'pcm';
  if (w.startsWith('303-')) {
    return engine303 === 'jc303' ? 'jc303' : 'open303';
  }
  if (w.startsWith('prophecy-')) return 'prophecy';
  if (w.startsWith('pyodide-')) return 'pyodide';
  if (w.startsWith('wgsl-')) return 'webgpu';
  if (w.startsWith('wam-')) return 'wam';
  return 'javascript';
}

/** Returns Tailwind classes for a subtle themed container around the oscillator controls. */
export function getOscillatorPanelClasses(type: OscillatorType): string {
  const t = OSCILLATOR_THEMES[type];
  return `${t.panelBg} ${t.panelBorder} ${t.text}`;
}

/** Pick a representative default waveform when the user switches OscillatorType. */
export function getDefaultWaveformForType(type: OscillatorType): Waveform {
  switch (type) {
    case 'javascript': return 'sawtooth';
    case 'pcm': return 'wav-saw';
    case 'open303': return '303-saw';
    case 'jc303': return '303-saw';
    case 'prophecy': return 'prophecy-saw';
    case 'pyodide': return 'pyodide-saw';
    case 'webgpu': return 'wgsl-saw';
    case 'wam': return 'wam-saw';
    default: return 'sawtooth';
  }
}

/** Return the concrete Waveform choices available for a given high-level OscillatorType (used by per-type variant picker). */
export function getWaveformsForType(type: OscillatorType): Waveform[] {
  switch (type) {
    case 'javascript': return ['sawtooth', 'square', 'triangle', 'sine'];
    case 'pcm': return ['wav-saw', 'wav-sqr'];
    case 'open303':
    case 'jc303': return ['303-saw', '303-sqr'];
    case 'prophecy': return ['prophecy-saw', 'prophecy-sqr', 'prophecy-tri', 'prophecy-pulse'];
    case 'pyodide': return ['pyodide-saw', 'pyodide-square', 'pyodide-sine'];
    case 'webgpu': return ['wgsl-saw', 'wgsl-sqr', 'wgsl-tri', 'wgsl-sin'];
    case 'wam': return ['wam-saw', 'wam-sqr', 'wam-tri', 'wam-sin'];
    default: return ['sawtooth'];
  }
}
