import React, { memo } from 'react';
import type { TB303ModelId } from '../types';
import { getAvailableTB303Models, tb303ModelFamily } from '../engines/TB303Models';
import { HelpIconButton, HelpTip } from './help/HelpTip';

interface Voice303SelectorProps {
    /** Currently active 303 voice/model for this track. */
    model: TB303ModelId;
    /** Called when the user selects a different voice. */
    onChange: (model: TB303ModelId) => void;
    /** Accent colour matching the rack module (default: 'pink'). */
    accentColor?: 'pink' | 'cyan';
}

/**
 * "303 Voice" selector for TB-303 tracks (SYNTH A, SYNTH B and BASS 2).
 *
 * Successor of the two-way Engine303Selector: the list is populated
 * dynamically from the TB303_MODELS registry (src/engines/TB303Models.ts),
 * so new voices added to the C++ registry + TS mirror appear here without
 * touching this component. Each track picks its voice independently.
 */
export const Voice303Selector: React.FC<Voice303SelectorProps> = memo(({
    model,
    onChange,
    accentColor = 'pink',
}) => {
    const models = getAvailableTB303Models();
    const activeFamily = tb303ModelFamily(model);

    // Themed by engine family (open303 = emerald, jc303 = teal), matching the
    // established osc-type visual treatment. Part accent (cyan/pink) is used
    // for the header label/badge.
    const openActive = 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]';
    const jcActive = 'bg-gradient-to-b from-teal-500 to-teal-600 text-white border-teal-400 shadow-[0_0_12px_rgba(20,184,166,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]';
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
                        title={`Active engine family: ${activeFamily === 'jc303' ? 'authentic rosic::Open303 (jc303)' : 'custom Open303'}`}
                        aria-label={`${activeFamily === 'jc303' ? 'JC303' : 'Open303'} engine family active`}
                    >
                        {activeFamily === 'jc303' ? 'JC303' : 'OPEN303'}
                    </span>
                    <HelpIconButton topicId="engine-303-switch" />
                </div>
            </div>

            {models.map((m) => {
                const isActive = m.id === model;
                return (
                    <button
                        type="button"
                        key={m.id}
                        onClick={() => onChange(m.id)}
                        title={m.description}
                        aria-pressed={isActive}
                        aria-label={`Select ${m.label} voice`}
                        className={`px-3 py-1.5 text-[9px] font-bold rounded-md transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 ${
                            isActive
                                ? (m.family === 'jc303' ? jcActive : openActive)
                                : inactiveStyle
                        }`}
                    >
                        {m.label}
                    </button>
                );
            })}
        </div>
        </HelpTip>
    );
});
