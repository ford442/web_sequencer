/**
 * What the patch bay lets a user add (Phase C node palette).
 *
 * Only processing nodes are offered. Engine nodes (`open303Voice`, …) stand for
 * an engine instance that already exists exactly once — a second `bass1` node
 * would have nothing to attach — and WAM2 slots go through the WAM2 host, which
 * owns their plugin lifecycle. Each entry carries a minimal parameter set the
 * editor shows before the node is placed; that is the whole per-factory UI for
 * now.
 */

import { LOWPASS_FILTER_MODES, LOWPASS_MODE_LABELS } from './lowpassMode';
import type { AudioGraphConfig, GraphNodeConfig, GraphNodeFactory, GraphNodeSpec } from './types';

export interface PaletteParam {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
}

/** A string-valued config field picked from a list (e.g. a low-pass filter mode). */
export interface PaletteChoice {
    key: string;
    label: string;
    options: readonly { value: string; label: string }[];
    defaultValue: string;
}

export interface PaletteEntry {
    factory: GraphNodeFactory;
    label: string;
    /** Fixed config fields that are not user-editable here (e.g. filter type). */
    base?: GraphNodeConfig;
    params: readonly PaletteParam[];
    choices?: readonly PaletteChoice[];
}

export const NODE_PALETTE: readonly PaletteEntry[] = [
    {
        factory: 'gain',
        label: 'Gain',
        params: [{ key: 'gain', label: 'Level', min: 0, max: 2, step: 0.01, defaultValue: 1 }],
    },
    {
        factory: 'stereoPanner',
        label: 'Pan',
        params: [{ key: 'pan', label: 'Pan', min: -1, max: 1, step: 0.01, defaultValue: 0 }],
    },
    {
        factory: 'biquadFilter',
        label: 'Low-pass',
        base: { type: 'lowpass' },
        params: [
            { key: 'frequency', label: 'Cutoff', min: 40, max: 18000, step: 1, defaultValue: 2000 },
            { key: 'Q', label: 'Q', min: 0.1, max: 18, step: 0.1, defaultValue: 0.7 },
        ],
        // Standard (RBJ) biquad or ReBirth's PCF low-pass; switchable live
        // afterwards (lowpassMode.ts).
        choices: [
            {
                key: 'filterMode',
                label: 'Mode',
                options: LOWPASS_FILTER_MODES.map((mode) => ({ value: mode, label: LOWPASS_MODE_LABELS[mode] })),
                defaultValue: 'rbj',
            },
        ],
    },
    {
        factory: 'biquadFilter',
        label: 'High-pass',
        base: { type: 'highpass' },
        params: [
            { key: 'frequency', label: 'Cutoff', min: 20, max: 8000, step: 1, defaultValue: 120 },
            { key: 'Q', label: 'Q', min: 0.1, max: 18, step: 0.1, defaultValue: 0.7 },
        ],
    },
    {
        factory: 'waveShaper',
        label: 'Drive',
        params: [{ key: 'drive', label: 'Drive', min: 0, max: 400, step: 1, defaultValue: 50 }],
    },
    {
        factory: 'dynamicsCompressor',
        label: 'Compressor',
        params: [
            { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, defaultValue: -18 },
            { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, defaultValue: 4 },
        ],
    },
    {
        factory: 'delay',
        label: 'Delay',
        base: { maxDelayTime: 2 },
        params: [{ key: 'delayTime', label: 'Time', min: 0.01, max: 2, step: 0.01, defaultValue: 0.25 }],
    },
];

function clamp(value: number, param: PaletteParam): number {
    if (!Number.isFinite(value)) return param.defaultValue;
    return Math.min(param.max, Math.max(param.min, value));
}

/** Default parameter values for a palette entry. */
export function paletteDefaults(entry: PaletteEntry): Record<string, number> {
    return Object.fromEntries(entry.params.map((param) => [param.key, param.defaultValue]));
}

/** Default choice values for a palette entry. */
export function paletteChoiceDefaults(entry: PaletteEntry): Record<string, string> {
    return Object.fromEntries((entry.choices ?? []).map((choice) => [choice.key, choice.defaultValue]));
}

/**
 * Build a user node for the patch: a fresh id that cannot collide with the
 * config (`<factory>-<n>`), its label, and the entry's config with each value
 * clamped to its range. User nodes are never `fixed`, so they can be removed.
 */
export function createPaletteNode(
    config: AudioGraphConfig,
    entry: PaletteEntry,
    values: Readonly<Record<string, number>> = {},
    choiceValues: Readonly<Record<string, string>> = {},
): GraphNodeSpec {
    const taken = new Set(config.nodes.map((node) => node.id));
    let n = 1;
    while (taken.has(`${entry.factory}-${n}`)) n += 1;

    const params: Record<string, number> = {};
    for (const param of entry.params) {
        params[param.key] = clamp(values[param.key] ?? param.defaultValue, param);
    }
    const choices: Record<string, string> = {};
    for (const choice of entry.choices ?? []) {
        const picked = choiceValues[choice.key];
        choices[choice.key] = choice.options.some((option) => option.value === picked)
            ? (picked as string)
            : choice.defaultValue;
    }
    return {
        id: `${entry.factory}-${n}`,
        factory: entry.factory,
        label: `${entry.label} ${n}`,
        config: { ...(entry.base ?? {}), ...params, ...choices } as GraphNodeConfig,
    };
}
