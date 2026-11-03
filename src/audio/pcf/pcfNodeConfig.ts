/**
 * PCF node settings: defaults, sanitizing and the knob curves. Pure — no Web
 * Audio — so `graphOps` and the palette can use it. The live stage is
 * `pcfInsert.ts`.
 */

import type { PcfParams } from '../../engines/PcfEffect';
import { normalizeLowpassMode, type LowpassFilterMode, type LowpassModeStatus } from '../graph/lowpassMode';
import type { GraphNodeId, PcfNodeConfig } from '../graph/types';

/** Steps a placed PCF's pattern starts with: an audible 16th-note pump. */
export const PCF_DEFAULT_PATTERN: readonly number[] = [
    127, 0, 0, 0, 96, 0, 0, 0, 127, 0, 0, 0, 96, 0, 64, 0,
];

export const PCF_MAX_PATTERN_STEPS = 32;

/** Settings of a freshly placed PCF node. */
export const PCF_NODE_DEFAULTS: Readonly<Required<PcfNodeConfig>> = {
    enabled: true,
    filterType: 'lp',
    cutoff: 50,
    resonance: 60,
    envAmount: 70,
    decay: 40,
    pattern: [...PCF_DEFAULT_PATTERN],
    followMasterLanes: false,
    filterMode: 'rbj',
};

export const PCF_FILTER_TYPES: readonly NonNullable<PcfNodeConfig['filterType']>[] = ['lp', 'bp', 'hp'];

export const PCF_OPENRB_LOWPASS_ONLY = 'openrb is a low-pass: BP / HP play the pattern PCF';
export const PCF_OPENRB_BYPASSED = 'PCF is off';

/** The knobs a PCF node exposes, as `PcfEffect.setParams` takes them. */
export type PcfKnobs = PcfParams;

/** One edit to a PCF node: any subset of its settings. */
export type PcfNodeEdit = Partial<PcfKnobs> & {
    pattern?: readonly number[];
    followMasterLanes?: boolean;
    filterMode?: LowpassFilterMode;
};

function clampMidi(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(127, value)) : fallback;
}

/** A stored pattern, sanitized (0–127 per step, 1–32 steps); `null` when unusable. */
export function normalizePcfPattern(pattern: unknown): number[] | null {
    if (!Array.isArray(pattern) || pattern.length === 0) return null;
    return pattern.slice(0, PCF_MAX_PATTERN_STEPS).map((step) => clampMidi(step, 0));
}

/**
 * A stored (untrusted) `PcfNodeConfig`, with every field present and in range.
 * Missing or bad fields take {@link PCF_NODE_DEFAULTS}.
 */
export function normalizePcfNodeConfig(config: unknown): Required<PcfNodeConfig> {
    const raw = (typeof config === 'object' && config !== null ? config : {}) as Record<string, unknown>;
    const d = PCF_NODE_DEFAULTS;
    return {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
        filterType: raw.filterType === 'bp' || raw.filterType === 'hp' || raw.filterType === 'lp' ? raw.filterType : d.filterType,
        cutoff: clampMidi(raw.cutoff, d.cutoff),
        resonance: clampMidi(raw.resonance, d.resonance),
        envAmount: clampMidi(raw.envAmount, d.envAmount),
        decay: clampMidi(raw.decay, d.decay),
        pattern: normalizePcfPattern(raw.pattern) ?? [...d.pattern],
        followMasterLanes: raw.followMasterLanes === true,
        filterMode: normalizeLowpassMode(raw.filterMode),
    };
}

/** `config` with `edit` applied, every value in range. */
export function applyPcfNodeEdit(config: unknown, edit: PcfNodeEdit): Required<PcfNodeConfig> {
    const current = normalizePcfNodeConfig(config);
    return normalizePcfNodeConfig({
        ...current,
        ...edit,
        ...(edit.pattern !== undefined ? { pattern: normalizePcfPattern(edit.pattern) ?? current.pattern } : {}),
    });
}

/** The PCF worklet's cutoff curve: knob 0..127 → 20 Hz..20 kHz. */
export function pcfKnobToHz(cutoff: number): number {
    // Same curve as `pcfMidiNormToHz` (laneResolver) and the worklet's midiToHz.
    return 20 * Math.pow(1000, clampMidi(cutoff, 0) / 127);
}

/** The PCF worklet's resonance curve: knob 0..127 → Q 0.5..30. */
export function pcfKnobToQ(resonance: number): number {
    return 0.5 + (clampMidi(resonance, 0) / 127) * 29.5;
}

/** What the patch bay shows for a PCF node. */
export interface PcfNodeState {
    nodeId: GraphNodeId;
    master: boolean;
    /** Whether a PCF is running for the node (else the values are the saved ones). */
    live: boolean;
    knobs: PcfKnobs;
    pattern: number[];
    followMasterLanes: boolean;
    mode: LowpassModeStatus;
    /** Why the node is not running, when it is not. */
    reason?: string;
}
