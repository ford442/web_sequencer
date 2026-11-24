import React, { memo } from 'react';
import type { FilterSource, FilterType, OscillatorType, SynthParams } from '../types';
import {
  FILTER_SOURCES,
  FILTER_SOURCE_DESCRIPTIONS,
  FILTER_SOURCE_LABELS,
  FILTER_TYPES,
  FILTER_TYPE_LABELS,
  filterSourceIssueId,
  resolveFilterSource,
  resolveFilterType,
} from '../engines/backends/filterSource';
import { useEngineDegradation } from '../stores/engineDegradationStore';

/**
 * Oscillator families whose notes run through `Voice`'s filter stage — the ones a
 * filter type / source applies to. The 303, Prophecy and Macro engines own their
 * filters inside their own worklets and ignore both.
 */
export const VOICE_FILTER_OSC_TYPES: ReadonlySet<OscillatorType> = new Set<OscillatorType>([
  'javascript', 'pcm', 'pyodide', 'webgpu', 'wam', 'rust', 'cpp', 'dwgs',
]);

interface FilterSourceSelectorProps {
  /** The synth's oscillator family; the selector renders nothing for families with their own filter. */
  type: OscillatorType;
  filterType?: FilterType;
  filterSource?: FilterSource;
  onChange: (patch: Partial<Pick<SynthParams, 'filterType' | 'filterSource'>>) => void;
  accentColor?: 'pink' | 'cyan';
}

const SHORT_TYPE: Record<FilterType, string> = { lp: 'LP', bp: 'BP', hp: 'HP' };

/**
 * Filter response (LP / BP / HP) and filter source (native biquad, the
 * "WASM OSC" AssemblyScript filter, or the "Rust" filter) for one synth. The
 * wasm filters work with every oscillator family above — each is a stage after
 * the oscillator, not a property of the `wam-*` / `rust-*` one — and when one
 * cannot run the voice uses the native filter and the notice below says so
 * (#1663, #1672).
 */
export const FilterSourceSelector: React.FC<FilterSourceSelectorProps> = memo(({
  type,
  filterType,
  filterSource,
  onChange,
  accentColor = 'pink',
}) => {
  const degradation = useEngineDegradation();
  if (!VOICE_FILTER_OSC_TYPES.has(type)) return null;

  const activeType = resolveFilterType(filterType);
  const activeSource = resolveFilterSource(filterSource);
  const fallback = activeSource !== 'native'
    ? degradation.find((issue) => issue.id === filterSourceIssueId(activeSource) && issue.status === 'active')
    : undefined;

  const cyan = accentColor === 'cyan';
  const active = cyan
    ? 'bg-gradient-to-b from-cyan-500 to-cyan-600 text-white border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]'
    : 'bg-gradient-to-b from-pink-500 to-pink-600 text-white border-pink-400 shadow-[0_0_8px_rgba(236,72,153,0.4)]';
  const inactive = 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200';
  const ring = `focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115] ${cyan ? 'focus-visible:ring-cyan-500' : 'focus-visible:ring-pink-500'}`;
  const label = `text-[7px] font-mono uppercase tracking-widest w-8 shrink-0 ${cyan ? 'text-cyan-400/60' : 'text-pink-400/60'}`;

  return (
    <div
      className={`flex flex-col gap-1 p-1.5 rounded-md bg-zinc-950/60 border ${cyan ? 'border-cyan-500/10' : 'border-pink-500/10'}`}
      role="group"
      aria-label="Filter type and source"
    >
      <div className="flex items-center gap-1" role="group" aria-label="Filter type">
        <span className={label} aria-hidden="true">Filter</span>
        <div className="flex flex-1 gap-1">
          {FILTER_TYPES.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => onChange({ filterType: t })}
              aria-pressed={activeType === t}
              title={FILTER_TYPE_LABELS[t]}
              aria-label={`${FILTER_TYPE_LABELS[t]} filter`}
              className={`flex-1 px-1.5 py-0.5 text-[8px] font-bold rounded transition-all border ${ring} ${activeType === t ? active : inactive}`}
            >
              {SHORT_TYPE[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="Filter source">
        <span className={label} aria-hidden="true">Source</span>
        <div className="flex flex-1 gap-1">
          {FILTER_SOURCES.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => onChange({ filterSource: s })}
              aria-pressed={activeSource === s}
              title={FILTER_SOURCE_DESCRIPTIONS[s]}
              aria-label={`${FILTER_SOURCE_LABELS[s]} filter source`}
              className={`flex-1 px-1.5 py-0.5 text-[8px] font-bold rounded transition-all border ${ring} ${activeSource === s ? active : inactive}`}
            >
              {FILTER_SOURCE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      {fallback && (
        <p role="status" className="text-[7px] leading-tight text-amber-400" title={fallback.reason}>
          {FILTER_SOURCE_LABELS[activeSource]} filter unavailable — using the native filter. {fallback.reason}
        </p>
      )}
    </div>
  );
});

FilterSourceSelector.displayName = 'FilterSourceSelector';
