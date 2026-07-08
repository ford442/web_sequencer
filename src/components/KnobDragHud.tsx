import React from 'react';
import type { KnobDragModifier } from './knobInteraction';
import { getKnobDragHudLabel } from './knobInteraction';

interface KnobDragHudProps {
    modifier: KnobDragModifier | null;
    className?: string;
}

/** Brief on-knob label while Shift (coarse) or Alt (fine) modifies an active drag. */
export const KnobDragHud: React.FC<KnobDragHudProps> = ({ modifier, className = '' }) => {
    const label = modifier ? getKnobDragHudLabel(modifier) : null;
    if (!label) return null;

    const color = modifier === 'coarse' ? '#fbbf24' : '#67e8f9';

    return (
        <span
            className={`absolute left-1/2 -translate-x-1/2 -top-4 text-[8px] font-mono font-bold tracking-widest px-1.5 py-0.5 rounded bg-black/85 pointer-events-none z-50 whitespace-nowrap ${className}`}
            style={{ color, textShadow: `0 0 6px ${color}` }}
            aria-hidden="true"
        >
            {label}
        </span>
    );
};
