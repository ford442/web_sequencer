import { memo } from 'react';
import type { TrackKey } from '../../types';
import { getPatternColor } from './constants';
import { TRACK_PATTERN_SLOT_INDICES } from '../../utils/trackStorageUtils';

interface TrackSlotButtonProps {
    index: number;
    isActive: boolean;
    hasData: boolean;
    trackKey: TrackKey;
    onSelect: (k: TrackKey, i: number) => void;
    /** Grid column (defaults to index for single-row layout). */
    column?: number;
    /** Grid row for multi-row slot strips. */
    row?: number;
    /** Compact 14px cells for 32-slot strips. */
    compact?: boolean;
}

export const TrackSlotButton = memo(({
    index,
    isActive,
    hasData,
    trackKey,
    onSelect,
    column,
    row = 0,
    compact = false,
}: TrackSlotButtonProps) => {
    const patternColor = getPatternColor(index);
    const inactiveColor = hasData ? patternColor : '#0f1812';
    const col = column ?? index;
    const slotW = compact ? 16 : 22;
    const slotH = compact ? 16 : 22;
    const rectW = compact ? 14 : 18;
    const rectH = compact ? 14 : 18;
    const fontSize = compact ? 8 : 10;
    const textY = compact ? 11 : 13;

    return (
        <g
            transform={`translate(${col * slotW}, ${row * slotH})`}
            className="track-slot"
            onClick={() => onSelect(trackKey, index)}
            cursor="pointer"
            role="button"
            tabIndex={0}
            aria-label={`Pattern Slot ${index + 1}`}
            aria-description="Left-click to select pattern. Right-click to copy/paste/clear."
            aria-pressed={isActive}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(trackKey, index);
                }
            }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <rect
                width={rectW}
                height={rectH}
                rx={2}
                fill={isActive ? patternColor : inactiveColor}
                fillOpacity={isActive ? 1 : (hasData ? 0.4 : 1)}
                stroke={isActive ? '#fff' : patternColor}
                strokeOpacity={isActive ? 1 : 0.6}
                strokeWidth={1}
            />
            <text
                x={rectW / 2}
                y={textY}
                textAnchor="middle"
                fontSize={fontSize}
                fill={isActive ? '#000' : patternColor}
                fontFamily="monospace"
                fontWeight="bold"
            >
                {index + 1}
            </text>
        </g>
    );
});

const SLOTS_PER_ROW = 16;

/** Two-row ReBirth-style pattern bank strip (slots 1–32). */
export const TrackSlotStrip = memo(({
    activeSlot,
    trackSlots,
    trackKey,
    onSelect,
}: {
    activeSlot: number;
    trackSlots: (unknown | null)[];
    trackKey: TrackKey;
    onSelect: (k: TrackKey, i: number) => void;
}) => (
    <>
        {TRACK_PATTERN_SLOT_INDICES.map((slot) => (
            <TrackSlotButton
                key={slot}
                index={slot}
                column={slot % SLOTS_PER_ROW}
                row={Math.floor(slot / SLOTS_PER_ROW)}
                compact
                isActive={activeSlot === slot}
                hasData={!!trackSlots[slot]}
                trackKey={trackKey}
                onSelect={onSelect}
            />
        ))}
    </>
));
