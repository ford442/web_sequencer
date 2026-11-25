import React, { memo, useCallback } from 'react';
import type { FilterSource, FilterType, SynthParams } from '../types';
import {
  FILTER_SOURCES,
  FILTER_SOURCE_LABELS,
  FILTER_TYPES,
  FILTER_TYPE_LABELS,
  FILTER_TYPE_SHORT,
  resolveFilterSource,
  resolveFilterType,
} from '../engines/backends/filterSource';
import {
  FILTER_CAPABILITIES,
  FILTER_POLE_OPTIONS,
  logFilterSubstitutions,
  snapFilterToSource,
  type FilterPoles,
} from '../engines/backends/filterCapabilities';

export type FilterControlsPatch = Partial<Pick<SynthParams, 'filterType' | 'filterSource' | 'filterCutoff' | 'filterResonance'>>;

interface FilterControlsProps {
  filterType?: FilterType;
  filterSource?: FilterSource;
  filterCutoff?: number;
  filterResonance?: number;
  onChange: (patch: FilterControlsPatch) => void;
  accentColor?: 'pink' | 'cyan';
  /** Cutoff range in Hz. */
  cutoffRange?: readonly [number, number];
  /** Resonance range (the synth's Q knob units). */
  resonanceRange?: readonly [number, number];
}

/**
 * Shared hardware-style filter panel (docs/audio-engine/filter-ui.md): cutoff,
 * resonance, mode (LP / BP / HP) and poles (2 / 4).
 *
 * Capabilities come from `FILTER_CAPABILITIES`. Options the selected source
 * cannot run are disabled, not hidden; switching source snaps the mode to the
 * nearest supported one and logs the substitution. Poles are a property of the
 * source's topology today (no engine takes a pole count), so the control shows
 * which one the source runs and only becomes interactive for a source that
 * offers more than one.
 */
export const FilterControls: React.FC<FilterControlsProps> = memo(({
  filterType,
  filterSource,
  filterCutoff,
  filterResonance,
  onChange,
  accentColor = 'pink',
  cutoffRange = [20, 20000],
  resonanceRange = [0, 30],
}) => {
  const source = resolveFilterSource(filterSource);
  const type = resolveFilterType(filterType);
  const caps = FILTER_CAPABILITIES[source];
  const poles: FilterPoles = snapFilterToSource(source, { type }).poles;

  const pickSource = useCallback((next: FilterSource) => {
    const snapped = snapFilterToSource(next, { type });
    logFilterSubstitutions(next, snapped.substitutions);
    onChange(snapped.type !== type ? { filterSource: next, filterType: snapped.type } : { filterSource: next });
  }, [onChange, type]);

  const cyan = accentColor === 'cyan';
  const active = cyan
    ? 'bg-gradient-to-b from-cyan-500 to-cyan-600 text-white border-cyan-400'
    : 'bg-gradient-to-b from-pink-500 to-pink-600 text-white border-pink-400';
  const inactive = 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200';
  const off = 'opacity-40 cursor-not-allowed';
  const label = `text-[7px] font-mono uppercase tracking-widest w-12 shrink-0 ${cyan ? 'text-cyan-400/60' : 'text-pink-400/60'}`;
  const btn = 'flex-1 px-1.5 py-0.5 text-[8px] font-bold rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]';

  return (
    <div
      className={`flex flex-col gap-1 p-1.5 rounded-md bg-zinc-950/60 border ${cyan ? 'border-cyan-500/10' : 'border-pink-500/10'}`}
      role="group"
      aria-label="Filter controls"
    >
      {filterCutoff !== undefined && (
        <label className="flex items-center gap-1">
          <span className={label}>Cutoff</span>
          <input
            type="range"
            className="flex-1"
            aria-label="Filter cutoff"
            min={cutoffRange[0]}
            max={cutoffRange[1]}
            value={filterCutoff}
            onChange={(e) => onChange({ filterCutoff: Number(e.target.value) })}
          />
        </label>
      )}
      {filterResonance !== undefined && (
        <label className="flex items-center gap-1">
          <span className={label}>
            Reso{caps.resonanceScale === 'ladder-feedback' ? ' (fb)' : ' (Q)'}
          </span>
          <input
            type="range"
            className="flex-1"
            aria-label="Filter resonance"
            min={resonanceRange[0]}
            max={resonanceRange[1]}
            step={0.1}
            value={filterResonance}
            onChange={(e) => onChange({ filterResonance: Number(e.target.value) })}
          />
        </label>
      )}
      <div className="flex items-center gap-1" role="group" aria-label="Filter mode">
        <span className={label} aria-hidden="true">Mode</span>
        <div className="flex flex-1 gap-1">
          {FILTER_TYPES.map((t) => {
            const supported = caps.types.includes(t);
            return (
              <button
                type="button"
                key={t}
                disabled={!supported}
                onClick={() => onChange({ filterType: t })}
                aria-pressed={type === t}
                title={supported ? FILTER_TYPE_LABELS[t] : `${FILTER_TYPE_LABELS[t]} is not supported by the ${FILTER_SOURCE_LABELS[source]} filter`}
                aria-label={`${FILTER_TYPE_LABELS[t]} mode`}
                className={`${btn} ${type === t ? active : inactive} ${supported ? '' : off}`}
              >
                {FILTER_TYPE_SHORT[t]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="Filter poles">
        <span className={label} aria-hidden="true">Poles</span>
        <div className="flex flex-1 gap-1">
          {FILTER_POLE_OPTIONS.map((p) => {
            const supported = caps.poles.includes(p);
            // Nothing to choose when the topology is fixed: shown, pressed or disabled.
            const interactive = supported && caps.poles.length > 1;
            return (
              <button
                type="button"
                key={p}
                disabled={!interactive}
                aria-pressed={poles === p}
                title={supported ? `${p}-pole` : `${p}-pole is not supported by the ${FILTER_SOURCE_LABELS[source]} filter`}
                aria-label={`${p} poles`}
                className={`${btn} ${poles === p ? active : inactive} ${supported ? '' : off}`}
              >
                {p}P
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="Filter source">
        <span className={label} aria-hidden="true">Source</span>
        <div className="flex flex-1 flex-wrap gap-1">
          {FILTER_SOURCES.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => pickSource(s)}
              aria-pressed={source === s}
              aria-label={`${FILTER_SOURCE_LABELS[s]} filter source`}
              className={`${btn} ${source === s ? active : inactive}`}
            >
              {FILTER_SOURCE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      {caps.regeneratesOnChange && (
        <p className="text-[7px] leading-tight text-zinc-500" data-testid="filter-regenerates-note">
          Table filter: changing the mode re-renders the table.
        </p>
      )}
    </div>
  );
});

FilterControls.displayName = 'FilterControls';
