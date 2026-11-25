/**
 * What each filter source can do — the data behind the shared `FilterControls`
 * (docs/audio-engine/filter-ui.md).
 *
 * Contract: every source supports type + cutoff + resonance. Poles are optional
 * and describe the topology the source actually runs today. Unsupported options
 * are disabled in the UI (never hidden) and a substitution is logged.
 */

import type { FilterSource, FilterType } from '../../types/synth';
import { FILTER_TYPES, DEFAULT_FILTER_TYPE } from './filterSource';

export type FilterPoles = 2 | 4;

export interface FilterCapabilities {
    /** Response types the source can run. */
    types: readonly FilterType[];
    /** Pole counts the source can run; a single entry means a fixed topology. */
    poles: readonly FilterPoles[];
    /** Table-baked sources (GPU, Python) regenerate their table when type changes. */
    regeneratesOnChange: boolean;
    /** How the resonance knob is read, so the control can label it. */
    resonanceScale: 'biquad-q' | 'ladder-feedback';
}

const ALL = FILTER_TYPES;

export const FILTER_CAPABILITIES: Record<FilterSource, FilterCapabilities> = {
    native: { types: ALL, poles: [2], regeneratesOnChange: false, resonanceScale: 'biquad-q' },
    wam: { types: ALL, poles: [2], regeneratesOnChange: false, resonanceScale: 'biquad-q' },
    rust: { types: ALL, poles: [2], regeneratesOnChange: false, resonanceScale: 'biquad-q' },
    cpp: { types: ALL, poles: [2], regeneratesOnChange: false, resonanceScale: 'biquad-q' },
    dwgs: { types: ALL, poles: [4], regeneratesOnChange: false, resonanceScale: 'ladder-feedback' },
    webgpu: { types: ALL, poles: [2], regeneratesOnChange: true, resonanceScale: 'biquad-q' },
    pyodide: { types: ALL, poles: [2], regeneratesOnChange: true, resonanceScale: 'biquad-q' },
};

export const FILTER_POLE_OPTIONS: readonly FilterPoles[] = [2, 4] as const;

export interface FilterSubstitution {
    field: 'type' | 'poles';
    requested: string | number;
    applied: string | number;
    reason: string;
}

export interface SnappedFilter {
    type: FilterType;
    poles: FilterPoles;
    substitutions: FilterSubstitution[];
}

/** Nearest supported pole count (ties go to the lower count). */
function nearestPoles(wanted: FilterPoles, supported: readonly FilterPoles[]): FilterPoles {
    return [...supported].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b)[0];
}

/**
 * Snap a requested type / poles to what `source` supports. Pure: the caller
 * decides whether to log (`logFilterSubstitutions`) and what to persist.
 * `poles` defaults to the source's own topology when not requested.
 */
export function snapFilterToSource(
    source: FilterSource,
    requested: { type?: FilterType; poles?: FilterPoles },
): SnappedFilter {
    const caps = FILTER_CAPABILITIES[source];
    const substitutions: FilterSubstitution[] = [];

    let type = requested.type ?? DEFAULT_FILTER_TYPE;
    if (!caps.types.includes(type)) {
        const applied = caps.types.includes(DEFAULT_FILTER_TYPE) ? DEFAULT_FILTER_TYPE : caps.types[0];
        substitutions.push({ field: 'type', requested: type, applied, reason: `${source} filter has no ${type} mode` });
        type = applied;
    }

    let poles: FilterPoles = caps.poles[0];
    if (requested.poles !== undefined) {
        poles = nearestPoles(requested.poles, caps.poles);
        if (poles !== requested.poles) {
            substitutions.push({
                field: 'poles',
                requested: requested.poles,
                applied: poles,
                reason: `${source} filter is ${caps.poles.join('/')}-pole only`,
            });
        }
    }
    return { type, poles, substitutions };
}

/** Log every substitution (never silent: the sound differs from what was asked). */
export function logFilterSubstitutions(source: FilterSource, substitutions: readonly FilterSubstitution[]): void {
    for (const s of substitutions) {
        console.warn(`[FilterControls] ${s.field} ${s.requested} -> ${s.applied} on "${source}" (${s.reason})`);
    }
}
