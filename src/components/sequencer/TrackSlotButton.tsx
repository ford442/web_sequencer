import { memo } from 'react';
import type { TrackKey } from '../../types';
import { getPatternColor } from './constants';
import { TRACK_PATTERN_SLOT_INDICES } from '../../utils/trackStorageUtils';
import { getTrackSlotHitRect } from './stepHitGeometry';

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
    /** Only the selected track row exposes its active slot in tab order. */
    isRowSelected?: boolean;
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
    isRowSelected = false,
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
    const hitRect = getTrackSlotHitRect(rectW, rectH);

    return (
        <g
            transform={`translate(${col * slotW}, ${row * slotH})`}
            className="track-slot"
            onClick={() => onSelect(trackKey, index)}
            cursor="pointer"
            role="button"
            tabIndex={isRowSelected && isActive ? 0 : -1}
            aria-label={`Pattern Slot ${index + 1}`}
            aria-description="Left-click to select pattern. Right-click to copy/paste/clear. Arrow keys move between slots."
            aria-pressed={isActive}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(trackKey, index);
                    return;
                }
                if (!isRowSelected) return;
                const SLOTS_PER_ROW = 16;
                let next = index;
                if (e.key === 'ArrowRight') next = Math.min(31, index + 1);
                else if (e.key === 'ArrowLeft') next = Math.max(0, index - 1);
                else if (e.key === 'ArrowDown') next = Math.min(31, index + SLOTS_PER_ROW);
                else if (e.key === 'ArrowUp') next = Math.max(0, index - SLOTS_PER_ROW);
                else return;
                e.preventDefault();
                onSelect(trackKey, next);
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: 'manipulation' }}
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
            <rect
                className="track-slot-hit"
                x={hitRect.x}
                y={hitRect.y}
                width={hitRect.width}
                height={hitRect.height}
                fill="transparent"
            />
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
    isRowSelected = false,
}: {
    activeSlot: number;
    trackSlots: (unknown | null)[];
    trackKey: TrackKey;
    onSelect: (k: TrackKey, i: number) => void;
    isRowSelected?: boolean;
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
                isRowSelected={isRowSelected}
            />
        ))}
    </>
));
