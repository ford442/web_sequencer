import { memo, useCallback } from 'react';
import type { TrackKey } from '../../types';
import { transportMixStore, useTransportMixStore } from '../../stores/transportMixStore';
import { cycleTrackLength } from '../../utils/songMeter';

/**
 * Per-track loop length chip for a sequencer row header (polyrhythm).
 *
 * Shows "=" while the track follows the pattern length, otherwise its own loop
 * length in steps. Click cycles forward through [follow, ...length presets];
 * Shift-click cycles backwards. Lives inside the row SVG under the M/S pads and
 * uses the same bevelled-pad idiom. Reads the transport store directly, so no
 * props thread through MainSequencer.
 */

const WIDTH = 28;
const HEIGHT = 13;
/** Engaged colour: amber-free cyan so it never reads as a mute. */
const ENGAGED = '#06b6d4';

export interface TrackLoopLengthChipProps {
    trackKey: TrackKey;
    /** Row label ("Lead", "Kick", …) used to build the accessible name. */
    label: string;
}

export const TrackLoopLengthChip = memo(({ trackKey, label }: TrackLoopLengthChipProps) => {
    const length = useTransportMixStore((s) => s.trackLengths[trackKey] ?? null);

    const activate = useCallback((e: React.PointerEvent | React.KeyboardEvent) => {
        // Row headers select the track on click; a chip press must not do that too.
        e.stopPropagation();
        e.preventDefault();
        const { timeSignature, trackLengths } = transportMixStore.getSnapshot();
        const next = cycleTrackLength(trackLengths[trackKey] ?? null, e.shiftKey ? -1 : 1, timeSignature);
        transportMixStore.setTrackLength(trackKey, next);
    }, [trackKey]);

    const engaged = length !== null;
    const description = engaged ? `${length} steps` : 'follows pattern length';

    return (
        <g
            className="track-loop-length"
            role="button"
            tabIndex={0}
            aria-label={`${label} loop length: ${description}. Click to change, Shift-click to go back.`}
            data-testid={`track-len-${trackKey}`}
            cursor="pointer"
            onPointerDown={activate}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') activate(e);
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: 'manipulation' }}
        >
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={2} fill="#050505" />
            <rect
                x={1}
                y={1}
                width={WIDTH - 2}
                height={HEIGHT - 2}
                rx={2}
                fill={engaged ? ENGAGED : '#1a2026'}
                fillOpacity={engaged ? 0.55 : 1}
            />
            {/* Bevel: top-left highlight, bottom-right shadow (same model as SvgStep). */}
            <path
                d={`M 1 1 L ${WIDTH - 1} 1 L ${WIDTH - 2} 2 L 2 2 L 2 ${HEIGHT - 2} L 1 ${HEIGHT - 1} Z`}
                fill="rgba(255,255,255,0.2)"
                pointerEvents="none"
            />
            <path
                d={`M ${WIDTH - 1} 1 L ${WIDTH - 1} ${HEIGHT - 1} L 1 ${HEIGHT - 1} L 2 ${HEIGHT - 2} L ${WIDTH - 2} ${HEIGHT - 2} L ${WIDTH - 2} 2 Z`}
                fill="rgba(0,0,0,0.5)"
                pointerEvents="none"
            />
            <text
                x={WIDTH / 2}
                y={HEIGHT / 2 + 2.5}
                textAnchor="middle"
                fontSize={7}
                fontFamily="monospace"
                fontWeight="bold"
                fill={engaged ? '#050505' : '#5a6b60'}
                pointerEvents="none"
            >
                {engaged ? `L${length}` : 'L='}
            </text>
        </g>
    );
});
