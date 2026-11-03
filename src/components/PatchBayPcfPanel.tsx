// PatchBayPcfPanel — live controls for a selected PCF node.
//
// Shown under the patch bay canvas when the selected node is the master PCF or
// a PCF the user placed. Every control edits the running PCF directly
// (`PatchController.setPcf`): knobs, filter type, pattern steps, the filter
// mode (pattern PCF vs openrb / ReBirth low-pass) and, on placed PCFs, whether
// the node also plays the song's master PCF lanes.

import React, { memo, useCallback } from 'react';

import {
    LOWPASS_FILTER_MODES,
    LOWPASS_MODE_LABELS,
    PCF_FILTER_TYPES,
    pcfKnobToHz,
    type LowpassModeStatus,
    type PcfKnobs,
    type PcfNodeEdit,
    type PcfNodeState,
} from '../audio/graph';

const KNOBS: readonly { key: 'cutoff' | 'resonance' | 'envAmount' | 'decay'; label: string }[] = [
    { key: 'cutoff', label: 'Cutoff' },
    { key: 'resonance', label: 'Reso' },
    { key: 'envAmount', label: 'Env' },
    { key: 'decay', label: 'Decay' },
];

const TYPE_LABELS: Readonly<Record<PcfKnobs['filterType'], string>> = { lp: 'LP', bp: 'BP', hp: 'HP' };

/** Keyboard step for a pattern bar (ArrowUp / ArrowDown). */
const STEP_NUDGE = 8;

