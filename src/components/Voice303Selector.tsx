import React, { memo } from 'react';
import type { TB303ModelId } from '../types';
import {
    getAvailableTB303Models,
    isOfflineOnlyTB303Model,
    resolveHighFidModelSelection,
    tb303ModelFamily,
} from '../engines/TB303Models';
import { getBrowserCapabilities } from '../utils/engineTelemetry';
import { HelpIconButton, HelpTip } from './help/HelpTip';

interface Voice303SelectorProps {
    /** Currently active 303 voice/model for this track. */
    model: TB303ModelId;
    /** Called when the user selects a different voice. */
    onChange: (model: TB303ModelId) => void;
    /** Accent colour matching the rack module (default: 'pink'). */
    accentColor?: 'pink' | 'cyan';
    /**
     * Include offline-only high-fid voices (default true — Phase-4).
     * Pass false for realtime-only surfaces.
     */
    includeOfflineOnly?: boolean;
    /** Override WebGPU probe (tests). Defaults to getBrowserCapabilities().webgpu. */
    gpuAvailable?: boolean;
}

/**
 * "303 Voice" selector for TB-303 tracks (SYNTH A, SYNTH B and BASS 2).
 *
 * Successor of the two-way Engine303Selector: the list is populated
 * dynamically from the TB303_MODELS registry (src/engines/TB303Models.ts),
 * so new voices added to the C++ registry + TS mirror appear here without
 * touching this component. Each track picks its voice independently.
 *
 * Offline high-fid voices (highfid-cpu / gpu-highfid) are listed with an
 * OFFLINE badge; selecting GPU without WebGPU reports a CPU fallback via
 * resolveHighFidModelSelection while still persisting the requested id.
 */
export const Voice303Selector: React.FC<Voice303SelectorProps> = memo(({
    model,
    onChange,
    accentColor = 'pink',
    includeOfflineOnly = true,
    gpuAvailable: gpuAvailableProp,
}) => {
    const models = getAvailableTB303Models({ includeOfflineOnly });
    const activeFamily = tb303ModelFamily(model);
    const gpuAvailable = gpuAvailableProp ?? getBrowserCapabilities().webgpu;

    const selectionHint = isOfflineOnlyTB303Model(model)
        ? resolveHighFidModelSelection(model, undefined, {
            gpuAvailable,
            report: false,
          })
        : null;

    // Themed by engine family (open303 = emerald, jc303 = teal, highfid = amber).
    const openActive = 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]';
    const jcActive = 'bg-gradient-to-b from-teal-500 to-teal-600 text-white border-teal-400 shadow-[0_0_12px_rgba(20,184,166,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]';
    const highfidActive = 'bg-gradient-to-b from-amber-500 to-amber-700 text-white border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.45),inset_0_1px_0_rgba(255,255,255,0.2)]';
    const inactiveStyle = 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]';

    const badgeColorStyle = accentColor === 'cyan'
        ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60'
        : 'bg-pink-950/90 text-pink-300 border-pink-500/60';

    const labelColorStyle = accentColor === 'cyan'
        ? 'text-cyan-400/70'
        : 'text-pink-400/70';

    const borderColorStyle = accentColor === 'cyan'
        ? 'border-cyan-500/20'
        : 'border-pink-500/20';

    const familyBadgeLabel =
        activeFamily === 'jc303' ? 'JC303' : activeFamily === 'highfid' ? 'HIFID' : 'OPEN303';
    const familyBadgeAria =
        activeFamily === 'jc303'
            ? 'JC303 engine family active'
            : activeFamily === 'highfid'
              ? 'High-fidelity offline engine family active'
              : 'Open303 engine family active';
    const familyBadgeTitle =
        activeFamily === 'jc303'
            ? 'Active engine family: authentic rosic::Open303 (jc303)'
            : activeFamily === 'highfid'
              ? 'Active engine family: offline high-fidelity (freeze / export / multisample)'
              : 'Active engine family: custom Open303';

    const handleSelect = (id: TB303ModelId) => {
        if (isOfflineOnlyTB303Model(id)) {
            resolveHighFidModelSelection(id, undefined, {
                gpuAvailable,
                report: true,
                subsystem: 'voice303-selector',
            });
        }
        onChange(id);
    };

    return (
        <HelpTip topicId="engine-303-switch" showOnFirstUse position="right" className="w-full">
        <div
            className={`flex flex-col gap-1 p-2 rounded-lg bg-zinc-950/80 border ${borderColorStyle} w-full`}
            role="group"
            aria-label="303 voice selection"
        >
            {/* Row: "303 Voice" label + active-family badge */}
            <div className="flex items-center justify-between gap-1">
                <span className={`text-[8px] font-mono uppercase tracking-wider ${labelColorStyle}`}>
                    303 Voice
                </span>
                <div className="flex items-center gap-1">
                    <span
                        className={`text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${badgeColorStyle}`}
                        title={familyBadgeTitle}
                        aria-label={familyBadgeAria}
                    >
                        {familyBadgeLabel}
                    </span>
                    {!gpuAvailable && includeOfflineOnly && (
                        <span
                            className="text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border bg-zinc-900 text-amber-300 border-amber-500/50"
                            title="WebGPU unavailable — GPU High-Fidelity falls back to High-Fidelity CPU for offline render"
                            aria-label="WebGPU unavailable; GPU high-fidelity will fall back to CPU"
                        >
                            No GPU
                        </span>
                    )}
                    <HelpIconButton topicId="engine-303-switch" />
                </div>
            </div>

            {models.map((m) => {
                const isActive = m.id === model;
                const activeClass =
                    m.family === 'jc303'
                        ? jcActive
                        : m.family === 'highfid'
                          ? highfidActive
                          : openActive;
                const tooltip = m.offlineOnly
                    ? `${m.description} (offline only – best for freeze / export / multisample)`
                    : m.description;
                return (
                    <button
                        type="button"
                        key={m.id}
                        onClick={() => handleSelect(m.id)}
                        title={tooltip}
                        aria-pressed={isActive}
                        aria-label={`Select ${m.label} voice`}
                        className={`px-3 py-1.5 text-[9px] font-bold rounded-md transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 flex items-center justify-between gap-2 ${
                            isActive ? activeClass : inactiveStyle
                        }`}
                    >
                        <span className="text-left leading-tight">{m.label}</span>
                        {m.offlineOnly && (
                            <span
                                className={`shrink-0 text-[7px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border ${
                                    isActive
                                        ? 'bg-black/25 border-white/30 text-white'
                                        : 'bg-amber-950/80 border-amber-600/50 text-amber-300'
                                }`}
                            >
                                Offline
                            </span>
                        )}
                    </button>
                );
            })}

            {selectionHint?.fallbackReason && (
                <p
                    className="text-[8px] text-amber-300/90 font-mono leading-snug mt-0.5"
                    role="status"
                    aria-live="polite"
                >
                    {selectionHint.fallbackReason}
                </p>
            )}
            {selectionHint && !selectionHint.fallbackReason && isOfflineOnlyTB303Model(model) && (
                <p
                    className="text-[8px] text-zinc-500 font-mono leading-snug mt-0.5"
                    role="status"
                >
                    Offline engine: {selectionHint.offlineEngine} · live uses Stock Open303
                </p>
            )}
        </div>
        </HelpTip>
    );
});
