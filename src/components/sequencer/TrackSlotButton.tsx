import { memo } from 'react';
import type { TrackKey } from '../../types';
import { getPatternColor } from './constants';

interface TrackSlotButtonProps {
    index: number;
    isActive: boolean;
    hasData: boolean;
    trackKey: TrackKey;
    onSelect: (k: TrackKey, i: number) => void;
}

export const TrackSlotButton = memo(({ index, isActive, hasData, trackKey, onSelect }: TrackSlotButtonProps) => {
    const patternColor = getPatternColor(index);
    const inactiveColor = hasData ? patternColor : '#0f1812';
    return (
        <g transform={`translate(${index * 22}, 0)`} className="track-slot" onClick={() => onSelect(trackKey, index)} cursor="pointer" role="button" tabIndex={0} aria-label={`Pattern Slot ${index + 1}`} aria-pressed={isActive} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(trackKey, index); } }} onContextMenu={(e) => e.preventDefault()}>
            <rect width={18} height={18} rx={2} fill={isActive ? patternColor : inactiveColor} fillOpacity={isActive ? 1 : (hasData ? 0.4 : 1)} stroke={isActive ? '#fff' : patternColor} strokeOpacity={isActive ? 1 : 0.6} strokeWidth={1} />
            <text x={9} y={13} textAnchor="middle" fontSize={10} fill={isActive ? '#000' : patternColor} fontFamily="monospace" fontWeight="bold">{index + 1}</text>
        </g>
    );
});