function formatHz(hz: number): string {
    return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`;
}

/** The status line under the mode buttons: what the node plays, and why. */
export function pcfModeStatusText(mode: LowpassModeStatus): string {
    if (mode.mode === 'openrb' && mode.held) return `plays pattern PCF · ${mode.held}`;
    if (mode.mode === 'openrb' && mode.active !== 'openrb') {
        return `plays pattern PCF · ${mode.reason ?? 'openrb unavailable'} · patch keeps openrb`;
    }
    if (mode.active === 'openrb') {
        const exact = mode.bitExact === false ? ' · not bit-exact (context not at 44.1 kHz)' : '';
        return `openrb · static ReBirth low-pass at the knobs; pattern and lanes play in Standard mode${exact}`;
    }
    return 'pattern PCF (RBJ biquad, envelope from the pattern)';
}

const buttonClass = (active: boolean) =>
    `rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
        active
            ? 'border-amber-400/70 bg-amber-900/40 text-amber-100'
            : 'border-amber-500/30 text-gray-300 hover:bg-amber-900/20'
    }`;

interface PatchBayPcfPanelProps {
    state: PcfNodeState;
    label: string;
    onEdit: (edit: PcfNodeEdit) => void;
    /** The master PCF's pattern, offered to placed PCFs as "copy". */
    masterPattern?: readonly number[] | null;
}

export const PatchBayPcfPanel: React.FC<PatchBayPcfPanelProps> = memo(({ state, label, onEdit, masterPattern }) => {
    const { knobs, pattern, mode } = state;
    // The master's knobs and pattern only exist on a running PCF.
    const songControlsDisabled = state.master && !state.live;

    const setStep = useCallback(
        (index: number, value: number) => {
            const next = [...pattern];
            next[index] = Math.max(0, Math.min(127, Math.round(value)));
            onEdit({ pattern: next });
        },
        [pattern, onEdit],
    );

    return (
        <div
            className="flex flex-col gap-1.5 rounded border border-amber-500/30 bg-amber-950/10 p-2"
            role="group"
            aria-label={`PCF controls: ${label}`}
            data-testid="pcf-panel"
        >
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase text-amber-200">
                    {state.master ? 'Master PCF' : `PCF · ${label}`}
                </span>
                <button
                    type="button"
                    aria-pressed={knobs.enabled}
                    disabled={songControlsDisabled}
                    onClick={() => onEdit({ enabled: !knobs.enabled })}
                    className={buttonClass(knobs.enabled)}
                >
                    {knobs.enabled ? 'On' : 'Off'}
                </button>
                {PCF_FILTER_TYPES.map((type) => (
                    <button
                        key={type}
                        type="button"
                        aria-pressed={knobs.filterType === type}
                        aria-label={`Filter type ${TYPE_LABELS[type]}`}
                        disabled={songControlsDisabled}
                        onClick={() => onEdit({ filterType: type })}
                        className={buttonClass(knobs.filterType === type)}
                    >
                        {TYPE_LABELS[type]}
                    </button>
                ))}
                {state.master && !knobs.enabled && (
                    <span className="font-mono text-[9px] text-gray-500">
                        transparent unless a master PCF cutoff lane plays
                    </span>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                {KNOBS.map(({ key, label: knobLabel }) => (
                    <label key={key} className="flex items-center gap-1 font-mono text-[9px] uppercase text-gray-400">
                        {knobLabel}
                        <input
                            type="range"
                            min={0}
                            max={127}
                            step={1}
                            value={knobs[key]}
                            disabled={songControlsDisabled}
                            onChange={(event) => onEdit({ [key]: Number(event.target.value) })}
                            aria-label={`Live PCF ${knobLabel}`}
                            className="w-20"
                        />
                        <span className="w-9 text-right text-gray-200">
                            {key === 'cutoff' ? formatHz(pcfKnobToHz(knobs.cutoff)) : Math.round(knobs[key])}
                        </span>
                    </label>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="PCF filter mode">
                <span className="font-mono text-[9px] uppercase text-gray-400">Mode</span>
                {LOWPASS_FILTER_MODES.map((candidate) => (
                    <button
                        key={candidate}
                        type="button"
                        aria-pressed={mode.mode === candidate}
                        onClick={() => onEdit({ filterMode: candidate })}
                        className={buttonClass(mode.mode === candidate)}
                    >
                        {LOWPASS_MODE_LABELS[candidate]}
                    </button>
                ))}
                <span className="font-mono text-[9px] text-gray-500" data-testid="pcf-mode-status">
                    {pcfModeStatusText(mode)}
                </span>
            </div>

            <div className="flex flex-wrap items-end gap-2">
                <span className="font-mono text-[9px] uppercase text-gray-400">Pattern</span>
                <div className="flex h-8 items-end gap-px" role="group" aria-label="PCF pattern steps">
                    {pattern.map((value, index) => (
                        <button
                            key={index}
                            type="button"
                            disabled={songControlsDisabled}
                            aria-label={`Step ${index + 1}: ${Math.round(value)}`}
                            onMouseDown={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                const fromTop = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
                                setStep(index, (1 - fromTop) * 127);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'ArrowUp') setStep(index, value + STEP_NUDGE);
                                else if (event.key === 'ArrowDown') setStep(index, value - STEP_NUDGE);
                                else return;
                                event.preventDefault();
                            }}
                            className="relative h-8 w-2 bg-black/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
                        >
                            <span
                                className={`absolute bottom-0 left-0 w-full ${index % 4 === 0 ? 'bg-amber-300' : 'bg-amber-500/80'}`}
                                style={{ height: `${(value / 127) * 100}%` }}
                            />
                        </button>
                    ))}
                </div>
                {!state.master && (
                    <>
                        <button
                            type="button"
                            disabled={!masterPattern || masterPattern.length === 0}
                            onClick={() => masterPattern && onEdit({ pattern: [...masterPattern] })}
                            className={buttonClass(false)}
                        >
                            Copy master pattern
                        </button>
                        <label className="flex items-center gap-1 font-mono text-[9px] uppercase text-gray-400">
                            <input
                                type="checkbox"
                                checked={state.followMasterLanes}
                                onChange={(event) => onEdit({ followMasterLanes: event.target.checked })}
                                aria-label="Follow master PCF lanes"
                            />
                            Master lanes
                        </label>
                    </>
                )}
            </div>

            {!state.live && state.reason && (
                <p className="font-mono text-[9px] uppercase tracking-wide text-amber-400">{state.reason}</p>
            )}
        </div>
    );
});

PatchBayPcfPanel.displayName = 'PatchBayPcfPanel';
